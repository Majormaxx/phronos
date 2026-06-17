/**
 * Seed v2 agent records for the 4 Phronos traders.
 * Run: pnpm --filter @phronos/db tsx src/seed_agents.ts
 */
import { db, agents, bonds } from "./index.js";

const OPERATOR = "0x4e36ee389458856E79945a07Bf1bE36261E7b6a2";

const V2_AGENTS = [
  { erc8004Id: 22892, agentCardCid: "phronos:trader-01:momentum",      strategyCid: "phronos:strategy:momentum-24h-top3" },
  { erc8004Id: 22893, agentCardCid: "phronos:trader-02:mean-reversion", strategyCid: "phronos:strategy:mean-revert-24h-fade" },
  { erc8004Id: 22897, agentCardCid: "phronos:trader-03:funding-rate",   strategyCid: "phronos:strategy:funding-rate-hl" },
  { erc8004Id: 22900, agentCardCid: "phronos:trader-04:random-walk",    strategyCid: "phronos:strategy:random-walk-stochastic" },
];

async function main() {
  const store = db();
  for (const a of V2_AGENTS) {
    await store.insert(agents).values({
      erc8004Id:        a.erc8004Id,
      operatorAddr:     OPERATOR,
      agentCardCid:     a.agentCardCid,
      strategyCid:      a.strategyCid,
      activeSince:      new Date("2026-05-25T00:00:00Z"),
      lastIndexedBlock: 43942407,
    }).onConflictDoNothing();
    console.log("seeded agent", a.erc8004Id);

    await store.insert(bonds).values({
      erc8004Id:   a.erc8004Id,
      usycShares:  "2000000",
      usdcEquiv:   "2000000",
      lastUpdated: new Date("2026-05-25T00:00:00Z"),
    }).onConflictDoNothing();
    console.log("seeded bond", a.erc8004Id);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
