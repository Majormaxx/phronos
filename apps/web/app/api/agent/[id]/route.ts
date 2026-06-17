export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { db, agents, bonds, intents, slashes } from "@phronos/db";
import { eq, desc } from "drizzle-orm";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { parseAbi } from "viem";

const SLASH_ORACLE_ABI = parseAbi([
  "function sharpeOf(uint256 erc8004Id) external view returns (int256 sharpe, uint64 updatedAt)",
]);

const BOND_ABI = parseAbi([
  "function bondBalanceOf(uint256 erc8004Id) external view returns (uint256)",
]);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const [agentRows, bondRows, recentIntents, recentSlashes] = await Promise.all([
    db().select().from(agents).where(eq(agents.erc8004Id, id)).limit(1),
    db().select().from(bonds).where(eq(bonds.erc8004Id, id)).limit(1),
    db().select().from(intents).where(eq(intents.erc8004Id, id)).orderBy(desc(intents.submittedAt)).limit(20),
    db().select().from(slashes).where(eq(slashes.erc8004Id, id)).orderBy(desc(slashes.blockNumber)).limit(10),
  ]);

  const agent = agentRows[0];
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  const { slashOracle, bond: bondContract } = getDeployedAddresses();
  const client = getPublicClient();

  let sharpe7d        = 0;
  let sharpeUpdatedAt: number | null = null;
  let bondLive: number | null        = null;

  await Promise.allSettled([
    slashOracle && client.readContract({
      address:      slashOracle,
      abi:          SLASH_ORACLE_ABI,
      functionName: "sharpeOf",
      args:         [BigInt(id)],
    }).then(([s, u]) => {
      sharpe7d        = Number(s as bigint) / 1e18;
      sharpeUpdatedAt = Number(u as bigint);
    }),

    bondContract && client.readContract({
      address:      bondContract,
      abi:          BOND_ABI,
      functionName: "bondBalanceOf",
      args:         [BigInt(id)],
    }).then(b => { bondLive = Number(b as bigint) / 1e6; }),
  ]);

  return NextResponse.json({
    erc8004Id:       agent.erc8004Id,
    agentCardCid:    agent.agentCardCid,
    operator:        agent.operatorAddr,
    activeSince:     agent.activeSince,
    bondUsdc:        bondRows[0]?.usdcEquiv ?? "0",
    bondLive,
    slashCount:      recentSlashes.length,
    intentCount:     recentIntents.length,
    sharpe7d,
    sharpeUpdatedAt,
    intents: recentIntents.map(i => ({
      intentHash:   i.intentHash,
      marketId:     i.marketId,
      notionalUsdc: i.notionalUsdc,
      venue:        i.venue,
      traceCid:     i.traceCid,
      submittedAt:  i.submittedAt,
      blockNumber:  i.blockNumber,
    })),
    slashes: recentSlashes.map(s => ({
      bps:          s.bps,
      usdcReleased: s.usdcReleased,
      sharpeAtEval: s.sharpeAtEval,
      blockNumber:  s.blockNumber,
    })),
  });
}
