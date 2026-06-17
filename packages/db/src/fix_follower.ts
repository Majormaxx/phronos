import { db, followers } from "./index.js";
import { eq } from "drizzle-orm";

async function main() {
  // Fix bad checksum address
  await db().delete(followers)
    .where(eq(followers.address, "0xDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEf"));
  await db().insert(followers).values({
    address: "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
    escrowUsdc: "3000000",
    firstSeen: new Date(),
  }).onConflictDoNothing();
  console.log("Fixed follower checksum address");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
