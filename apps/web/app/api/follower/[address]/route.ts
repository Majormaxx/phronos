export const dynamic    = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { db, copies, refusals } from "@phronos/db";
import { eq, desc } from "drizzle-orm";

const REASON_NAMES: Record<number, string> = {
  1: "LLM judgment",
  2: "Macro shift",
  3: "Whale contradiction",
};

export async function GET(_req: Request, { params }: { params: { address: string } }) {
  const addr = params.address.toLowerCase();
  if (!addr.startsWith("0x") || addr.length !== 42) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  const [recentCopies, recentRefusals] = await Promise.all([
    db().select().from(copies).where(eq(copies.followerAddr, params.address)).orderBy(desc(copies.executedAt)).limit(50),
    db().select().from(refusals).where(eq(refusals.followerAddr, params.address)).orderBy(desc(refusals.refusedAt)).limit(20),
  ]);

  return NextResponse.json({
    copies:   recentCopies,
    refusals: recentRefusals.map(r => ({
      ...r,
      reasonName: REASON_NAMES[r.reason] ?? `Code ${r.reason}`,
    })),
  });
}
