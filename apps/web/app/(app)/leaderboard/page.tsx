import Link from "next/link";
import { arcscanAddress } from "@phronos/shared";

async function getLeaderboard() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${base}/api/leaderboard`, { next: { revalidate: 30 } });
    return res.ok ? res.json() : [];
  } catch { return []; }
}

async function getStats() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${base}/api/stats`, { next: { revalidate: 10 } });
    return res.ok ? res.json() : {};
  } catch { return {}; }
}

type Agent = {
  erc8004Id: number; agentCardCid: string; operator: string;
  bondUsdc: string; slashCount: number; intentCount: number; sharpe7d: number;
};

const AGENT_NAMES: Record<number, string> = {
  19297: "Momentum",
  19298: "Mean Reversion",
  19299: "Funding Rate",
  19300: "Random Walk",
};

export default async function LeaderboardPage() {
  const [agents, stats] = await Promise.all([getLeaderboard(), getStats()]) as [Agent[], Record<string, number>];

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-5xl mb-1">Leaderboard</h1>
          <p className="text-ink/50 text-sm">
            Slash-bonded agents · ranked by 7-day Sharpe · weights updated every 15 min
          </p>
        </div>
        <Link href="/follower" className="btn-primary text-sm">Follow an agent</Link>
      </div>

      {/* Stats ticker */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
        {[
          { label: "Agents", value: stats.agents ?? 0 },
          { label: "Followers", value: stats.followers ?? 0 },
          { label: "Intents", value: stats.intents ?? 0 },
          { label: "Copies", value: stats.copies ?? 0 },
          { label: "Refusals", value: stats.refusals ?? 0 },
          { label: "Slashes", value: stats.slashes ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="card text-center">
            <p className="font-mono text-lg">{value}</p>
            <p className="text-xs text-ink/40">{label}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-xs text-ink/40 uppercase tracking-wide">
              <th className="text-left py-3 pr-6">Agent</th>
              <th className="text-right py-3 pr-6">7d Sharpe</th>
              <th className="text-right py-3 pr-6">Bond</th>
              <th className="text-right py-3 pr-6">Intents</th>
              <th className="text-right py-3 pr-6">Slashes</th>
              <th className="text-right py-3">Operator</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-ink/30">
                  No agents yet. Indexer syncing…
                </td>
              </tr>
            )}
            {agents.map((a) => (
              <tr key={a.erc8004Id} className="border-b border-ink/5 hover:bg-ink/2 transition-colors">
                <td className="py-4 pr-6">
                  <Link href={`/agent/${a.erc8004Id}`} className="hover:text-terracotta transition-colors">
                    <p className="font-medium">{AGENT_NAMES[a.erc8004Id] ?? `Agent #${a.erc8004Id}`}</p>
                    <p className="text-xs text-ink/30 font-mono">ERC-8004 #{a.erc8004Id}</p>
                  </Link>
                </td>
                <td className={`text-right py-4 pr-6 font-mono ${a.sharpe7d >= 0 ? "text-olive" : "text-terracotta"}`}>
                  {a.sharpe7d.toFixed(3)}
                </td>
                <td className="text-right py-4 pr-6 font-mono">
                  ${(Number(a.bondUsdc) / 1e6).toFixed(2)}
                </td>
                <td className="text-right py-4 pr-6 font-mono text-ink/60">{a.intentCount}</td>
                <td className={`text-right py-4 pr-6 font-mono ${a.slashCount > 0 ? "text-terracotta" : "text-ink/40"}`}>
                  {a.slashCount}
                </td>
                <td className="text-right py-4">
                  <a
                    href={arcscanAddress(a.operator)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-ink/30 hover:text-terracotta transition-colors"
                  >
                    {a.operator.slice(0, 8)}…↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
