"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { agentName, agentDesc } from "@/lib/agents";

type Agent = {
  erc8004Id: number;
  bondUsdc:  string;
  sharpe7d:  number;
  slashCount: number;
};

type Stats = {
  agents?:  number;
  copies?:  number;
  slashes?: number;
};

const POLL_MS = 10_000;

export function LiveLeaderboardPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/leaderboard").catch(() => null);
    if (res?.ok) setAgents(await res.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="mt-14 lg:mt-0 lg:w-80 shrink-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-mono text-ink/30 uppercase tracking-widest">
          Live · {agents.length > 0 ? `${agents.length} agents` : "—"}
        </p>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse" />
          <span className="text-xs text-ink/25 font-mono">on-chain</span>
        </span>
      </div>
      <div className="border border-ink/10 divide-y divide-ink/8 bg-surface">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[10px] font-mono text-ink/25 uppercase tracking-wider">
          <span>Agent</span>
          <span className="text-right">Bond</span>
          <span className="text-right w-14">7d Sharpe</span>
        </div>
        {!loaded
          ? [0, 1, 2, 3].map(i => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 animate-pulse">
                <div className="h-3 bg-ink/10 rounded w-24" />
                <div className="h-3 bg-ink/10 rounded w-10" />
                <div className="h-3 bg-ink/10 rounded w-10" />
              </div>
            ))
          : agents.map(a => {
              const sharpeStr = a.sharpe7d >= 0 ? `+${a.sharpe7d.toFixed(2)}` : a.sharpe7d.toFixed(2);
              const bond = (Number(a.bondUsdc) / 1e6).toFixed(2);
              return (
                <Link
                  key={a.erc8004Id}
                  href={`/agent/${a.erc8004Id}`}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 hover:bg-ink/5 transition-colors group"
                >
                  <div>
                    <p className="text-sm font-medium text-ink group-hover:text-olive transition-colors">
                      {agentName(a.erc8004Id)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-ink/30">{agentDesc(a.erc8004Id)}</p>
                      {a.sharpe7d < 0 && (
                        <span className="text-[9px] font-mono uppercase tracking-wider text-terracotta bg-terracotta/10 px-1 py-0.5 rounded">
                          at risk
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-ink/50 text-right">${bond}</span>
                  <span className={`text-xs font-mono tabular-nums text-right w-14 ${a.sharpe7d < 0 ? "text-terracotta" : "text-olive"}`}>
                    {sharpeStr}
                  </span>
                </Link>
              );
            })}
      </div>
      <p className="text-xs text-ink/20 mt-2 font-mono">7d Sharpe · updates every 15 min</p>
    </div>
  );
}

export function LiveStatBar() {
  const [stats, setStats] = useState<Stats>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [lbRes, sRes] = await Promise.allSettled([
      fetch("/api/leaderboard"),
      fetch("/api/stats"),
    ]);
    if (lbRes.status === "fulfilled" && lbRes.value.ok) setAgents(await lbRes.value.json());
    if (sRes.status  === "fulfilled" && sRes.value.ok)  setStats(await sRes.value.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const totalBond = agents.reduce((sum, a) => sum + Number(a.bondUsdc) / 1e6, 0);

  const rows = [
    { label: "Agents bonded", value: loaded ? String(stats.agents ?? agents.length) : "—" },
    { label: "USDC at stake", value: loaded && totalBond > 0 ? `$${totalBond.toFixed(2)}` : "—" },
    { label: "Copy trades",   value: loaded ? String(stats.copies  ?? 0) : "—" },
    { label: "Slash events",  value: loaded ? String(stats.slashes ?? 0) : "—" },
  ];

  return (
    <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
      {rows.map(({ label, value }) => (
        <div key={label}>
          <p className="font-display text-4xl text-ink mb-1 tabular-nums">{value}</p>
          <p className="text-xs text-ink/30 uppercase tracking-wide font-mono">{label}</p>
        </div>
      ))}
    </div>
  );
}
