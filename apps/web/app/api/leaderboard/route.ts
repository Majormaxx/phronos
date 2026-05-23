import { NextResponse } from "next/server";
import { db, agents, bonds, slashes, intents } from "@phronos/db";
import { eq, desc, gte, sql } from "drizzle-orm";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { parseAbi } from "viem";

const SLASH_ORACLE_ABI = parseAbi([
  "function sharpeOf(uint256 erc8004Id) external view returns (int256 sharpe, uint64 updatedAt)",
]);

export async function GET() {
  try {
    const store      = db();
    const since7d    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { slashOracle } = getDeployedAddresses();
    const client     = getPublicClient();

    const allAgents  = await store.select().from(agents).where(eq(agents.suspended, false));

    const result = await Promise.all(allAgents.map(async (a) => {
      const bond      = await store.select().from(bonds).where(eq(bonds.erc8004Id, a.erc8004Id)).limit(1);
      const slashCount = await store.select({ count: sql<number>`count(*)` }).from(slashes).where(eq(slashes.erc8004Id, a.erc8004Id));
      const intentCount = await store.select({ count: sql<number>`count(*)` }).from(intents)
        .where(eq(intents.erc8004Id, a.erc8004Id));

      let sharpe7d = 0;
      if (slashOracle) {
        try {
          const [s] = await client.readContract({
            address: slashOracle,
            abi: SLASH_ORACLE_ABI,
            functionName: "sharpeOf",
            args: [BigInt(a.erc8004Id)],
          }) as [bigint, bigint];
          sharpe7d = Number(s) / 1e18;
        } catch { /* oracle not yet populated */ }
      }

      return {
        erc8004Id:    a.erc8004Id,
        agentCardCid: a.agentCardCid,
        operator:     a.operatorAddr,
        activeSince:  a.activeSince,
        bondUsdc:     bond[0]?.usdcEquiv ?? "0",
        slashCount:   Number(slashCount[0]?.count ?? 0),
        intentCount:  Number(intentCount[0]?.count ?? 0),
        sharpe7d,
      };
    }));

    // Sort by Sharpe descending
    result.sort((a, b) => b.sharpe7d - a.sharpe7d);
    return NextResponse.json(result.slice(0, 20));
  } catch (err) {
    console.error("/api/leaderboard", err);
    return NextResponse.json([], { status: 500 });
  }
}
