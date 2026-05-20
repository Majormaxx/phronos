import { NextResponse } from "next/server";
import { db, goals } from "@phronos/db";
import { pinJson } from "@phronos/shared";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { goal: unknown; address: string };
    const { goal, address } = body;

    if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

    const goalText = typeof goal === "string" ? goal : JSON.stringify(goal);
    const json = JSON.stringify({ goalText, address, timestamp: Date.now() });

    const { cid } = await pinJson(json);

    await db().insert(goals).values({
      userAddress: address,
      goalText,
      ipfsCid: cid,
    });

    return NextResponse.json({ cid });
  } catch (err) {
    console.error("/api/goal", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
