import { NextResponse } from "next/server";
import { db, intents, copies, refusals } from "@phronos/db";
import { desc } from "drizzle-orm";

const REASON_NAMES: Record<number, string> = {
  1: "LLM judgment",
  2: "Macro shift",
  3: "Whale contradiction",
};

const AGENT_NAMES: Record<number, string> = {
  19297: "Momentum", 19298: "Mean Reversion", 19299: "Funding Rate", 19300: "Random Walk",
};

export async function GET() {
  try {
    const [recentIntents, recentCopies, recentRefusals] = await Promise.all([
      db().select().from(intents).orderBy(desc(intents.submittedAt)).limit(5),
      db().select().from(copies).orderBy(desc(copies.executedAt)).limit(5),
      db().select().from(refusals).orderBy(desc(refusals.refusedAt)).limit(5),
    ]);

    const events = [
      ...recentIntents.map(i => ({
        type:    "intent" as const,
        time:    i.submittedAt,
        label:   `${Number(i.notionalUsdc) >= 0 ? "LONG" : "SHORT"} ${i.marketId}`,
        sub:     `$${(Math.abs(Number(i.notionalUsdc)) / 1e6).toFixed(2)} · ${AGENT_NAMES[i.erc8004Id] ?? `#${i.erc8004Id}`}`,
        hash:    i.intentHash,
        agentId: i.erc8004Id,
      })),
      ...recentCopies.map(c => ({
        type:    "copy" as const,
        time:    c.executedAt,
        label:   "Copy executed",
        sub:     `$${(Math.abs(Number(c.followerNotional)) / 1e6).toFixed(2)} · ${c.followerAddr.slice(0, 10)}…`,
        hash:    c.intentHash,
        agentId: null,
      })),
      ...recentRefusals.map(r => ({
        type:    "refusal" as const,
        time:    r.refusedAt,
        label:   "Copy refused",
        sub:     REASON_NAMES[r.reason] ?? `Code ${r.reason}`,
        hash:    r.intentHash,
        agentId: null,
      })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10);

    return NextResponse.json(events);
  } catch (err) {
    console.error("/api/activity", err);
    return NextResponse.json([]);
  }
}
