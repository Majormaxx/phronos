/**
 * Trader-02: Mean Reversion
 * Fades the 24h extremes — shorts the biggest gainers, longs the biggest losers.
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, createWalletClient, http } from "viem";
import { getPublicClient, getDeployedAddresses, arcTestnet, pinJson, getAgentWallet, dcwSignTypedData, type DCWWallet } from "@phronos/shared";
import { db, traces } from "@phronos/db";

const AGENT_ID    = BigInt(process.env.TRADER_02_AGENT_ID ?? "19298");
const PK          = (process.env.TRADER_02_PRIVATE_KEY ?? "") as `0x${string}`;
const INTERVAL_MS = 25 * 60 * 1000;
const WATCHLIST   = ["bitcoin", "ethereum", "solana", "binancecoin", "avalanche-2"];
const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", binancecoin: "BNB", "avalanche-2": "AVAX",
};

const ROUTER_ABI = [{ name: "submitIntent", type: "function", inputs: [
  { name: "intent", type: "tuple", components: [
    { name: "erc8004Id", type: "uint256" }, { name: "venue", type: "uint8" },
    { name: "marketId", type: "bytes32" }, { name: "notionalUSDC", type: "int256" },
    { name: "validUntil", type: "uint64" }, { name: "nonce", type: "uint256" },
    { name: "strategyHash", type: "bytes32" }, { name: "traceCID", type: "bytes32" },
  ]},
  { name: "operatorSig", type: "bytes" },
], outputs: []}] as const;

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

async function fetchChanges(): Promise<Record<string, number>> {
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
  if (!PK) return;
  const { router } = getDeployedAddresses();
  if (!router) return;

  let changes: Record<string, number>;
  try {
    changes = await fetchChanges();
  } catch (err) {
    console.warn("[trader-02] CoinGecko fetch failed — skipping cycle:", (err as Error).message);
    return;
  }
  const entries  = Object.entries(changes).filter(([, c]) => Math.abs(c) >= 0.1);
  let dcwWallet: DCWWallet | null = null;
  try {
    dcwWallet = await getAgentWallet(2);
    if (dcwWallet) console.log(`[trader-02] Circle DCW wallet: ${dcwWallet.address}`);
  } catch { /* non-fatal */ }

  const account  = privateKeyToAccount(PK);
  const client   = getPublicClient();
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  for (const [coin, change] of entries) {
    const symbol    = SYMBOL_MAP[coin] ?? coin.toUpperCase();
    const direction = change > 0 ? -1 : 1;
    const notional  = BigInt(Math.round(direction * 8_000_000));
    const timestamp = Math.floor(Date.now() / 1000);

    const traceJson = JSON.stringify({
      schemaVersion: "trace/1.0",
      agentId:       AGENT_ID.toString(),
      strategy:      "mean-revert-24h-fade",
      marketId:      symbol,
      notionalUSDC:  notional.toString(),
      direction:     direction > 0 ? "LONG" : "SHORT",
      rationale:     `Mean-revert ${symbol}: fading ${change.toFixed(2)}%`,
      timestamp,
    });

    let traceHash: `0x${string}`;
    let ipfsCid: string | null = null;
    try {
      const pinResult = await pinJson(traceJson);
      traceHash = pinResult.traceHash;
      ipfsCid   = pinResult.cid;
      if (ipfsCid) console.log(`[trader-02] trace pinned cid=${ipfsCid}`);
    } catch (err) {
      console.warn("[trader-02] IPFS pin failed:", (err as Error).message);
      traceHash = keccak256(toHex(traceJson));
    }

    const intent = {
      erc8004Id:    AGENT_ID,
      venue:        0,
      marketId:     keccak256(toHex(symbol)) as `0x${string}`,
      notionalUSDC: notional,
      validUntil:   BigInt(timestamp + 45 * 60),
      nonce:        nonce++,
      strategyHash: keccak256(toHex("phronos:strategy:mean-revert-24h-fade")) as `0x${string}`,
      traceCID:     traceHash,
    };

    console.log(`[trader-02] ${direction > 0 ? "LONG" : "SHORT"} ${symbol} (fade ${change.toFixed(2)}%)`);

    try {
      const domain = { name: "Phronos Router", version: "1", chainId: 5042002, verifyingContract: router } as const;
      let sig: `0x${string}`;
      if (dcwWallet) {
        const dcwSig = await dcwSignTypedData({
          walletId:    dcwWallet.walletId,
          domain,
          types:       INTENT_TYPES,
          primaryType: "Intent",
          message:     intent as Record<string, unknown>,
        });
        if (dcwSig) {
          sig = dcwSig;
          console.log("[trader-02] Signed via Circle DCW typedData");
        } else {
          console.warn("[trader-02] DCW sign failed — falling back to private key");
          sig = await account.signTypedData({ domain, types: INTENT_TYPES, primaryType: "Intent", message: intent });
        }
      } else {
        sig = await account.signTypedData({ domain, types: INTENT_TYPES, primaryType: "Intent", message: intent });
      }
      const { request } = await client.simulateContract({
        address: router, abi: ROUTER_ABI, functionName: "submitIntent",
        args: [intent, sig], account,
      });
      const hash = await walletClient.writeContract(request);
      console.log(`[trader-02] submitted tx=${hash}`);
      if (ipfsCid) {
        await db().insert(traces).values({
          traceCid: ipfsCid, intentHash: traceHash, agentId: Number(AGENT_ID),
          contentHash: traceHash, pinnedAt: new Date(),
        }).onConflictDoNothing().catch(() => {});
      }
    } catch (err) { console.error(`[trader-02] ${symbol}:`, (err as Error).message?.slice(0, 200)); }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-02]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
loop();
