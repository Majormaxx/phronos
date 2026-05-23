import { NextResponse } from "next/server";
import { keccak256, toHex } from "viem";

export async function POST(req: Request) {
  try {
    const { agentId, snapshotHash, seed, strategySpecCID } = await req.json() as {
      agentId: number;
      snapshotHash: `0x${string}`;
      seed: number;
      strategySpecCID?: string;
    };

    if (!agentId || !snapshotHash || seed === undefined) {
      return NextResponse.json({ error: "agentId, snapshotHash, seed required" }, { status: 400 });
    }

    // Deterministic replay: reconstruct the intent hash from inputs.
    // Full harness runs off-chain via apps/workers/replay-harness.
    const traceInput = JSON.stringify({ agentId, snapshotHash, seed, strategySpecCID, version: "1.0" });
    const intentHash  = keccak256(toHex(traceInput));
    const traceCID    = keccak256(toHex(`trace:${intentHash}`));

    return NextResponse.json({
      intentHash,
      traceCID,
      agentId,
      seed,
      snapshotHash,
      strategySpecCID: strategySpecCID ?? `phronos:strategy:agent-${agentId}`,
      replayedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
