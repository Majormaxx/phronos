import { db, followers } from "./index.js";

async function main() {
  const TEST_FOLLOWERS = [
    { address: "0x4e36ee389458856E79945a07Bf1bE36261E7b6a2", escrowUsdc: "10000000" },
    { address: "0x1BD759e9a1D70ce5F4f14e4D0501ffFdf534350E", escrowUsdc: "5000000" },
    { address: "0xDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEf", escrowUsdc: "3000000" },
  ];
  for (const f of TEST_FOLLOWERS) {
    await db().insert(followers).values({
      address: f.address,
      escrowUsdc: f.escrowUsdc,
      firstSeen: new Date(),
    }).onConflictDoNothing();
    console.log("seeded follower", f.address);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
