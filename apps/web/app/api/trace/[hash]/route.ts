import { NextResponse } from "next/server";
import { keccak256, toHex } from "viem";
import { db, traces } from "@phronos/db";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { hash: string } }) {
  const { hash } = params;

  const rows = await db().select().from(traces).where(eq(traces.traceHash, hash)).limit(1);
  const trace = rows[0];

  if (!trace) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Fetch content from IPFS and verify hash
  try {
    const res = await fetch(`https://w3s.link/ipfs/${trace.ipfsCid}`);
    if (!res.ok) throw new Error("IPFS fetch failed");

    const text = await res.text();
    const content = JSON.parse(text);
    const computedHash = keccak256(toHex(text));
    const verified = computedHash.toLowerCase() === hash.toLowerCase();

    return NextResponse.json({ cid: trace.ipfsCid, kind: trace.kind, content, verified });
  } catch {
    return NextResponse.json({ cid: trace.ipfsCid, kind: trace.kind, content: null, verified: false });
  }
}
