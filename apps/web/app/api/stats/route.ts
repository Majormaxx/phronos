export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const [agents, followers, intents, copies, refusals, slashes, cursor] = await Promise.all([
      sql`SELECT count(*)::int AS c FROM agents WHERE erc8004_id > 20000 AND suspended = false`,
      sql`SELECT count(*)::int AS c FROM followers`,
      sql`SELECT count(*)::int AS c FROM intents`,
      sql`SELECT count(*)::int AS c FROM copies`,
      sql`SELECT count(*)::int AS c FROM refusals`,
      sql`SELECT count(*)::int AS c FROM slashes`,
      sql`SELECT last_block::text AS last_block, updated_at FROM indexer_cursor ORDER BY last_block DESC LIMIT 1`,
    ]);

    return NextResponse.json({
      agents:           Number(agents[0]?.c ?? 0),
      followers:        Number(followers[0]?.c ?? 0),
      intents:          Number(intents[0]?.c ?? 0),
      copies:           Number(copies[0]?.c ?? 0),
      refusals:         Number(refusals[0]?.c ?? 0),
      slashes:          Number(slashes[0]?.c ?? 0),
      indexerBlock:     cursor[0]?.last_block ?? 0,
      indexerUpdatedAt: cursor[0]?.updated_at ?? null,
    });
  } catch (err) {
    console.error("/api/stats", err);
    return NextResponse.json({ agents: 0, followers: 0, intents: 0, copies: 0, refusals: 0, slashes: 0 });
  }
}
