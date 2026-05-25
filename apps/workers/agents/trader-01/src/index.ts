/**
 * Trader-01: Momentum
 * Buys the top-3 24h performers. Submits EIP-712 signed intents to PhronosRouter.
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, createWalletClient, http } from "viem";
import { getPublicClient, getDeployedAddresses, arcTestnet, pinJson } from "@phronos/shared";
import { db, traces } from "@phronos/db";

const AGENT_ID     = BigInt(process.env.TRADER_01_AGENT_ID ?? "19297");
const PK           = (process.env.TRADER_01_PRIVATE_KEY ?? "") as `0x${string}`;
const INTERVAL_MS  = 20 * 60 * 1000;
const WATCHLIST    = ["bitcoin", "ethereum", "solana", "binancecoin", "avalanche-2"];
const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", binancecoin: "BNB", "avalanche-2": "AVAX",
};

const ROUTER_ABI = [{
  name: "submitIntent",
  type: "function",
  inputs: [
    { name: "intent", type: "tuple", components: [
      { name: "erc8004Id", type: "uint256" },
      { name: "venue", type: "uint8" },
      { name: "marketId", type: "bytes32" },
      { name: "notionalUSDC", type: "int256" },
      { name: "validUntil", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "strategyHash", type: "bytes32" },
      { name: "traceCID", type: "bytes32" },
    ]},
    { name: "operatorSig", type: "bytes" },
  ],
  outputs: [],
}] as const;

const INTENT_TYPES = {
  Intent: [
    { name: "erc8004Id",    type: "uint256" },
    { name: "venue",        type: "uint8" },
    { name: "marketId",     type: "bytes32" },
    { name: "notionalUSDC", type: "int256" },
    { name: "validUntil",   type: "uint64" },
    { name: "nonce",        type: "uint256" },
    { name: "strategyHash", type: "bytes32" },
    { name: "traceCID",     type: "bytes32" },
  ],
} as const;

async function fetchChanges(): Promise<Record<string, number> | null> {
  const ids = WATCHLIST.join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json() as Record<string, { usd_24h_change?: number }>;
  if (!data.bitcoin) throw new Error("CoinGecko returned empty data");
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.usd_24h_change ?? 0]));
}

let nonce = BigInt(Date.now());

async function run(): Promise<void> {
  if (!PK) { console.warn("[trader-01] TRADER_01_PRIVATE_KEY not set"); return; }
  const { router } = getDeployedAddresses();
  if (!router) { console.warn("[trader-01] PHRONOS_ROUTER_ADDR not set"); return; }

  let changes: Record<string, number>;
  try {
    const result = await fetchChanges();
    if (!result) { console.warn("[trader-01] CoinGecko returned no data — skipping cycle"); return; }
    changes = result;
  } catch (err) {
    console.warn("[trader-01] CoinGecko fetch failed — skipping cycle:", (err as Error).message);
    return;
  }
  const sorted  = Object.entries(changes).sort(([, a], [, b]) => b - a);
  const top3    = sorted.slice(0, 3);

  const account      = privateKeyToAccount(PK);
  const client       = getPublicClient();
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  for (const [coin, change] of top3) {
    if (Math.abs(change) < 0.5) continue;
    const symbol    = SYMBOL_MAP[coin] ?? coin.toUpperCase();
    const notional  = BigInt(Math.round(change > 0 ? 10_000_000 : -10_000_000));
    const timestamp = Math.floor(Date.now() / 1000);

    const traceJson = JSON.stringify({
      schemaVersion:   "trace/1.0",
      agentId:         AGENT_ID.toString(),
      strategy:        "momentum-24h-top3",
      marketId:        symbol,
      notionalUSDC:    notional.toString(),
      direction:       change > 0 ? "LONG" : "SHORT",
      rationale:       `Momentum: ${symbol} 24h change ${change.toFixed(2)}%`,
      timestamp,
    });

    let traceHash: `0x${string}`;
    let ipfsCid: string | null = null;
    try {
      const pinResult = await pinJson(traceJson);
      traceHash = pinResult.traceHash;
      ipfsCid   = pinResult.cid;
      if (ipfsCid) console.log(`[trader-01] trace pinned cid=${ipfsCid}`);
    } catch (err) {
      console.warn("[trader-01] IPFS pin failed, using keccak256:", (err as Error).message);
      traceHash = keccak256(toHex(traceJson));
    }

    const intent = {
      erc8004Id:    AGENT_ID,
      venue:        0,
      marketId:     keccak256(toHex(symbol)) as `0x${string}`,
      notionalUSDC: notional,
      validUntil:   BigInt(timestamp + 30 * 60),
      nonce:        nonce++,
      strategyHash: keccak256(toHex("phronos:strategy:momentum-24h-top3")) as `0x${string}`,
      traceCID:     traceHash,
    };

    console.log(`[trader-01] ${change > 0 ? "LONG" : "SHORT"} ${symbol} change=${change.toFixed(2)}%`);

    try {
      const sig = await account.signTypedData({
        domain: { name: "Phronos Router", version: "1", chainId: 5042002, verifyingContract: router },
        types: INTENT_TYPES,
        primaryType: "Intent",
        message: intent,
      });
      const { request } = await client.simulateContract({
        address: router, abi: ROUTER_ABI, functionName: "submitIntent",
        args: [intent, sig], account,
      });
      const hash = await walletClient.writeContract(request);
      console.log(`[trader-01] submitted tx=${hash}`);
      if (ipfsCid) {
        await db().insert(traces).values({
          traceCid:    ipfsCid,
          intentHash:  traceHash, // keccak256 — matches intents.trace_cid for JOIN
          agentId:     Number(AGENT_ID),
          contentHash: traceHash,
          pinnedAt:    new Date(),
        }).onConflictDoNothing().catch(() => {});
      }
    } catch (err) {
      console.error(`[trader-01] submit failed for ${symbol}:`, (err as Error).message?.slice(0, 200));
    }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-01]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
