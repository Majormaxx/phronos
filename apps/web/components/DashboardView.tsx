"use client";

import { useState } from "react";
import Link from "next/link";

interface AgentSummary {
  agentId: string;
  persona: string;
  weightBps: number;
  bondUSDC: string;
  sharpe7d: number;
  lastSignal: { direction: string; market: string; at: string } | null;
}

interface VaultState {
  navUSDC: string;
  usycPct: number;
  growthPct: number;
  totalFollowers: number;
  totalSlashed: string;
  lastRebalancedAt: string;
}

interface ActivityItem {
  kind: "rebalance" | "slash" | "regime" | "deposit";
  label: string;
  detail: string;
  at: string;
  positive?: boolean;
}

interface DashboardViewProps {
  address: string;
  shareBalance: string;
  shareValueUSDC: string;
  changeUSDC: string;
  changePositive: boolean;
  vault: VaultState;
  agents: AgentSummary[];
  activity: ActivityItem[];
}

export function DashboardView({
  address,
  shareBalance,
  shareValueUSDC,
  changeUSDC,
  changePositive,
  vault,
  agents,
  activity,
}: DashboardViewProps) {
  const [mode, setMode] = useState<"advisor" | "council">("advisor");
  const [updating] = useState(false);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-xs font-mono text-ink/40 mb-1 address">{address}</p>
          <h1 className="font-display text-4xl">Your balance</h1>
        </div>
        <div className="text-right">
          <button
            onClick={() => setMode(mode === "advisor" ? "council" : "advisor")}
            className="text-xs border border-ink/20 px-3 py-1.5 hover:border-ink/40 transition-colors"
          >
            {mode === "advisor" ? "Council view" : "Advisor view"}
          </button>
        </div>
      </div>

      {/* Balance card */}
      <div className="card mb-6">
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="text-5xl font-display">${shareValueUSDC}</p>
            <p className={`text-sm mt-1 ${changePositive ? "text-olive" : "text-terracotta"}`}>
              {changePositive ? "+" : "−"}${changeUSDC} all time
              {updating && <span className="text-ink/30 ml-2">(updating)</span>}
            </p>
          </div>
          <Link href="/dashboard/deposit" className="btn-primary text-sm">
            Add funds
          </Link>
        </div>

        {/* Allocation bar */}
        <div className="mb-2">
          <div className="flex h-2 w-full overflow-hidden">
            <div className="bg-terracotta h-full transition-all" style={{ width: `${vault.growthPct}%` }} />
            <div className="bg-olive h-full flex-1" />
          </div>
        </div>
        <div className="flex justify-between text-xs text-ink/50">
          <span>Growth strategies {vault.growthPct}%</span>
          <span>Protected funds {vault.usycPct}%</span>
        </div>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {[
          { label: "Last rebalanced", value: vault.lastRebalancedAt },
          { label: "Total depositors", value: vault.totalFollowers.toString() },
          { label: "Total redistributed", value: `$${vault.totalSlashed}` },
        ].map(({ label, value }) => (
          <div key={label} className="card">
            <p className="text-xs text-ink/40 mb-1">{label}</p>
            <p className="font-mono text-sm">{value}</p>
          </div>
        ))}
      </div>

      {/* Advisor mode */}
      {mode === "advisor" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl">Your council is active.</h2>
            <Link href="/bench" className="text-sm text-terracotta hover:underline">
              See decisions →
            </Link>
          </div>
          <div className="space-y-2">
            {activity.map((item, i) => (
              <div key={i} className="flex items-start justify-between py-3 border-b border-ink/5">
                <div>
                  <span className={`text-sm font-medium ${item.positive ? "text-olive" : "text-ink"}`}>
                    {item.label}
                  </span>
                  <span className="text-sm text-ink/50 ml-2">{item.detail}</span>
                </div>
                <span className="text-xs text-ink/30 font-mono whitespace-nowrap ml-4">{item.at}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Council mode */}
      {mode === "council" && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-2xl">The council</h2>
            <p className="text-xs text-ink/40">6 strategies · weights reset every 30 min</p>
          </div>
          <div className="space-y-3">
            {agents.map((a) => (
              <Link
                key={a.agentId}
                href={`/bench/${a.agentId}`}
                className="card flex items-center justify-between hover:border-terracotta/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="font-medium">{a.persona}</p>
                    <span className="text-xs font-mono text-ink/40">#{a.agentId}</span>
                  </div>
                  {a.lastSignal && (
                    <p className="text-xs text-ink/50">
                      {a.lastSignal.direction === "long" ? "↑" : a.lastSignal.direction === "short" ? "↓" : "—"}{" "}
                      {a.lastSignal.market} · {a.lastSignal.at}
                    </p>
                  )}
                </div>
                <div className="text-right ml-6">
                  <p className="font-mono text-sm">{(a.weightBps / 100).toFixed(0)}%</p>
                  <p className={`text-xs ${a.sharpe7d >= 0 ? "text-olive" : "text-terracotta"}`}>
                    Score {a.sharpe7d.toFixed(2)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
