export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { rawSql } from "@phronos/db";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { parseAbi } from "viem";
import { computeTier } from "@/lib/tiers";

const ORACLE_ABI = parseAbi([
  "function sharpeOf(uint256 erc8004Id) external view returns (int256 sharpe, uint64 updatedAt)",
]);
const ROUTER_ABI = parseAbi([
  "function feesAccrued(uint256 erc8004Id) external view returns (uint256)",
]);
const BOND_ABI = parseAbi([
  "function bondBalanceOf(uint256 erc8004Id) external view returns (uint256)",
]);

export async function GET(_req: Request, { params }: { params: { address: string } }) {
  const address = params.address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  const sql = rawSql();
  const { slashOracle, router: routerAddr, bond: bondContract } = getDeployedAddresses();
  const client = getPublicClient();

  // ── Owned agents ──────────────────────────────────────────────────────────
  const agentRows = await sql`
    SELECT a.erc8004_id, a.active_since, a.agent_card_cid,
           m.name, m.description, m.strategy_type, m.market,
           COUNT(DISTINCT s.block_number)  AS slash_count,
           COUNT(DISTINCT i.intent_hash)   AS intent_count,
           COUNT(DISTINCT p.follower_addr) AS follower_count
    FROM agents a
    LEFT JOIN agent_metadata m ON m.erc8004_id = a.erc8004_id
    LEFT JOIN slashes  s ON s.erc8004_id = a.erc8004_id
    LEFT JOIN intents  i ON i.erc8004_id = a.erc8004_id
    LEFT JOIN policies p ON p.erc8004_id = a.erc8004_id
    WHERE LOWER(a.operator_addr) = ${address}
    GROUP BY a.erc8004_id, a.active_since, a.agent_card_cid,
             m.name, m.description, m.strategy_type, m.market
    ORDER BY a.erc8004_id
  ` as Array<{
    erc8004_id:     string;
    active_since:   Date;
    agent_card_cid: string;
    name:           string | null;
    description:    string | null;
    strategy_type:  string | null;
    market:         string | null;
    slash_count:    string;
    intent_count:   string;
    follower_count: string;
  }>;

  // Enrich with on-chain data (bond, sharpe, fees) in parallel
  const ownedAgents = await Promise.all(agentRows.map(async row => {
    const id = Number(row.erc8004_id);
    let bondLive = 0;
    let sharpe7d = 0;
    let feesUsdc = 0;

    await Promise.allSettled([
      bondContract && client.readContract({
        address: bondContract, abi: BOND_ABI, functionName: "bondBalanceOf", args: [BigInt(id)],
      }).then(b => { bondLive = Number(b as bigint) / 1e6; }),

      slashOracle && client.readContract({
        address: slashOracle, abi: ORACLE_ABI, functionName: "sharpeOf", args: [BigInt(id)],
      }).then(([s]) => { sharpe7d = Number(s as bigint) / 1e18; }),

      routerAddr && client.readContract({
        address: routerAddr, abi: ROUTER_ABI, functionName: "feesAccrued", args: [BigInt(id)],
      }).then(f => { feesUsdc = Number(f as bigint) / 1e6; }),
    ]);

    const sc = Number(row.slash_count);
    const ic = Number(row.intent_count);
    const fc = Number(row.follower_count);
    return {
      erc8004Id:     id,
      name:          row.name ?? `Agent #${id}`,
      description:   row.description ?? "",
      strategyType:  row.strategy_type ?? "Custom",
      market:        row.market ?? "BTC",
      activeSince:   row.active_since,
      bondLive,
      sharpe7d,
      feesUsdc,
      slashCount:    sc,
      intentCount:   ic,
      followerCount: fc,
      tier:          computeTier({ intentCount: ic, sharpe7d, slashCount: sc, followerCount: fc }),
    };
  }));

  // ── Following (agents this wallet copies) ─────────────────────────────────
  const followingRows = await sql`
    SELECT p.erc8004_id,
           m.name,
           a.operator_addr,
           COUNT(c.intent_hash)      AS copy_count,
           SUM(c.pnl_usdc)           AS total_pnl,
           MAX(c.executed_at)        AS last_copy_at
    FROM policies p
    LEFT JOIN agent_metadata m ON m.erc8004_id = p.erc8004_id
    LEFT JOIN agents          a ON a.erc8004_id = p.erc8004_id
    LEFT JOIN copies          c ON c.intent_hash IN (
      SELECT intent_hash FROM intents WHERE erc8004_id = p.erc8004_id
    ) AND c.follower_addr = ${address}
    WHERE LOWER(p.follower_addr) = ${address}
    GROUP BY p.erc8004_id, m.name, a.operator_addr
    ORDER BY p.erc8004_id
  ` as Array<{
    erc8004_id:  string;
    name:        string | null;
    operator_addr: string | null;
    copy_count:  string;
    total_pnl:   string | null;
    last_copy_at: Date | null;
  }>;

  const following = followingRows.map(row => ({
    erc8004Id:    Number(row.erc8004_id),
    name:         row.name ?? `Agent #${row.erc8004_id}`,
    operator:     row.operator_addr ?? "",
    copyCount:    Number(row.copy_count),
    totalPnlUsdc: row.total_pnl !== null ? Number(row.total_pnl) : null,
    lastCopyAt:   row.last_copy_at ?? null,
  }));

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const followerPnlRow = await sql`
    SELECT SUM(pnl_usdc) AS total FROM copies
    WHERE LOWER(follower_addr) = ${address} AND pnl_usdc IS NOT NULL
  ` as [{ total: string | null }];

  // ── Best verified calls (top P&L intents for owned agents) ───────────────
  const agentIds = ownedAgents.map(a => a.erc8004Id);
  let bestCalls: Array<{
    intentHash:   string;
    erc8004Id:    number;
    agentName:    string;
    marketId:     string;
    isLong:       boolean;
    entryPricePx: number;
    closePricePx: number;
    pctReturn:    number;
    submittedAt:  string;
  }> = [];

  if (agentIds.length > 0) {
    const callRows = await sql`
      SELECT i.intent_hash, i.erc8004_id, i.market_id, i.notional_usdc,
             i.entry_price_px, i.close_price_px, i.submitted_at,
             m.name AS agent_name
      FROM intents i
      LEFT JOIN agent_metadata m ON m.erc8004_id = i.erc8004_id
      WHERE i.erc8004_id = ANY(${agentIds})
        AND i.entry_price_px IS NOT NULL
        AND i.close_price_px IS NOT NULL
      ORDER BY i.submitted_at DESC
      LIMIT 100
    ` as Array<{
      intent_hash: string; erc8004_id: string; market_id: string;
      notional_usdc: string; entry_price_px: string; close_price_px: string;
      submitted_at: string; agent_name: string | null;
    }>;

    bestCalls = callRows
      .map(r => {
        const isLong    = BigInt(r.notional_usdc) >= 0n;
        const entry     = Number(r.entry_price_px);
        const close     = Number(r.close_price_px);
        const pctReturn = (close - entry) / entry * 100 * (isLong ? 1 : -1);
        return {
          intentHash:   r.intent_hash,
          erc8004Id:    Number(r.erc8004_id),
          agentName:    r.agent_name ?? `Agent #${r.erc8004_id}`,
          marketId:     r.market_id,
          isLong,
          entryPricePx: entry,
          closePricePx: close,
          pctReturn,
          submittedAt:  r.submitted_at,
        };
      })
      .sort((a, b) => b.pctReturn - a.pctReturn)
      .slice(0, 5);
  }

  const stats = {
    totalBondLive:   ownedAgents.reduce((s, a) => s + a.bondLive, 0),
    totalFollowers:  ownedAgents.reduce((s, a) => s + a.followerCount, 0),
    totalFeesUsdc:   ownedAgents.reduce((s, a) => s + a.feesUsdc, 0),
    totalSlashes:    ownedAgents.reduce((s, a) => s + a.slashCount, 0),
    followerPnlUsdc: followerPnlRow[0]?.total !== null ? Number(followerPnlRow[0]?.total ?? 0) : null,
  };

  return NextResponse.json({ address, ownedAgents, following, stats, bestCalls });
}
