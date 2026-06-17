export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { db, rawSql, agents, bonds, slashes, intents, policies } from "@phronos/db";
import { eq, sql, and } from "drizzle-orm";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { parseAbi } from "viem";
import { computeTier } from "@/lib/tiers";

const SLASH_ORACLE_ABI = parseAbi([
  "function sharpeOf(uint256 erc8004Id) external view returns (int256 sharpe, uint64 updatedAt)",
]);

const ROUTER_ABI = parseAbi([
  "function feesAccrued(uint256 erc8004Id) external view returns (uint256)",
]);

const BOND_ABI = parseAbi([
  "function bondBalanceOf(uint256 erc8004Id) external view returns (uint256)",
]);

export async function GET() {
  try {
    const store  = db();
    const { slashOracle, router, bond: bondContract } = getDeployedAddresses();
    const client = getPublicClient();

    // Exclude v1 deployment IDs (19297-19300) — superseded by v2 (22892-22900)
    const allAgents = await store.select().from(agents).where(
      and(eq(agents.suspended, false), sql`${agents.erc8004Id} > 20000`),
    );

    const result = await Promise.all(allAgents.map(async (a) => {
      const [bondRows, slashCount, intentCount, followerCount] = await Promise.all([
        store.select().from(bonds).where(eq(bonds.erc8004Id, a.erc8004Id)).limit(1),
        store.select({ count: sql<number>`count(*)` }).from(slashes).where(eq(slashes.erc8004Id, a.erc8004Id)),
        store.select({ count: sql<number>`count(*)` }).from(intents).where(eq(intents.erc8004Id, a.erc8004Id)),
        store.select({ count: sql<number>`count(*)` }).from(policies).where(eq(policies.erc8004Id, a.erc8004Id)),
      ]);

      let sharpe7d        = 0;
      let sharpeUpdatedAt: number | null = null;
      let feesUsdc        = 0;
      let bondLive: number | null = null;

      await Promise.allSettled([
        slashOracle && client.readContract({
          address: slashOracle, abi: SLASH_ORACLE_ABI,
          functionName: "sharpeOf", args: [BigInt(a.erc8004Id)],
        }).then(([s, u]) => {
          sharpe7d        = Number(s as bigint) / 1e18;
          sharpeUpdatedAt = Number(u as bigint);
        }),

        router && client.readContract({
          address: router, abi: ROUTER_ABI,
          functionName: "feesAccrued", args: [BigInt(a.erc8004Id)],
        }).then(f => { feesUsdc = Number(f as bigint) / 1e6; }),

        bondContract && client.readContract({
          address: bondContract, abi: BOND_ABI,
          functionName: "bondBalanceOf", args: [BigInt(a.erc8004Id)],
        }).then(b => { bondLive = Number(b as bigint) / 1e6; }),
      ]);

      const sc = Number(slashCount[0]?.count   ?? 0);
      const ic = Number(intentCount[0]?.count  ?? 0);
      const fc = Number(followerCount[0]?.count ?? 0);
      return {
        erc8004Id:       a.erc8004Id,
        agentCardCid:    a.agentCardCid,
        operator:        a.operatorAddr,
        activeSince:     a.activeSince,
        bondUsdc:        bondRows[0]?.usdcEquiv ?? "0",
        bondLive,
        slashCount:      sc,
        intentCount:     ic,
        followerCount:   fc,
        sharpe7d,
        sharpeUpdatedAt,
        feesUsdc,
        tier:            computeTier({ intentCount: ic, sharpe7d, slashCount: sc, followerCount: fc }),
      };
    }));

    result.sort((a, b) => b.sharpe7d - a.sharpe7d);
    return NextResponse.json(result.slice(0, 20));
  } catch (err) {
    console.error("/api/leaderboard", err);
    return NextResponse.json([], { status: 500 });
  }
}
