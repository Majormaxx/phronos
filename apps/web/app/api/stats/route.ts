import { NextResponse } from "next/server";
import { db, agents, followers, intents, copies, refusals, slashes, indexerCursor } from "@phronos/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const store = db();
    const [
      agentCount, followerCount, intentCount, copyCount, refusalCount, slashCount, cursor,
    ] = await Promise.all([
      store.select({ c: sql<number>`count(*)` }).from(agents),
      store.select({ c: sql<number>`count(*)` }).from(followers),
      store.select({ c: sql<number>`count(*)` }).from(intents),
      store.select({ c: sql<number>`count(*)` }).from(copies),
      store.select({ c: sql<number>`count(*)` }).from(refusals),
      store.select({ c: sql<number>`count(*)` }).from(slashes),
      store.select().from(indexerCursor).limit(1),
    ]);

    return NextResponse.json({
      agents:    Number(agentCount[0]?.c ?? 0),
      followers: Number(followerCount[0]?.c ?? 0),
      intents:   Number(intentCount[0]?.c ?? 0),
      copies:    Number(copyCount[0]?.c ?? 0),
      refusals:  Number(refusalCount[0]?.c ?? 0),
      slashes:   Number(slashCount[0]?.c ?? 0),
      indexerBlock: cursor[0]?.lastBlock ?? 0,
      indexerUpdatedAt: cursor[0]?.updatedAt ?? null,
    });
  } catch (err) {
    console.error("/api/stats", err);
    return NextResponse.json({ agents: 0, followers: 0, intents: 0, copies: 0, refusals: 0, slashes: 0 });
  }
}
