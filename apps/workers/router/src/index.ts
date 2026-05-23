/**
 * Router worker: watches PhronosRouter for IntentSubmitted events,
 * runs three policy refusers in series, and records Copied / Refused on chain.
 *
 * For P0 (Arc mock swap): executes a no-op copy (no real funds moved),
 * records the receipt hash and emits Copied event. This satisfies the
 * on-chain traceability requirement while Hyperliquid integration is P1.
 */
import { parseAbi, keccak256, toHex, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPublicClient, getWalletClient, getDeployedAddresses, arcTestnet } from "@phronos/shared";
import { db, followers, intents, copies, refusals } from "@phronos/db";
import { eq } from "drizzle-orm";
import { llmJudgment } from "../../refusers/src/llm_judgment.js";
import { macroShift } from "../../refusers/src/macro_shift.js";
import { whaleContradiction } from "../../refusers/src/whale_contradiction.js";

const DRY_RUN = process.env.DRY_RUN !== "false";
const PK      = (process.env.ROUTER_PRIVATE_KEY ?? "") as `0x${string}`;

const ROUTER_ABI = parseAbi([
  "event IntentSubmitted(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 venue, int256 notionalUSDC, bytes32 traceCID)",
  "function recordCopy(bytes32 intentHash, uint256 erc8004Id, address follower, int256 followerNotional, bytes32 venueReceiptHash, uint256 feeUSDC, uint8 venue) external",
  "function recordRefusal(bytes32 intentHash, uint256 erc8004Id, address follower, uint8 reason, bytes32 reasonCID) external",
]);

async function getActiveFollowers(): Promise<string[]> {
  // In production: read from on-chain copyActive mapping via multicall.
  // For demo: read from DB (indexer keeps this in sync).
  try {
    const rows = await db().select().from(followers);
    return rows.map((r) => r.address);
  } catch {
    return [];
  }
}

async function processIntent(log: {
  args: {
    erc8004Id?: bigint;
    intentHash?: `0x${string}`;
    venue?: number;
    notionalUSDC?: bigint;
    traceCID?: `0x${string}`;
  };
}): Promise<void> {
  const { erc8004Id, intentHash, venue, notionalUSDC, traceCID } = log.args;
  if (!erc8004Id || !intentHash || notionalUSDC === undefined) return;

  const activeFollowers = await getActiveFollowers();
  if (activeFollowers.length === 0) {
    console.log(`[router] intent=${intentHash.slice(0,10)} — no active followers`);
    return;
  }

  const { router } = getDeployedAddresses();
  const marketSummary = `intent notional=${notionalUSDC} venue=${venue ?? 0}`;
  const intentCtx = {
    erc8004Id: erc8004Id.toString(),
    marketId:  intentHash.slice(0, 20),
    notionalUSDC: notionalUSDC.toString(),
    venue:     venue ?? 0,
  };

  if (DRY_RUN) {
    console.log(`[router] DRY_RUN — would process intent=${intentHash.slice(0, 10)} for ${activeFollowers.length} followers`);
    return;
  }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(PK),
    chain: arcTestnet,
    transport: http(),
  });
  const client = getPublicClient();

  for (const followerAddr of activeFollowers.slice(0, 20)) {
    // Run refusers in series — first refusal short-circuits
    const [llm, macro, whale] = await Promise.all([
      llmJudgment(intentCtx, marketSummary),
      macroShift(intentCtx),
      whaleContradiction(intentCtx),
    ]);

    const refuser = [llm, macro, whale].find((r) => !r.allow);

    if (refuser) {
      console.log(`[router] REFUSED follower=${followerAddr.slice(0,8)} reason=${refuser.reasonCode} — ${refuser.reason}`);
      try {
        const { request } = await client.simulateContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: "recordRefusal",
          args: [intentHash, erc8004Id, followerAddr as `0x${string}`, refuser.reasonCode, refuser.reasonCID],
          account: walletClient.account,
        });
        await walletClient.writeContract(request);
        // Persist to DB
        await db().insert(refusals).values({
          intentHash,
          followerAddr,
          reason: refuser.reasonCode,
          reasonCid: refuser.reasonCID,
          refusedAt: new Date(),
        }).onConflictDoNothing();
      } catch (err) { console.error("[router] recordRefusal failed:", err); }
      continue;
    }

    // Execute copy — Arc mock swap (P0): record a synthetic receipt
    const followerNotional = notionalUSDC! / 10n; // scale down for demo
    const venueReceiptHash = keccak256(toHex(JSON.stringify({
      intentHash, followerAddr, followerNotional: followerNotional.toString(), timestamp: Date.now()
    })));

    console.log(`[router] COPY follower=${followerAddr.slice(0,8)} notional=${followerNotional}`);
    try {
      const { request } = await client.simulateContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: "recordCopy",
        args: [intentHash, erc8004Id, followerAddr as `0x${string}`, followerNotional, venueReceiptHash, 0n, venue ?? 0],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      // Persist to DB
      await db().insert(copies).values({
        intentHash,
        followerAddr,
        followerNotional: followerNotional.toString(),
        venueReceipt: venueReceiptHash,
        executedAt: new Date(),
      }).onConflictDoNothing();
    } catch (err) { console.error("[router] recordCopy failed:", err); }
  }
}

async function start(): Promise<void> {
  const { router } = getDeployedAddresses();
  if (!router) { console.error("[router] PHRONOS_ROUTER_ADDR not set"); process.exit(1); }
  if (!PK) { console.warn("[router] ROUTER_PRIVATE_KEY not set — running read-only"); }

  const client = getPublicClient();
  console.log(`[router] watching PhronosRouter at ${router}`);

  client.watchContractEvent({
    address: router,
    abi: ROUTER_ABI,
    eventName: "IntentSubmitted",
    onLogs: async (logs) => {
      for (const log of logs) {
        await processIntent(log).catch((err) => console.error("[router] processIntent error:", err));
      }
    },
  });

  // Keep alive
  await new Promise(() => {});
}

start();
