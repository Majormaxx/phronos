export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db, policies, followers } from "@phronos/db";
import { eq } from "drizzle-orm";
import { keccak256, toHex } from "viem";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const follower = searchParams.get("follower");
  if (!follower) return NextResponse.json({ error: "follower required" }, { status: 400 });

  const rows = await db().select().from(policies).where(eq(policies.followerAddr, follower));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  try {
    const { followerAddr, erc8004Id } = await req.json() as { followerAddr: string; erc8004Id: number };

    if (!followerAddr?.startsWith("0x") || followerAddr.length !== 42) {
      return NextResponse.json({ error: "invalid followerAddr" }, { status: 400 });
    }
    if (!erc8004Id || isNaN(Number(erc8004Id))) {
      return NextResponse.json({ error: "invalid erc8004Id" }, { status: 400 });
    }

    const policySpec  = JSON.stringify({ type: "copy-all", follower: followerAddr, agent: erc8004Id, createdAt: Date.now() });
    const policyHash  = keccak256(toHex(policySpec));
    const activeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Register follower so the router worker picks them up
    await db().insert(followers).values({
      address:    followerAddr,
      escrowUsdc: "0",
      firstSeen:  new Date(),
    }).onConflictDoNothing();

    // Upsert policy row
    await db().insert(policies).values({
      followerAddr,
      erc8004Id,
      policyCid:   policyHash,
      policyHash,
      activeUntil,
    }).onConflictDoUpdate({
      target: [policies.followerAddr, policies.erc8004Id],
      set:    { activeUntil, policyHash },
    });

    return NextResponse.json({ ok: true, followerAddr, erc8004Id, activeUntil });
  } catch (err) {
    console.error("/api/policies POST", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
