import { NextResponse } from "next/server";
import { db, agents, signals } from "@phronos/db";
import { eq, desc, gte } from "drizzle-orm";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { parseAbi } from "viem";

const VAULT_ABI = parseAbi([
  "function traderBond(uint256 agentId) external view returns (uint256)",
  "function traderWeightBps(uint256 agentId) external view returns (uint16)",
]);

export async function GET() {
  try {
    const admittedAgents = await db()
      .select()
      .from(agents)
      .where(eq(agents.admitted, true));

    const { vault } = getDeployedAddresses();
    const client = getPublicClient();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await Promise.all(
      admittedAgents.map(async (a) => {
        const [recentSignals, lastSignalRows] = await Promise.all([
          db()
            .select()
            .from(signals)
            .where(eq(signals.agentId, a.agentId))
            .where(gte(signals.createdAt, since7d)),
          db()
            .select()
            .from(signals)
            .where(eq(signals.agentId, a.agentId))
            .orderBy(desc(signals.createdAt))
            .limit(1),
        ]);

        let weightBps = 0;
        let bondUSDC = "0";

        if (vault) {
          const [bond, weight] = await Promise.all([
            client.readContract({ address: vault, abi: VAULT_ABI, functionName: "traderBond", args: [BigInt(a.agentId)] }),
            client.readContract({ address: vault, abi: VAULT_ABI, functionName: "traderWeightBps", args: [BigInt(a.agentId)] }),
          ]).catch(() => [0n, 0]);
          bondUSDC = (Number(bond) / 1e6).toFixed(0);
          weightBps = Number(weight);
        }

        const computeSharpe = (sigs: typeof recentSignals) => {
          if (sigs.length < 2) return 0;
          const pnls = sigs.map((s) => (s.direction === "long" ? 1 : s.direction === "short" ? -1 : 0) * s.conviction);
          const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
          const std = Math.sqrt(pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length);
          return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
        };

        const sig24h = recentSignals.filter((s) => s.createdAt && s.createdAt >= since24h);
        const last = lastSignalRows[0];

        return {
          agentId: a.agentId,
          persona: a.persona,
          weightBps,
          bondUSDC,
          sharpe24h: computeSharpe(sig24h),
          sharpe7d: computeSharpe(recentSignals),
          lastSignal: last
            ? {
                direction: last.direction,
                market: last.marketSymbol,
                at: last.createdAt
                  ? new Date(last.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                  : "—",
              }
            : null,
        };
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("/api/bench", err);
    return NextResponse.json([], { status: 500 });
  }
}
