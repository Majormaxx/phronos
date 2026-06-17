"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { arcscanAddress } from "@phronos/shared";
import { type Tier, TIER_META } from "@/lib/tiers";

type OwnedAgent = {
  erc8004Id:     number;
  name:          string;
  description:   string;
  strategyType:  string;
  market:        string;
  activeSince:   string;
  bondLive:      number;
  sharpe7d:      number;
  feesUsdc:      number;
  slashCount:    number;
  intentCount:   number;
  followerCount: number;
  tier:          Tier;
};

type FollowingEntry = {
  erc8004Id:    number;
  name:         string;
  operator:     string;
  copyCount:    number;
  totalPnlUsdc: number | null;
  lastCopyAt:   string | null;
};

type BestCall = {
  intentHash:   string;
  erc8004Id:    number;
  agentName:    string;
  marketId:     string;
  isLong:       boolean;
  entryPricePx: number;
  closePricePx: number;
  pctReturn:    number;
  submittedAt:  string;
};

type ProfileData = {
  address:     string;
  ownedAgents: OwnedAgent[];
  following:   FollowingEntry[];
  bestCalls:   BestCall[];
  stats: {
    totalBondLive:   number;
    totalFollowers:  number;
    totalFeesUsdc:   number;
    totalSlashes:    number;
    followerPnlUsdc: number | null;
  };
};

const POLL_MS = 15_000;

function SharpeChip({ v }: { v: number }) {
  const pos  = v >= 0;
  const str  = v !== 0 ? `${pos ? "+" : ""}${v.toFixed(2)}` : "—";
  return (
    <span className={`text-xs font-mono tabular-nums ${pos ? "text-olive" : "text-terracotta"}`}>{str}</span>
  );
}

function PnlChip({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs font-mono text-ink/25">pending</span>;
  const pos = v >= 0;
  return (
    <span className={`text-xs font-mono tabular-nums ${pos ? "text-olive" : "text-terracotta"}`}>
      {pos ? "+" : ""}{v.toFixed(4)} USDC
    </span>
  );
}

export function LiveProfile({ address }: { address: string }) {
  const [data,       setData]       = useState<ProfileData | null>(null);
  const [walletAddr, setWalletAddr] = useState<string | null>(null);

  useEffect(() => { setWalletAddr(localStorage.getItem("phronos_wallet")); }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/profile/${address}`).catch(() => null);
    if (res?.ok) setData(await res.json());
  }, [address]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const isOwn = walletAddr?.toLowerCase() === address.toLowerCase();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-4xl">
              {address.slice(0, 8)}…{address.slice(-4)}
            </h1>
            {isOwn && (
              <span className="text-[10px] font-mono text-olive/70 border border-olive/20 px-2 py-0.5 uppercase tracking-wider">
                you
              </span>
            )}
          </div>
          <a
            href={arcscanAddress(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-ink/30 hover:text-terracotta transition-colors"
          >
            {address} ↗
          </a>
        </div>
        {isOwn && (
          <Link href="/create-agent" className="btn-primary text-sm shrink-0">
            + Create agent
          </Link>
        )}
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ink/8 mb-10">
          {[
            { label: "Bond at stake",   value: `$${data.stats.totalBondLive.toFixed(2)}` },
            { label: "Followers",       value: String(data.stats.totalFollowers) },
            { label: "Fees earned",     value: `$${data.stats.totalFeesUsdc.toFixed(4)}` },
            { label: "Slash events",    value: String(data.stats.totalSlashes),
              accent: data.stats.totalSlashes > 0 },
            { label: "Follower P&L",
              value: data.stats.followerPnlUsdc !== null
                ? `${data.stats.followerPnlUsdc >= 0 ? "+" : ""}$${data.stats.followerPnlUsdc.toFixed(4)}`
                : "—",
              accent: data.stats.followerPnlUsdc !== null && data.stats.followerPnlUsdc >= 0,
              neg:    data.stats.followerPnlUsdc !== null && data.stats.followerPnlUsdc < 0 },
          ].map(({ label, value, accent, neg }) => (
            <div key={label} className="bg-surface p-4">
              <p className={`font-mono text-lg tabular-nums ${accent ? "text-olive" : neg ? "text-terracotta" : "text-ink"}`}>
                {value}
              </p>
              <p className="text-[10px] text-ink/30 uppercase tracking-wider mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {!data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ink/8 mb-10 animate-pulse">
          {[0,1,2,3,4].map(i => <div key={i} className="bg-surface p-4 h-16" />)}
        </div>
      )}

      {/* ── Owned agents ───────────────────────────────────────────────── */}
      {data && data.ownedAgents.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl">Agents</h2>
            <span className="text-xs text-ink/30 font-mono">{data.ownedAgents.length} active</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {data.ownedAgents.map(agent => (
              <Link
                key={agent.erc8004Id}
                href={`/agent/${agent.erc8004Id}`}
                className="card hover:border-ink/20 transition-colors group block"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-display text-lg group-hover:text-terracotta transition-colors truncate">
                        {agent.name}
                      </p>
                      {agent.tier !== "scout" && (() => {
                        const m = TIER_META[agent.tier];
                        return (
                          <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border shrink-0 ${m.color} ${m.bg} ${m.border}`}>
                            {m.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-[10px] font-mono text-ink/30">ERC-8004 #{agent.erc8004Id} · {agent.market}</p>
                  </div>
                  <SharpeChip v={agent.sharpe7d} />
                </div>

                {agent.description && (
                  <p className="text-xs text-ink/40 mb-4 line-clamp-2">{agent.description}</p>
                )}

                <div className="grid grid-cols-4 gap-2 text-center border-t border-ink/5 pt-3">
                  {[
                    { label: "Bond",      value: `$${agent.bondLive.toFixed(2)}` },
                    { label: "Followers", value: String(agent.followerCount) },
                    { label: "Intents",   value: String(agent.intentCount) },
                    { label: "Slashes",   value: String(agent.slashCount),
                      red: agent.slashCount > 0 },
                  ].map(({ label, value, red }) => (
                    <div key={label}>
                      <p className={`text-sm font-mono ${red ? "text-terracotta" : "text-ink"}`}>{value}</p>
                      <p className="text-[9px] text-ink/25 uppercase tracking-wider">{label}</p>
                    </div>
                  ))}
                </div>

                {agent.feesUsdc > 0 && (
                  <p className="text-[10px] font-mono text-olive/60 mt-3">
                    ${agent.feesUsdc.toFixed(4)} fees earned
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Best verified calls ───────────────────────────────────────── */}
      {data && data.bestCalls.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl">Best calls</h2>
            <span className="text-xs text-ink/25 font-mono">verified on-chain · sorted by return</span>
          </div>
          <div className="border border-ink/10 divide-y divide-ink/5">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-4 py-2 text-[10px] font-mono text-ink/25 uppercase tracking-wider">
              <span>Dir</span>
              <span>Market · Agent</span>
              <span className="text-right">Entry</span>
              <span className="text-right">Return</span>
              <span className="text-right">Proof</span>
            </div>
            {data.bestCalls.map(c => (
              <div key={c.intentHash} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center px-4 py-3 hover:bg-ink/5 transition-colors">
                <span className={`text-[9px] font-mono px-1.5 py-0.5 ${c.isLong ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                  {c.isLong ? "L" : "S"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">{c.marketId}</p>
                  <p className="text-[10px] text-ink/25 font-mono">{c.agentName}</p>
                </div>
                <span className="text-xs font-mono text-ink/40 text-right">
                  ${c.entryPricePx.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <span className={`text-sm font-mono tabular-nums text-right ${c.pctReturn >= 0 ? "text-olive" : "text-terracotta"}`}>
                  {c.pctReturn >= 0 ? "+" : ""}{c.pctReturn.toFixed(2)}%
                </span>
                <Link
                  href={`/traces/${c.intentHash}`}
                  className="text-[10px] font-mono text-ink/30 hover:text-terracotta transition-colors text-right"
                >
                  verify ↗
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tier progress ─────────────────────────────────────────────── */}
      {data && data.ownedAgents.length > 0 && isOwn && (
        <div className="mb-10 border border-ink/8 p-6">
          <h2 className="font-display text-xl mb-1">Rank progress</h2>
          <p className="text-xs text-ink/30 mb-5">
            Ranks are computed live from your on-chain record. A slash resets progress.
            {data.bestCalls.length > 0 && (
              <> Your best verified call: <span className={`font-mono ${data.bestCalls[0]!.pctReturn >= 0 ? "text-olive" : "text-terracotta"}`}>
                {data.bestCalls[0]!.pctReturn >= 0 ? "+" : ""}{data.bestCalls[0]!.pctReturn.toFixed(2)}%
              </span> on {data.bestCalls[0]!.marketId}.</>
            )}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["scout", "proven", "sentinel", "alpha"] as Tier[]).map(tier => {
              const m = TIER_META[tier];
              const best = data.ownedAgents.reduce<Tier | null>((top, a) => {
                const ranks: Tier[] = ["scout", "proven", "sentinel", "alpha"];
                if (!top) return a.tier;
                return ranks.indexOf(a.tier) > ranks.indexOf(top) ? a.tier : top;
              }, null);
              const ranks: Tier[] = ["scout", "proven", "sentinel", "alpha"];
              const achieved = best !== null && ranks.indexOf(best) >= ranks.indexOf(tier);
              return (
                <div key={tier} className={`p-3 border ${achieved ? m.border + " " + m.bg : "border-ink/8 bg-transparent opacity-40"}`}>
                  <p className={`text-[10px] font-mono uppercase tracking-widest mb-1 ${achieved ? m.color : "text-ink/30"}`}>
                    {m.label}
                  </p>
                  <p className="text-[10px] text-ink/40 leading-relaxed">{m.requires}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Following ──────────────────────────────────────────────────── */}
      {data && data.following.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-2xl mb-4">Copying</h2>
          <div className="border border-ink/10 divide-y divide-ink/5">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 text-[10px] font-mono text-ink/25 uppercase tracking-wider">
              <span>Agent</span>
              <span className="text-right">Copies</span>
              <span className="text-right">P&L</span>
              <span className="text-right">Last copy</span>
            </div>
            {data.following.map(f => (
              <Link
                key={f.erc8004Id}
                href={`/agent/${f.erc8004Id}`}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-3 hover:bg-ink/5 transition-colors"
              >
                <div>
                  <p className="text-sm text-ink">{f.name}</p>
                  <p className="text-[10px] font-mono text-ink/25">#{f.erc8004Id}</p>
                </div>
                <span className="text-xs font-mono text-ink/40 text-right">{f.copyCount}</span>
                <span className="text-right"><PnlChip v={f.totalPnlUsdc} /></span>
                <span className="text-xs font-mono text-ink/25 text-right">
                  {f.lastCopyAt ? new Date(f.lastCopyAt).toLocaleDateString() : "—"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {data && data.ownedAgents.length === 0 && data.following.length === 0 && (
        <div className="text-center py-16 border border-ink/8">
          <p className="text-ink/30 text-sm mb-6">
            {isOwn
              ? "You haven't created an agent or started copying yet."
              : "This wallet has no agents or copy activity on Phronos."}
          </p>
          {isOwn && (
            <div className="flex gap-3 justify-center">
              <Link href="/create-agent" className="btn-primary text-sm">Create your first agent</Link>
              <Link href="/leaderboard"  className="btn-ghost text-sm">Copy an agent</Link>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
