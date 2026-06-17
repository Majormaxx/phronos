"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { arcscanAddress, arcscanBlock } from "@phronos/shared";
import { FollowButton } from "@/components/FollowButton";
import { ReplaySandbox } from "@/components/ReplaySandbox";
import { agentName, agentStrategy } from "@/lib/agents";

type IntentRow = {
  intentHash:   string;
  marketId:     string;
  notionalUsdc: string;
  venue:        number;
  traceCid:     string;
  submittedAt:  string;
  blockNumber:  number;
  entryPricePx: number | null;
  closePricePx: number | null;
  hlOrderId:    string | null;
};

type AgentData = {
  erc8004Id:       number;
  agentCardCid:    string;
  operator:        string;
  activeSince:     string;
  bondUsdc:        string;
  bondLive:        number | null;
  slashCount:      number;
  intentCount:     number;
  sharpe7d:        number;
  sharpeUpdatedAt: number | null;
  intents: IntentRow[];
  slashes: Array<{
    bps:          number;
    usdcReleased: string;
    sharpeAtEval: string;
    blockNumber:  number;
  }>;
};

type FundingData = {
  btcFunding: number;
  ethFunding: number;
  spread:     number;
  signal:     string;
  fetchedAt:  string;
} | null;

const POLL_MS         = 10_000;
const FUNDING_POLL_MS = 60_000;

export function LiveAgent({
  id,
  contracts,
}: {
  id: number;
  contracts: { registryAddr?: string; bondAddr?: string; routerAddr?: string };
}) {
  const [data,     setData]     = useState<AgentData | null>(null);
  const [funding,  setFunding]  = useState<FundingData>(null);
  const [notFound, setNotFound] = useState(false);
  const [, setTick] = useState(0);

  const refreshAgent = useCallback(async () => {
    const res = await fetch(`/api/agent/${id}`).catch(() => null);
    if (res?.status === 404) { setNotFound(true); return; }
    if (res?.ok) setData(await res.json());
  }, [id]);

  const refreshFunding = useCallback(async () => {
    if (id !== 22897) return;
    const res = await fetch("/api/market/funding").catch(() => null);
    if (res?.ok) setFunding(await res.json());
  }, [id]);

  useEffect(() => {
    refreshAgent();
    refreshFunding();
    const agentPoll   = setInterval(refreshAgent, POLL_MS);
    const fundingPoll = id === 22897 ? setInterval(refreshFunding, FUNDING_POLL_MS) : null;
    const ticker      = setInterval(() => setTick(t => t + 1), 1000);
    return () => {
      clearInterval(agentPoll);
      if (fundingPoll) clearInterval(fundingPoll);
      clearInterval(ticker);
    };
  }, [refreshAgent, refreshFunding, id]);

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-ink/40">Agent not found or not yet indexed.</p>
        <Link href="/leaderboard" className="text-terracotta text-sm mt-4 inline-block">← Leaderboard</Link>
      </div>
    );
  }

  const name     = agentName(id);
  const strategy = agentStrategy(id);
  const bondUsdc = data ? (data.bondLive ?? Number(data.bondUsdc) / 1e6) : null;
  const sharpe7d        = data?.sharpe7d ?? null;
  const sharpeUpdatedAt = data?.sharpeUpdatedAt ?? null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block">
        ← Leaderboard
      </Link>

      {/* Agent header */}
      <div className="mb-2">
        <h1 className="font-display text-5xl mb-1">{name}</h1>
        <p className="text-xs font-mono text-ink/30">
          ERC-8004 #{id}
          {contracts.registryAddr && (
            <a
              href={arcscanAddress(contracts.registryAddr)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 hover:text-terracotta"
            >↗</a>
          )}
        </p>
      </div>
      {strategy && <p className="text-sm text-ink/50 mb-8 mt-3 max-w-lg">{strategy}</p>}

      {/* Bond + Sharpe + Operator */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Bond (on-chain)</p>
          {bondUsdc === null
            ? <div className="h-6 bg-ink/10 rounded w-20 animate-pulse mt-1" />
            : <p className={`font-mono text-lg ${bondUsdc > 0 ? "" : "text-ink/30"}`}>${bondUsdc.toFixed(2)}</p>
          }
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">7d Sharpe</p>
          {sharpe7d === null
            ? <div className="h-6 bg-ink/10 rounded w-16 animate-pulse mt-1" />
            : <p className={`font-mono text-lg ${sharpe7d >= 0 ? "text-olive" : "text-terracotta"}`}>
                {sharpe7d !== 0 ? sharpe7d.toFixed(3) : <span className="text-ink/30">—</span>}
              </p>
          }
          <p className="text-xs text-ink/30 mt-1">
            {sharpeUpdatedAt != null
              ? (() => {
                  const ageMin = Math.floor((Date.now() / 1000 - sharpeUpdatedAt) / 60);
                  const stale  = ageMin > 360;
                  return (
                    <span className={stale ? "text-terracotta/60" : ""}>
                      {stale ? "⚠ stale · " : ""}Updated {ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h`} ago
                    </span>
                  );
                })()
              : "from SlashOracle"
            }
          </p>
        </div>
        <div className="card col-span-2">
          <p className="text-xs text-ink/40 mb-1">Operator</p>
          {!data
            ? <div className="h-4 bg-ink/10 rounded w-48 animate-pulse" />
            : (
              <a
                href={arcscanAddress(data.operator)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-terracotta hover:underline break-all"
              >
                {data.operator.slice(0, 14)}…↗
              </a>
            )
          }
          <p className="text-xs text-ink/30 mt-1">
            {data ? `Since ${new Date(data.activeSince).toLocaleDateString()}` : "—"}
          </p>
        </div>
      </div>

      {/* Hyperliquid live funding rates — Funding Rate agent only */}
      {id === 22897 && funding && (
        <div className="mb-6 border border-ink/10 p-4 bg-surface">
          <p className="text-[10px] font-mono text-ink/20 uppercase tracking-widest mb-3">
            Hyperliquid perp funding · live signal
          </p>
          <div className="grid grid-cols-3 gap-4 text-xs font-mono mb-3">
            <div>
              <p className="text-ink/30 mb-0.5">ETH funding/hr</p>
              <p className={`text-base ${funding.ethFunding > 0 ? "text-olive" : "text-terracotta"}`}>
                {funding.ethFunding >= 0 ? "+" : ""}{(funding.ethFunding * 100).toFixed(4)}%
              </p>
            </div>
            <div>
              <p className="text-ink/30 mb-0.5">BTC funding/hr</p>
              <p className={`text-base ${funding.btcFunding > 0 ? "text-olive" : "text-terracotta"}`}>
                {funding.btcFunding >= 0 ? "+" : ""}{(funding.btcFunding * 100).toFixed(4)}%
              </p>
            </div>
            <div>
              <p className="text-ink/30 mb-0.5">Spread (ETH−BTC)</p>
              <p className={`text-base font-medium ${funding.spread > 0 ? "text-olive" : "text-terracotta"}`}>
                {funding.spread >= 0 ? "+" : ""}{(funding.spread * 100).toFixed(4)}%
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-ink/8">
            <span className={`text-xs px-2 py-0.5 font-mono ${funding.signal === "LONG_ETH" ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
              {funding.signal === "LONG_ETH" ? "LONG ETH" : "LONG BTC"}
            </span>
            <span className="text-xs text-ink/30">
              current signal · {new Date(funding.fetchedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Slash summary badge */}
      {data && data.slashes.length > 0 && (
        <div className="mb-6 px-4 py-3 border border-terracotta/20 bg-terracotta/5 flex items-center gap-3">
          <span className="text-terracotta text-sm font-medium">
            {data.slashes.length} slash event{data.slashes.length > 1 ? "s" : ""}
          </span>
          <span className="text-xs text-ink/40">
            — ${data.slashes.reduce((sum, s) => sum + Number(s.usdcReleased) / 1e6, 0).toFixed(2)} USDC redistributed to followers
          </span>
        </div>
      )}

      {/* Follow CTA */}
      <div className="mb-10 p-5 border border-ink/10 bg-ink/[0.015]">
        <p className="text-sm font-medium mb-1">Copy this agent</p>
        <p className="text-xs text-ink/40 mb-4">
          Every signed intent this agent emits will be screened by three policies and copied to your escrow automatically.
        </p>
        <FollowButton erc8004Id={id} agentName={name} />
      </div>

      {/* Contract addresses */}
      <div className="mb-8 space-y-1 text-xs text-ink/30 font-mono">
        {contracts.registryAddr && (
          <p>Registry: <a href={arcscanAddress(contracts.registryAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{contracts.registryAddr}↗</a></p>
        )}
        {contracts.bondAddr && (
          <p>Bond:&nbsp;&nbsp;&nbsp;&nbsp;<a href={arcscanAddress(contracts.bondAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{contracts.bondAddr}↗</a></p>
        )}
        {contracts.routerAddr && (
          <p>Router:&nbsp;&nbsp;<a href={arcscanAddress(contracts.routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{contracts.routerAddr}↗</a></p>
        )}
      </div>

      {/* Slash history */}
      {data && data.slashes.length > 0 && (
        <div className="mb-12">
          <h2 className="font-display text-2xl mb-4">Performance penalties</h2>
          <div className="space-y-0">
            {data.slashes.map((s) => (
              <div key={`${id}-${s.blockNumber}`} className="py-4 border-b border-ink/5">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-sm font-medium text-terracotta">
                    {(s.bps / 100).toFixed(2)}% of bond slashed
                  </span>
                  <a
                    href={arcscanBlock(s.blockNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-ink/30 hover:text-terracotta"
                  >
                    block {s.blockNumber.toLocaleString()} ↗
                  </a>
                </div>
                <div className="flex items-center gap-4 text-xs text-ink/50">
                  <span>${(Number(s.usdcReleased) / 1e6).toFixed(4)} USDC to followers</span>
                  <span className="font-mono">
                    Sharpe at eval:&nbsp;
                    <span className={Number(s.sharpeAtEval) < 0 ? "text-terracotta" : "text-olive"}>
                      {Number(s.sharpeAtEval) !== 0 ? Number(s.sharpeAtEval).toFixed(3) : "—"}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intent stream */}
      <h2 className="font-display text-2xl mb-4">Intent stream</h2>
      <div className="space-y-0 mb-12">
        {!data && (
          <>
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-ink/5 animate-pulse">
                <div className="h-5 bg-ink/10 rounded w-40" />
                <div className="h-4 bg-ink/10 rounded w-24" />
              </div>
            ))}
          </>
        )}
        {data && data.intents.length === 0 && (
          <p className="text-ink/30 text-sm py-4">No intents indexed yet.</p>
        )}
        {data?.intents.map((i) => {
          const isLong   = Number(i.notionalUsdc) >= 0;
          const notional = (Math.abs(Number(i.notionalUsdc)) / 1e6).toFixed(2);
          const entry    = i.entryPricePx;
          const close    = i.closePricePx;
          const isLive   = !!i.hlOrderId;

          // Compute P&L if we have both entry and close prices
          let pnlEl: React.ReactNode = null;
          if (entry && close) {
            const pct       = (close - entry) / entry * 100 * (isLong ? 1 : -1);
            const pnlUsdc   = pct / 100 * Number(notional);
            const pnlColor  = pnlUsdc >= 0 ? "text-olive" : "text-terracotta";
            pnlEl = (
              <span className={`text-xs font-mono tabular-nums ${pnlColor}`}>
                {pnlUsdc >= 0 ? "+" : ""}{pnlUsdc.toFixed(4)} USDC
              </span>
            );
          } else if (entry && !close && isLive) {
            pnlEl = <span className="text-xs text-ink/25 font-mono">open</span>;
          }

          return (
            <div key={i.intentHash} className="py-3 border-b border-ink/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-xs font-mono px-2 py-0.5 shrink-0 ${isLong ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                    {isLong ? "LONG" : "SHORT"}
                  </span>
                  <span className="font-mono text-sm">{i.marketId}</span>
                  <span className="text-ink/40 text-xs font-mono hidden sm:inline">
                    ${notional}
                  </span>
                  {isLive && (
                    <span className="text-[9px] font-mono text-olive/60 uppercase tracking-wider hidden sm:inline">
                      HL live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0 ml-3">
                  {pnlEl}
                  <span className="text-xs text-ink/25 font-mono hidden sm:inline">
                    {new Date(i.submittedAt).toLocaleTimeString()}
                  </span>
                  <Link
                    href={`/traces/${i.intentHash}`}
                    className="text-xs text-ink/30 hover:text-terracotta font-mono transition-colors"
                  >
                    {i.intentHash.slice(0, 10)}… ↗
                  </Link>
                </div>
              </div>
              {entry && (
                <div className="flex items-center gap-4 mt-1 text-[10px] font-mono text-ink/25">
                  <span>entry ${entry.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                  {close && <span>→ close ${close.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Replay sandbox */}
      <h2 className="font-display text-2xl mb-4">Replay sandbox</h2>
      <p className="text-sm text-ink/50 mb-4">
        Run the strategy deterministically with a custom seed. The same seed always produces the same intent hash — verifiable on-chain.
      </p>
      <ReplaySandbox agentId={id} />
    </div>
  );
}
