/**
 * Trader-03: Funding Rate
 * Shorts crowded longs (positive funding), longs crowded shorts (negative funding).
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, createWalletClient, http } from "viem";
import { getPublicClient, getDeployedAddresses, arcTestnet } from "@phronos/shared";

const AGENT_ID    = BigInt(process.env.TRADER_03_AGENT_ID ?? "19299");
const PK          = (process.env.TRADER_03_PRIVATE_KEY ?? "") as `0x${string}`;
const INTERVAL_MS = 15 * 60 * 1000;
const THRESHOLD   = 0.000001;

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

async function fetchFunding(): Promise<{ btc: number; eth: number }> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const data = await res.json() as [unknown, Array<{ funding: string }>];
    return { btc: parseFloat(data[1]?.[0]?.funding ?? "0"), eth: parseFloat(data[1]?.[1]?.funding ?? "0") };
  } catch {
    return { btc: 0, eth: 0 };
  }
}

let nonce = BigInt(Date.now());

async function run(): Promise<void> {
  if (!PK) return;
  const { router } = getDeployedAddresses();
  if (!router) return;

  const { btc, eth } = await fetchFunding();
  const signals    = [["BTC", btc], ["ETH", eth]] as [string, number][];
  const account    = privateKeyToAccount(PK);
  const client     = getPublicClient();
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  for (const [symbol, funding] of signals) {
    if (Math.abs(funding) < THRESHOLD) continue;
    const direction = funding > 0 ? -1 : 1;
    const notional  = BigInt(Math.round(direction * 10_000_000));
    const timestamp = Math.floor(Date.now() / 1000);
    const rationale = `${symbol} funding=${(funding * 100).toFixed(4)}% — fade crowded ${funding > 0 ? "longs" : "shorts"}`;
    const traceHash = keccak256(toHex(JSON.stringify({ rationale, timestamp })));

    const intent = {
      erc8004Id:    AGENT_ID,
      venue:        0,
      marketId:     keccak256(toHex(symbol)) as `0x${string}`,
      notionalUSDC: notional,
      validUntil:   BigInt(timestamp + 60 * 60),
      nonce:        nonce++,
      strategyHash: keccak256(toHex("phronos:strategy:funding-rate-hl")) as `0x${string}`,
      traceCID:     traceHash,
    };

    console.log(`[trader-03] ${direction > 0 ? "LONG" : "SHORT"} ${symbol} funding=${(funding * 100).toFixed(4)}%`);

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
      console.log(`[trader-03] submitted tx=${hash}`);
    } catch (err) { console.error(`[trader-03] ${symbol}:`, (err as Error).message?.slice(0, 200)); }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-03]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
loop();
