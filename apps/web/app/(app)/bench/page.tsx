import Link from "next/link";

async function getBench() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${base}/api/bench`, { next: { revalidate: 60 } });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

export default async function BenchPage() {
  const agents = await getBench() as Array<{
    agentId: string;
    persona: string;
    weightBps: number;
    bondUSDC: string;
    sharpe24h: number;
    sharpe7d: number;
    lastSignal: { direction: string; market: string; at: string } | null;
  }>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl mb-2">The council</h1>
          <p className="text-ink/50">Six certified strategies. Weights reset every 30 minutes.</p>
        </div>
        <Link href="/dashboard" className="text-sm text-ink/40 hover:text-ink/70 transition-colors">
          ← Dashboard
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-xs text-ink/40 uppercase tracking-wide">
              <th className="text-left py-3 pr-6">Strategy</th>
              <th className="text-right py-3 pr-6">Weight</th>
              <th className="text-right py-3 pr-6">Skin in the game</th>
              <th className="text-right py-3 pr-6">24h score</th>
              <th className="text-right py-3 pr-6">7d score</th>
              <th className="text-right py-3">Last signal</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-ink/30">
                  No strategies admitted yet.
                </td>
              </tr>
            )}
            {agents.map((a) => (
              <tr key={a.agentId} className="border-b border-ink/5 hover:bg-ink/2 transition-colors">
                <td className="py-4 pr-6">
                  <Link href={`/bench/${a.agentId}`} className="hover:text-terracotta transition-colors">
                    <p className="font-medium">{a.persona}</p>
                    <p className="text-xs text-ink/30 font-mono">#{a.agentId}</p>
                  </Link>
                </td>
                <td className="text-right py-4 pr-6 font-mono">
                  {(a.weightBps / 100).toFixed(0)}%
                </td>
                <td className="text-right py-4 pr-6 font-mono">${a.bondUSDC}</td>
                <td className={`text-right py-4 pr-6 font-mono ${a.sharpe24h >= 0 ? "text-olive" : "text-terracotta"}`}>
                  {a.sharpe24h.toFixed(2)}
                </td>
                <td className={`text-right py-4 pr-6 font-mono ${a.sharpe7d >= 0 ? "text-olive" : "text-terracotta"}`}>
                  {a.sharpe7d.toFixed(2)}
                </td>
                <td className="text-right py-4 text-ink/40 text-xs">
                  {a.lastSignal
                    ? `${a.lastSignal.direction} ${a.lastSignal.market} · ${a.lastSignal.at}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
