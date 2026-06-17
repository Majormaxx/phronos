/**
 * Indexer: watches all PhronosRouter + PhronosBond events and projects them into Postgres.
 * Chain is source of truth — this is a read-only projection.
 * Rebuild from scratch: delete DB tables, restart this worker from block 0.
 */
import { parseAbi } from "viem";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { db, agents, intents, copies, refusals, slashes, followers, bonds, indexerCursor, eq, sql } from "@phronos/db";

const CHAIN_ID = 5042002;

const AGENT_MARKET: Record<number, string> = {
  // v2 deployment
  22892: "BTC", 22893: "BTC", 22897: "ETH", 22900: "BTC",
  // v1 deployment (historical)
  19297: "BTC", 19298: "BTC", 19299: "ETH", 19300: "BTC",
};

const ROUTER_ABI = parseAbi([
  "event IntentSubmitted(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 venue, int256 notionalUSDC, bytes32 traceCID)",
  "event Copied(address indexed follower, uint256 indexed erc8004Id, bytes32 indexed intentHash, int256 followerNotional, bytes32 venueReceiptHash)",
  "event Refused(address indexed follower, uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 reason, bytes32 reasonCID)",
  "event Deposited(address indexed follower, uint256 usdcAmount)",
]);

const BOND_ABI = parseAbi([
  "event BondPosted(uint256 indexed erc8004Id, address indexed operator, uint256 usdcAmount)",
  "event Slashed(uint256 indexed erc8004Id, uint16 bps, uint256 usdcReleased, bytes32 reasonHash)",
]);

const REGISTRY_ABI = parseAbi([
  "event AgentRegistered(uint256 indexed erc8004Id, address indexed operator, bytes32 agentCardCid)",
]);

async function processIntentLog(store: ReturnType<typeof db>, log: { args: Record<string, unknown>; blockNumber: bigint | null }) {
  const { erc8004Id, intentHash, venue, notionalUSDC, traceCID } = log.args as {
    erc8004Id?: bigint; intentHash?: `0x${string}`; venue?: number;
    notionalUSDC?: bigint; traceCID?: `0x${string}`;
  };
  if (!erc8004Id || !intentHash) return;
  await store.insert(intents).values({
    intentHash,
    erc8004Id:    Number(erc8004Id),
    venue:        venue ?? 0,
    marketId:     AGENT_MARKET[Number(erc8004Id)] ?? "BTC",
    notionalUsdc: notionalUSDC?.toString() ?? "0",
    validUntil:   new Date(Date.now() + 30 * 60 * 1000),
    strategyHash: "0x",
    traceCid:     traceCID ?? "0x",
    submittedAt:  new Date(),
    blockNumber:  Number(log.blockNumber ?? 0),
  }).onConflictDoNothing();
  console.log(`[indexer] IntentSubmitted agent=${erc8004Id} hash=${intentHash.slice(0,10)}`);
}

async function processCopyLog(store: ReturnType<typeof db>, log: { args: Record<string, unknown> }) {
  const { follower, intentHash, followerNotional, venueReceiptHash } = log.args as {
    follower?: `0x${string}`; intentHash?: `0x${string}`;
    followerNotional?: bigint; venueReceiptHash?: `0x${string}`;
  };
  if (!follower || !intentHash) return;
  await store.insert(copies).values({
    intentHash,
    followerAddr:     follower,
    followerNotional: followerNotional?.toString() ?? "0",
    venueReceipt:     venueReceiptHash ?? "0x",
    executedAt:       new Date(),
  }).onConflictDoNothing();
  console.log(`[indexer] Copied follower=${follower.slice(0,8)} intent=${intentHash.slice(0,10)}`);
}

async function processBondLog(store: ReturnType<typeof db>, log: { args: Record<string, unknown> }) {
  const { erc8004Id, operator, usdcAmount } = log.args as {
    erc8004Id?: bigint; operator?: `0x${string}`; usdcAmount?: bigint;
  };
  if (!erc8004Id) return;
  // Upsert agent record so leaderboard always has an entry
  if (operator) {
    await store.insert(agents).values({
      erc8004Id:        Number(erc8004Id),
      operatorAddr:     operator,
      agentCardCid:     `phronos:agent-${erc8004Id}`,
      strategyCid:      `phronos:strategy:${erc8004Id}`,
      activeSince:      new Date(),
      lastIndexedBlock: 0,
    }).onConflictDoNothing();
  }
  await store.insert(bonds).values({
    erc8004Id:   Number(erc8004Id),
    usycShares:  usdcAmount?.toString() ?? "0",
    usdcEquiv:   usdcAmount?.toString() ?? "0",
    lastUpdated: new Date(),
  }).onConflictDoNothing();
  console.log(`[indexer] BondPosted agent=${erc8004Id} amount=${usdcAmount}`);
}

async function catchUpHistorical(
  client: ReturnType<typeof getPublicClient>,
  store: ReturnType<typeof db>,
  router: `0x${string}`,
  bond: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
) {
  console.log(`[indexer] catch-up replay from=${fromBlock} to=${toBlock}`);
  const CHUNK = 5000n;
  for (let from = fromBlock; from <= toBlock; from += CHUNK) {
    const to = from + CHUNK - 1n < toBlock ? from + CHUNK - 1n : toBlock;
    try {
      const [intentLogs, copyLogs, bondLogs] = await Promise.all([
        client.getContractEvents({ address: router, abi: ROUTER_ABI, eventName: "IntentSubmitted", fromBlock: from, toBlock: to }),
        client.getContractEvents({ address: router, abi: ROUTER_ABI, eventName: "Copied",          fromBlock: from, toBlock: to }),
        client.getContractEvents({ address: bond,   abi: BOND_ABI,   eventName: "BondPosted",      fromBlock: from, toBlock: to }),
      ]);
      for (const log of bondLogs)   { try { await processBondLog(store, log as never);   } catch (e) { console.error("[indexer] bond:", e); } }
      for (const log of intentLogs) { try { await processIntentLog(store, log as never); } catch (e) { console.error("[indexer] intent:", e); } }
      for (const log of copyLogs)   { try { await processCopyLog(store, log as never);   } catch (e) { console.error("[indexer] copy:", e); } }
    } catch (err) { console.error(`[indexer] catch-up chunk from=${from}:`, err); }
  }
  console.log(`[indexer] catch-up complete`);
}

async function start(): Promise<void> {
  const { router, bond, registry } = getDeployedAddresses();
  if (!router || !bond) {
    console.error("[indexer] PHRONOS_ROUTER_ADDR or PHRONOS_BOND_ADDR not set");
    process.exit(1);
  }

  const client = getPublicClient();
  const store  = db();
  console.log(`[indexer] watching router=${router} bond=${bond}`);

  // Historical catch-up from cursor
  const cursorRows = await store.select().from(indexerCursor).where(eq(indexerCursor.chainId, CHAIN_ID)).limit(1);
  const fromBlock  = cursorRows[0] ? BigInt(cursorRows[0].lastBlock + 1) : 0n;
  const latestBlock = await client.getBlockNumber();
  if (fromBlock <= latestBlock) {
    await catchUpHistorical(client, store, router as `0x${string}`, bond as `0x${string}`, fromBlock, latestBlock);
  }

  // Router events
  client.watchContractEvent({
    address: router, abi: ROUTER_ABI, eventName: "IntentSubmitted",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { erc8004Id, intentHash, venue, notionalUSDC, traceCID } = log.args;
        if (!erc8004Id || !intentHash) continue;
        try {
          await store.insert(intents).values({
            intentHash,
            erc8004Id:    Number(erc8004Id),
            venue:        venue ?? 0,
            marketId:     AGENT_MARKET[Number(erc8004Id)] ?? "BTC",
            notionalUsdc: notionalUSDC?.toString() ?? "0",
            validUntil:   new Date(Date.now() + 30 * 60 * 1000),
            strategyHash: "0x",
            traceCid:     traceCID ?? "0x",
            submittedAt:  new Date(),
            blockNumber:  Number(log.blockNumber ?? 0),
          }).onConflictDoNothing();
          console.log(`[indexer] IntentSubmitted agent=${erc8004Id} hash=${intentHash.slice(0,10)}`);
        } catch (err) { console.error("[indexer] intent insert:", err); }
      }
    },
  });

  client.watchContractEvent({
    address: router, abi: ROUTER_ABI, eventName: "Copied",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { follower, erc8004Id, intentHash, followerNotional, venueReceiptHash } = log.args;
        if (!follower || !intentHash) continue;
        try {
          await store.insert(copies).values({
            intentHash,
            followerAddr: follower,
            followerNotional: followerNotional?.toString() ?? "0",
            venueReceipt: venueReceiptHash ?? "0x",
            executedAt: new Date(),
          }).onConflictDoNothing();
          console.log(`[indexer] Copied follower=${follower.slice(0,8)} intent=${intentHash.slice(0,10)}`);
        } catch (err) { console.error("[indexer] copy insert:", err); }
      }
    },
  });

  client.watchContractEvent({
    address: router, abi: ROUTER_ABI, eventName: "Refused",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { follower, intentHash, reason, reasonCID } = log.args;
        if (!follower || !intentHash) continue;
        try {
          await store.insert(refusals).values({
            intentHash,
            followerAddr: follower,
            reason: reason ?? 0,
            reasonCid: reasonCID ?? "0x",
            refusedAt: new Date(),
          }).onConflictDoNothing();
          console.log(`[indexer] Refused follower=${follower.slice(0,8)} reason=${reason}`);
        } catch (err) { console.error("[indexer] refusal insert:", err); }
      }
    },
  });

  client.watchContractEvent({
    address: router, abi: ROUTER_ABI, eventName: "Deposited",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { follower, usdcAmount } = log.args;
        if (!follower) continue;
        try {
          await store.insert(followers).values({
            address:    follower,
            escrowUsdc: usdcAmount?.toString() ?? "0",
            firstSeen:  new Date(),
          }).onConflictDoUpdate({
            target: followers.address,
            set:    { escrowUsdc: sql`${followers.escrowUsdc}::numeric + ${(usdcAmount ?? 0n).toString()}::numeric` },
          });
          console.log(`[indexer] Deposited follower=${follower.slice(0,8)} amount=${usdcAmount}`);
        } catch (err) { console.error("[indexer] follower deposit:", err); }
      }
    },
  });

  // Bond events
  client.watchContractEvent({
    address: bond, abi: BOND_ABI, eventName: "BondPosted",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { erc8004Id, operator, usdcAmount } = log.args;
        if (!erc8004Id) continue;
        try {
          // Ensure agent record exists
          if (operator) {
            await store.insert(agents).values({
              erc8004Id:        Number(erc8004Id),
              operatorAddr:     operator as `0x${string}`,
              agentCardCid:     `phronos:agent-${erc8004Id}`,
              strategyCid:      `phronos:strategy:${erc8004Id}`,
              activeSince:      new Date(),
              lastIndexedBlock: 0,
            }).onConflictDoNothing();
          }
          await store.insert(bonds).values({
            erc8004Id:   Number(erc8004Id),
            usycShares:  usdcAmount?.toString() ?? "0",
            usdcEquiv:   usdcAmount?.toString() ?? "0",
            lastUpdated: new Date(),
          }).onConflictDoNothing();
          console.log(`[indexer] BondPosted agent=${erc8004Id} amount=${usdcAmount}`);
        } catch { /* ignore */ }
      }
    },
  });

  client.watchContractEvent({
    address: bond, abi: BOND_ABI, eventName: "Slashed",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { erc8004Id, bps, usdcReleased, reasonHash } = log.args;
        if (!erc8004Id) continue;
        try {
          await store.insert(slashes).values({
            erc8004Id:    Number(erc8004Id),
            bps:          Number(bps ?? 0),
            usdcReleased: usdcReleased?.toString() ?? "0",
            sharpeAtEval: "0",
            reasonHash:   reasonHash ?? "0x",
            blockNumber:  Number(log.blockNumber ?? 0),
          }).onConflictDoNothing();
          // Update bond balance to reflect the slash
          await store.update(bonds)
            .set({
              usdcEquiv:   sql`GREATEST(0, ${bonds.usdcEquiv}::numeric - ${(usdcReleased ?? 0n).toString()}::numeric)`,
              lastUpdated: new Date(),
            })
            .where(eq(bonds.erc8004Id, Number(erc8004Id)));
          console.log(`[indexer] Slashed agent=${erc8004Id} bps=${bps} released=${usdcReleased}`);
        } catch { /* ignore */ }
      }
    },
  });

  // Update cursor periodically
  setInterval(async () => {
    try {
      const block = await client.getBlockNumber();
      await store.insert(indexerCursor).values({
        chainId: CHAIN_ID,
        lastBlock: Number(block),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: indexerCursor.chainId,
        set: { lastBlock: Number(block), updatedAt: new Date() },
      });
    } catch { /* non-fatal */ }
  }, 30_000);

  console.log("[indexer] running — watching for events");
  await new Promise(() => {});
}

start();
