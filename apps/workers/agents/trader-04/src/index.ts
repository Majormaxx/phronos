/**
 * Trader-04: Random Walk (the bad actor)
 * Emits fully random intents. Designed to accumulate a negative Sharpe and trigger the slash demo.
 * Fires more frequently than others to build a bad track record fast.
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, createWalletClient, http } from "viem";
import { getPublicClient, getDeployedAddresses, arcTestnet, pinJson, getAgentWallet, dcwSignTypedData, type DCWWallet } from "@phronos/shared";
import { db, traces } from "@phronos/db";

const AGENT_ID    = BigInt(process.env.TRADER_04_AGENT_ID ?? "19300");
const PK          = (process.env.TRADER_04_PRIVATE_KEY ?? "") as `0x${string}`;
const INTERVAL_MS = 10 * 60 * 1000;
const MARKETS     = ["BTC", "ETH", "SOL", "BNB"];

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

let nonce = BigInt(Date.now());

async function run(): Promise<void> {
  if (!PK) return;
  const { router } = getDeployedAddresses();
  if (!router) return;

  const market    = MARKETS[Math.floor(Math.random() * MARKETS.length)]!;
  const isLong    = Math.random() > 0.5;
  const notional  = BigInt(Math.round((isLong ? 1 : -1) * (5_000_000 + Math.random() * 5_000_000)));
  const timestamp = Math.floor(Date.now() / 1000);

  const traceJson = JSON.stringify({
    schemaVersion: "trace/1.0",
    agentId:       AGENT_ID.toString(),
    strategy:      "random-walk-stochastic",
    marketId:      market,
    notionalUSDC:  notional.toString(),
    direction:     isLong ? "LONG" : "SHORT",
    rationale:     "Stochastic signal — trust the process.",
    timestamp,
  });

  let traceHash: `0x${string}`;
  let ipfsCid: string | null = null;
  try {
    const pinResult = await pinJson(traceJson);
    traceHash = pinResult.traceHash;
    ipfsCid   = pinResult.cid;
    if (ipfsCid) console.log(`[trader-04] trace pinned cid=${ipfsCid}`);
  } catch (err) {
    console.warn("[trader-04] IPFS pin failed:", (err as Error).message);
    traceHash = keccak256(toHex(traceJson));
  }

  const intent = {
    erc8004Id:    AGENT_ID,
    venue:        0,
    marketId:     keccak256(toHex(market)) as `0x${string}`,
    notionalUSDC: notional,
    validUntil:   BigInt(timestamp + 20 * 60),
    nonce:        nonce++,
    strategyHash: keccak256(toHex("phronos:strategy:random-walk-stochastic")) as `0x${string}`,
    traceCID:     traceHash,
  };

  console.log(`[trader-04] random ${isLong ? "LONG" : "SHORT"} ${market} notional=${notional}`);

  let dcwWallet: DCWWallet | null = null;
  try {
    dcwWallet = await getAgentWallet(4);
    if (dcwWallet) console.log(`[trader-04] Circle DCW wallet: ${dcwWallet.address}`);
  } catch { /* non-fatal */ }

  const account      = privateKeyToAccount(PK);
  const client       = getPublicClient();
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

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
        console.log("[trader-04] Signed via Circle DCW typedData");
      } else {
        console.warn("[trader-04] DCW sign failed — falling back to private key");
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
    console.log(`[trader-04] submitted tx=${hash}`);
    if (ipfsCid) {
      await db().insert(traces).values({
        traceCid: ipfsCid, intentHash: traceHash, agentId: Number(AGENT_ID),
        contentHash: traceHash, pinnedAt: new Date(),
      }).onConflictDoNothing().catch(() => {});
    }
  } catch (err) { console.error("[trader-04]", (err as Error).message?.slice(0, 200)); }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-04]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
loop();
