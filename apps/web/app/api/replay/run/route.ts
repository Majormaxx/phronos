import { NextResponse } from "next/server";

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

    // Dynamic import to keep the replay harness server-side only
    const { replay } = await import("../../../../../../../../apps/workers/replay-harness/src/index.js") as {
      replay: (input: { agentId: number; strategySpecCID: string; marketSnapshotHash: `0x${string}`; seed: number }) => {
        intentHash: `0x${string}`; traceCID: `0x${string}`; trace: object;
      };
    };

    const result = replay({
      agentId,
      strategySpecCID: strategySpecCID ?? "phronos:strategy:momentum-24h-top3",
      marketSnapshotHash: snapshotHash,
      seed,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("/api/replay/run", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
