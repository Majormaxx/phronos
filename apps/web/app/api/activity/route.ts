export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { agentName } from "@/lib/agents";

const REASON_NAMES: Record<number, string> = {
  1: "LLM judgment",
  2: "Macro shift",
  3: "Whale contradiction",
};

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const [recentIntents, recentCopies, recentRefusals] = await Promise.all([
      sql`SELECT intent_hash, erc8004_id, market_id, notional_usdc, submitted_at FROM intents ORDER BY submitted_at DESC LIMIT 5`,
      sql`SELECT intent_hash, follower_addr, follower_notional, executed_at FROM copies ORDER BY executed_at DESC LIMIT 5`,
      sql`SELECT intent_hash, follower_addr, reason, refused_at FROM refusals ORDER BY refused_at DESC LIMIT 5`,
    ]);

    const events = [
      ...recentIntents.map((i: Record<string, unknown>) => ({
        type:    "intent" as const,
        time:    i.submitted_at,
        label:   `${Number(i.notional_usdc) >= 0 ? "LONG" : "SHORT"} ${i.market_id}`,
        sub:     `$${(Math.abs(Number(i.notional_usdc)) / 1e6).toFixed(2)} · ${agentName(Number(i.erc8004_id))}`,
        hash:    i.intent_hash,
        agentId: Number(i.erc8004_id),
      })),
      ...recentCopies.map((c: Record<string, unknown>) => ({
        type:    "copy" as const,
        time:    c.executed_at,
        label:   "Copy executed",
        sub:     `$${(Math.abs(Number(c.follower_notional)) / 1e6).toFixed(2)} · ${String(c.follower_addr).slice(0, 10)}…`,
        hash:    c.intent_hash,
        agentId: null,
      })),
      ...recentRefusals.map((r: Record<string, unknown>) => ({
        type:    "refusal" as const,
        time:    r.refused_at,
        label:   "Copy refused",
        sub:     REASON_NAMES[Number(r.reason)] ?? `Code ${r.reason}`,
        hash:    r.intent_hash,
        agentId: null,
      })),
    ].sort((a, b) => new Date(String(b.time)).getTime() - new Date(String(a.time)).getTime()).slice(0, 10);

    return NextResponse.json(events);
  } catch (err) {
    console.error("/api/activity", err);
    return NextResponse.json([]);
  }
}
