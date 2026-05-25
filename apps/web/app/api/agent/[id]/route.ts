import { NextResponse } from "next/server";
import { db, agents, bonds, intents, slashes } from "@phronos/db";
import { eq, desc } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const [agentRows, bondRows, recentIntents, recentSlashes] = await Promise.all([
    db().select().from(agents).where(eq(agents.erc8004Id, id)).limit(1),
    db().select().from(bonds).where(eq(bonds.erc8004Id, id)).limit(1),
    db().select().from(intents).where(eq(intents.erc8004Id, id)).orderBy(desc(intents.submittedAt)).limit(20),
    db().select().from(slashes).where(eq(slashes.erc8004Id, id)).orderBy(desc(slashes.blockNumber)).limit(10),
  ]);

  const agent = agentRows[0];
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  return NextResponse.json({
    erc8004Id:    agent.erc8004Id,
    agentCardCid: agent.agentCardCid,
    operator:     agent.operatorAddr,
    activeSince:  agent.activeSince,
    bondUsdc:     bondRows[0]?.usdcEquiv ?? "0",
    slashCount:   recentSlashes.length,
    intentCount:  recentIntents.length,
    intents:      recentIntents.map(i => ({
      intentHash:   i.intentHash,
      marketId:     i.marketId,
      notionalUsdc: i.notionalUsdc,
      venue:        i.venue,
      traceCid:     i.traceCid,
      submittedAt:  i.submittedAt,
      blockNumber:  i.blockNumber,
    })),
    slashes: recentSlashes.map(s => ({
      bps:          s.bps,
      usdcReleased: s.usdcReleased,
      blockNumber:  s.blockNumber,
    })),
  });
}
