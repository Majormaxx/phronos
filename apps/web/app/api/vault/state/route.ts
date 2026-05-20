import { NextResponse } from "next/server";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { parseAbi } from "viem";
import { db, slashes, regimes } from "@phronos/db";
import { desc } from "drizzle-orm";

const VAULT_ABI = parseAbi([
  "function nav() external view returns (uint256)",
  "function totalAssetsUSDC() external view returns (uint256)",
  "function usycPosition() external view returns (uint256)",
  "function totalShares() external view returns (uint256)",
]);

export async function GET() {
  try {
    const { vault } = getDeployedAddresses();
    const client = getPublicClient();

    let navUSDC = "0.00";
    let usycPct = 0;

    if (vault) {
      const [nav, usycPos] = await Promise.all([
        client.readContract({ address: vault, abi: VAULT_ABI, functionName: "nav" }),
        client.readContract({ address: vault, abi: VAULT_ABI, functionName: "usycPosition" }),
      ]);
      navUSDC = (Number(nav) / 1e6).toFixed(2);
      usycPct = nav > 0n ? Math.round(Number((usycPos * 10000n) / nav) / 100) : 0;
    }

    // Pull stats from DB
    const [slashRows, latestRegime] = await Promise.all([
      db().select().from(slashes),
      db().select().from(regimes).orderBy(desc(regimes.createdAt)).limit(1),
    ]);

    const totalSlashed = slashRows
      .reduce((sum, s) => sum + parseFloat(s.amount ?? "0"), 0)
      .toFixed(2);

    const lastRebalancedAt = latestRegime[0]?.createdAt
      ? new Date(latestRegime[0].createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

    return NextResponse.json({
      navUSDC,
      usycPct,
      totalFollowers: 0, // updated from on-chain event indexing
      totalSlashed,
      lastRebalancedAt,
    });
  } catch (err) {
    console.error("/api/vault/state", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
