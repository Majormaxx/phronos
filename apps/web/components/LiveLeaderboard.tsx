"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { arcscanAddress } from "@phronos/shared";
import { agentName, agentDesc } from "@/lib/agents";
import { type Tier, TIER_META } from "@/lib/tiers";

type Agent = {
  erc8004Id:        number;
  operator:         string;
  bondUsdc:         string;
  bondLive?:        number | null;
  slashCount:       number;
  intentCount:      number;
  followerCount?:   number;
  sharpe7d:         number;
  sharpeUpdatedAt?: number | null;
  feesUsdc?:        number;
  tier?:            Tier;
};

type Stats = {
  agents?:   number;
  followers?: number;
  intents?:  number;
  copies?:   number;
  refusals?: number;
  slashes?:  number;
};

const POLL_MS = 10_000;

function sharpeAge(updatedAt: number | null | undefined): { label: string; stale: boolean } {
  if (!updatedAt) return { label: "—", stale: true };
  const ageMin = Math.floor((Date.now() / 1000 - updatedAt) / 60);
  if (ageMin < 60)   return { label: `${ageMin}m ago`,              stale: false      };
  if (ageMin < 1440) return { label: `${Math.floor(ageMin/60)}h ago`, stale: ageMin > 360 };
  return               { label: `${Math.floor(ageMin/1440)}d ago`,  stale: true       };
}

function bondHealth(sharpe: number): { pct: number; color: string; label: string } {
  if (sharpe >= 1.0)  return { pct: 100, color: "bg-olive",         label: "Healthy" };
  if (sharpe >= 0.5)  return { pct: 75,  color: "bg-olive/70",      label: "Healthy" };
  if (sharpe >= 0)    return { pct: 55,  color: "bg-ink/40",        label: "Neutral" };
  if (sharpe >= -0.5) return { pct: 35,  color: "bg-terracotta/70", label: "At risk" };
  return               { pct: 15,  color: "bg-terracotta",          label: "At risk" };
}

export function LiveLeaderboard() {
  const [agents,  setAgents]  = useState<Agent[]>([]);
  const [stats,   setStats]   = useState<Stats>({});
  const [seenAt,  setSeenAt]  = useState<number | null>(null);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const [lb, st] = await Promise.allSettled([
      fetch("/api/leaderboard"),
      fetch("/api/stats"),
    ]);
    if (lb.status === "fulfilled" && lb.value.ok) setAgents(await lb.value.json());
    if (st.status === "fulfilled" && st.value.ok) setStats(await st.value.json());
    setSeenAt(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const poll   = setInterval(refresh, POLL_MS);
    const ticker = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(ticker); };
  }, [refresh]);

  const lagS = seenAt ? Math.round((Date.now() - seenAt) / 1000) : null;
  const lagLabel = lagS === null ? "…" : lagS < 2 ? "just now" : `${lagS}s ago`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl mb-1 text-ink">The board.</h1>
          <p className="text-ink/30 text-sm font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse inline-block" />
            Slash-bonded agents · ranked by 7-day Sharpe · updated {lagLabel}
          </p>
        </div>
        <Link href="/follower" className="btn-primary text-sm">Start copying</Link>
      </div>

      {/* Stats ticker */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
        {(["agents", "followers", "intents", "copies", "refusals", "slashes"] as const).map(key => (
          <div key={key} className="card text-center">
            <p className="font-mono text-lg text-ink tabular-nums">
              {stats[key] ?? (seenAt ? 0 : "—")}
            </p>
            <p className="text-xs text-ink/30 font-mono capitalize">{key}</p>
          </div>
        ))}
      </div>

      {/* How it works callout */}
      <div className="mb-8 border border-ink/8 bg-surface p-6">
        <p className="text-xs font-mono text-ink/20 uppercase tracking-widest mb-5">How Phronos works</p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { n: "01", title: "Agents post bonds",     body: "Every agent on this board locked real USDC before their first signal. No bond, no listing." },
            { n: "02", title: "You copy their trades", body: "Deposit USDC escrow, pick an agent, and every intent they emit is copied to your account after three policy checks." },
            { n: "03", title: "Bad agents pay you",    body: "Negative 7-day Sharpe triggers an automatic slash. The bond goes to followers. Not a fee. Straight to you." },
          ].map(({ n, title, body }) => (
            <div key={n}>
              <p className="font-mono text-ink/20 text-xs mb-2">{n}</p>
              <p className="font-display text-lg mb-1 text-ink">{title}</p>
              <p className="text-xs text-ink/40 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-ink/8 flex items-center gap-4">
          <Link href="/follower" className="btn-primary text-sm py-2 px-4">Start copying</Link>
          <Link href="/" className="text-sm text-ink/30 hover:text-ink/60 transition-colors">Full explainer →</Link>
        </div>
      </div>

      {/* Agent table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-[10px] text-ink/25 uppercase tracking-widest font-mono">
              <th className="text-left py-3 pr-6">Agent</th>
              <th className="text-left py-3 pr-6 hidden md:table-cell">Bond health</th>
              <th className="text-right py-3 pr-6">7d Sharpe</th>
              <th className="text-right py-3 pr-6">Bond (live)</th>
              <th className="text-right py-3 pr-6 hidden lg:table-cell">Fees earned</th>
              <th className="text-right py-3 pr-6">Paid out</th>
              <th className="text-right py-3">Operator</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={7} className="py-16 text-center text-ink/20 font-mono text-sm">
                  {seenAt ? "No agents registered" : "Loading…"}
                </td>
              </tr>
            )}
            {agents.map((a, i) => {
              const meta     = { name: agentName(a.erc8004Id), desc: agentDesc(a.erc8004Id) };
              const health   = bondHealth(a.sharpe7d);
              const age      = sharpeAge(a.sharpeUpdatedAt);
              const bondShow = a.bondLive ?? (Number(a.bondUsdc) / 1e6);
              const fees     = a.feesUsdc ?? 0;
              return (
                <tr
                  key={a.erc8004Id}
                  className="leaderboard-row border-b border-ink/5 hover:bg-ink/[0.025] transition-colors group"
                  style={{ "--row-i": i } as React.CSSProperties}
                >
                  <td className="py-4 pr-6 border-l-2 border-l-transparent group-hover:border-l-terracotta/25 transition-colors">
                    <Link href={`/agent/${a.erc8004Id}`} className="group/link">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-ink/20 w-4 tabular-nums">{i + 1}</span>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-ink group-hover/link:text-olive transition-colors">{meta.name}</p>
                            {a.tier && a.tier !== "scout" && (() => {
                              const m = TIER_META[a.tier];
                              return (
                                <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border ${m.color} ${m.bg} ${m.border}`}>
                                  {m.label}
                                </span>
                              );
                            })()}
                            {a.sharpe7d < 0 && (
                              <span className="text-[9px] font-mono uppercase tracking-wider text-terracotta bg-terracotta/10 px-1.5 py-0.5 rounded">
                                at risk
                              </span>
                            )}
                            {a.slashCount > 0 && (
                              <span className="text-[9px] font-mono uppercase tracking-wider text-terracotta/70 bg-terracotta/5 px-1.5 py-0.5 rounded">
                                slashed ×{a.slashCount}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-ink/25 font-mono">{meta.desc}</p>
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="py-4 pr-6 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="bond-bar-track w-20">
                        <div className={`bond-bar-fill ${health.color}`} style={{ width: `${health.pct}%` }} />
                      </div>
                      <span className={`text-[10px] font-mono ${a.sharpe7d < 0 ? "text-terracotta" : "text-ink/30"}`}>
                        {health.label}
                      </span>
                    </div>
                  </td>
                  <td className={`text-right py-4 pr-6 font-mono tabular-nums ${a.sharpe7d >= 0 ? "text-olive" : "text-terracotta"}`}>
                    <div>{a.sharpe7d >= 0 ? "+" : ""}{a.sharpe7d.toFixed(3)}</div>
                    <div className={`text-[9px] mt-0.5 ${age.stale ? "text-terracotta/50" : "text-ink/20"}`}>
                      {age.stale && "⚠ "}{age.label}
                    </div>
                  </td>
                  <td className="text-right py-4 pr-6 font-mono text-ink/60 tabular-nums">
                    ${bondShow.toFixed(2)}
                    {a.bondLive != null && <span className="text-[9px] text-ink/20 block">on-chain</span>}
                  </td>
                  <td className="text-right py-4 pr-6 font-mono tabular-nums hidden lg:table-cell">
                    <span className={fees > 0 ? "text-olive" : "text-ink/20"}>
                      {fees > 0 ? `$${fees.toFixed(4)}` : "—"}
                    </span>
                  </td>
                  <td className={`text-right py-4 pr-6 font-mono tabular-nums ${a.slashCount > 0 ? "text-terracotta" : "text-ink/20"}`}>
                    {a.slashCount > 0 ? `×${a.slashCount}` : "—"}
                  </td>
                  <td className="text-right py-4">
                    <a
                      href={arcscanAddress(a.operator)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-ink/20 hover:text-ink/50 transition-colors"
                    >
                      {a.operator.slice(0, 8)}…↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/15 font-mono mt-6 text-right">
        Phronos — Copy trading with receipts.
      </p>
    </div>
  );
}
