import { NextResponse } from "next/server";
import { db, signals } from "@phronos/db";
import { eq, desc } from "drizzle-orm";
import { SignalSchema } from "@phronos/shared";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agentId");

  const query = db()
    .select()
    .from(signals)
    .orderBy(desc(signals.createdAt))
    .limit(50);

  if (agentId) {
    const rows = await db()
      .select()
      .from(signals)
      .where(eq(signals.agentId, agentId))
      .orderBy(desc(signals.createdAt))
      .limit(50);
    return NextResponse.json(rows);
  }

  const rows = await query;
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const signal = SignalSchema.parse(body);

    await db().insert(signals).values({
      agentId: String(signal.agentId),
      marketSymbol: signal.marketSymbol,
      direction: signal.direction,
      conviction: signal.conviction,
      horizonMinutes: signal.horizonMinutes,
      rationale: signal.rationale,
      evidence: signal.evidence,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
