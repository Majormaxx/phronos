export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { db, rawSql, agents, bonds, slashes, intents, copies } from "@phronos/db";
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

/** Race a promise against a timeout; returns null on timeout or rejection. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(r => setTimeout(() => r(null), ms)),
  ]);
}

/** Convert a WAD-encoded int256 (18 decimal places) to a JavaScript float.
 *  Uses pure BigInt arithmetic to avoid float64 precision loss on large values. */
function wadToFloat(wad: bigint): number {
  const neg   = wad < 0n;
  const abs   = neg ? -wad : wad;
  const INT   = BigInt(1_000_000_000_000_000_000n); // 1e18
  const int   = abs / INT;
  const frac  = abs % INT;
  // Keep 9 significant decimal digits (enough for Sharpe display)
  const fracStr = frac.toString().padStart(18, "0").slice(0, 9);
  const result  = parseFloat(`${int}.${fracStr}`);
  return neg ? -result : result;
}

export async function GET() {
  try {
    const store  = db();
    const nsql   = rawSql();
    const { slashOracle, router, bond: bondContract } = getDeployedAddresses();
    const client = getPublicClient();

    const allAgents = await store.select().from(agents).where(
      and(eq(agents.suspended, false), sql`${agents.erc8004Id} > 20000`),
    );

    const result = await Promise.all(allAgents.map(async (a) => {
      const [bondRows, slashCount, intentCount, followerRows] = await Promise.all([
        store.select().from(bonds).where(eq(bonds.erc8004Id, a.erc8004Id)).limit(1),
        store.select({ count: sql<number>`count(*)` }).from(slashes).where(eq(slashes.erc8004Id, a.erc8004Id)),
        store.select({ count: sql<number>`count(*)` }).from(intents).where(eq(intents.erc8004Id, a.erc8004Id)),
        // Count distinct wallets that have had a copy executed for this agent's intents
        nsql`
          SELECT COUNT(DISTINCT c.follower_addr)::int AS count
          FROM copies c
          JOIN intents i ON c.intent_hash = i.intent_hash
          WHERE i.erc8004_id = ${a.erc8004Id}
        `,
      ]);

      // On-chain reads with 4-second timeout — Arc RPC can be slow from cloud environments.
      // Return values directly (avoid closure side-effect pattern which can silently fail).
      const bondUsdc = Number(bondRows[0]?.usdcEquiv ?? "0") / 1e6;

      const [sharpeRaw, feesRaw, bondRaw] = await Promise.all([
        withTimeout(
          slashOracle
            ? client.readContract({ address: slashOracle, abi: SLASH_ORACLE_ABI, functionName: "sharpeOf", args: [BigInt(a.erc8004Id)] })
            : Promise.resolve(null),
          4_000,
        ),
        withTimeout(
          router
            ? client.readContract({ address: router, abi: ROUTER_ABI, functionName: "feesAccrued", args: [BigInt(a.erc8004Id)] })
            : Promise.resolve(null),
          4_000,
        ),
        withTimeout(
          bondContract
            ? client.readContract({ address: bondContract, abi: BOND_ABI, functionName: "bondBalanceOf", args: [BigInt(a.erc8004Id)] })
            : Promise.resolve(null),
          4_000,
        ),
      ]);

      let sharpe7d        = 0;
      let sharpeUpdatedAt: number | null = null;
      let feesUsdc        = 0;
      let bondLive: number               = bondUsdc; // DB fallback if on-chain times out

      if (sharpeRaw !== null) {
        const arr = sharpeRaw as readonly [bigint, bigint];
        sharpe7d        = wadToFloat(arr[0]);
        sharpeUpdatedAt = Number(arr[1]);
      }
      if (feesRaw !== null) feesUsdc = Number(feesRaw as bigint) / 1e6;
      if (bondRaw !== null) bondLive  = Number(bondRaw as bigint) / 1e6;

      const sc = Number(slashCount[0]?.count ?? 0);
      const ic = Number(intentCount[0]?.count ?? 0);
      const fc = Number((followerRows as Array<{count: number}>)[0]?.count ?? 0);

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
        tier: computeTier({ intentCount: ic, sharpe7d, slashCount: sc, followerCount: fc }),
      };
    }));

    result.sort((a, b) => b.sharpe7d - a.sharpe7d);
    return NextResponse.json(result.slice(0, 20));
  } catch (err) {
    console.error("/api/leaderboard", err);
    return NextResponse.json([], { status: 500 });
  }
}
