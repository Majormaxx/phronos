import { db, agents, bonds, followers } from "./index.js";

const OPERATOR = process.env.DEPLOYER_PRIVATE_KEY
  ? "0x1BD759e9a1D70ce5F4f14e4D0501ffFdf534350E"
  : "0x0000000000000000000000000000000000000001";

const TRADERS = [
  {
    erc8004Id:    Number(process.env.TRADER_01_AGENT_ID ?? "19297"),
    agentCardCid: "phronos:trader-01:momentum",
    strategyCid:  "phronos:strategy:momentum-24h-top3",
    bondUsdc:     "2000000", // 2 USDC
  },
  {
    erc8004Id:    Number(process.env.TRADER_02_AGENT_ID ?? "19298"),
    agentCardCid: "phronos:trader-02:mean-reversion",
    strategyCid:  "phronos:strategy:mean-revert-24h-fade",
    bondUsdc:     "2000000",
  },
  {
    erc8004Id:    Number(process.env.TRADER_03_AGENT_ID ?? "19299"),
    agentCardCid: "phronos:trader-03:funding-rate",
    strategyCid:  "phronos:strategy:funding-rate-hl",
    bondUsdc:     "2000000",
  },
  {
    erc8004Id:    Number(process.env.TRADER_04_AGENT_ID ?? "19300"),
    agentCardCid: "phronos:trader-04:random-walk",
    strategyCid:  "phronos:strategy:random-walk-stochastic",
    bondUsdc:     "2000000",
  },
];

async function seed() {
  console.log("[seed] inserting 4 v2 agents into Neon...");
  const store = db();
  const now   = new Date();

  for (const t of TRADERS) {
    await store
      .insert(agents)
      .values({
        erc8004Id:        t.erc8004Id,
        operatorAddr:     OPERATOR,
        agentCardCid:     t.agentCardCid,
        strategyCid:      t.strategyCid,
        activeSince:      now,
        suspended:        false,
        lastIndexedBlock: 0,
      })
      .onConflictDoNothing();

    await store
      .insert(bonds)
      .values({
        erc8004Id:   t.erc8004Id,
        usycShares:  t.bondUsdc,
        usdcEquiv:   t.bondUsdc,
        lastUpdated: now,
      })
      .onConflictDoNothing();

    console.log(`[seed] agent ${t.erc8004Id} (${t.agentCardCid}) inserted`);
  }

  // Seed the deployer address as a demo follower
  await store.insert(followers).values({
    address: OPERATOR,
    escrowUsdc: "200000", // 0.2 USDC deposited on-chain
    firstSeen: now,
  }).onConflictDoNothing();
  console.log(`[seed] follower ${OPERATOR} inserted`);

  console.log("[seed] done");
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
