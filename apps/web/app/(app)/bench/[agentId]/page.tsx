import Link from "next/link";
import { db, signals, slashes, agents } from "@phronos/db";
import { eq, desc } from "drizzle-orm";

export default async function AgentPage({ params }: { params: { agentId: string } }) {
  const { agentId } = params;

  const [agentRows, recentSignals, recentSlashes] = await Promise.all([
    db().select().from(agents).where(eq(agents.agentId, agentId)).limit(1),
    db()
      .select()
      .from(signals)
      .where(eq(signals.agentId, agentId))
      .orderBy(desc(signals.createdAt))
      .limit(50),
    db()
      .select()
      .from(slashes)
      .where(eq(slashes.agentId, agentId))
      .orderBy(desc(slashes.createdAt))
      .limit(10),
  ]);

  const agent = agentRows[0];

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-ink/40">Strategy not found.</p>
        <Link href="/bench" className="text-terracotta text-sm mt-4 inline-block">← Back to bench</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/bench" className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block">
        ← Back to bench
      </Link>

      <h1 className="font-display text-5xl mb-1">{agent.persona}</h1>
      <p className="text-xs font-mono text-ink/30 mb-8">Agent #{agentId}</p>

      {/* Signal stream */}
      <h2 className="font-display text-2xl mb-4">Signal stream</h2>
      <div className="space-y-2 mb-12">
        {recentSignals.length === 0 && (
          <p className="text-ink/30 text-sm">No signals yet.</p>
        )}
        {recentSignals.map((s) => (
          <div key={s.id} className="flex items-start justify-between py-3 border-b border-ink/5">
            <div>
              <span
                className={`text-xs font-mono px-2 py-0.5 mr-3 ${
                  s.direction === "long"
                    ? "bg-olive/15 text-olive"
                    : s.direction === "short"
                    ? "bg-terracotta/15 text-terracotta"
                    : "bg-ink/10 text-ink/50"
                }`}
              >
                {s.direction.toUpperCase()}
              </span>
              <span className="font-mono text-sm">{s.marketSymbol}</span>
              <span className="text-ink/50 text-sm ml-3">{s.rationale?.slice(0, 100)}</span>
            </div>
            <div className="text-right ml-4 shrink-0">
              <p className="font-mono text-xs text-ink/30">
                {s.conviction !== null ? `${(s.conviction * 100).toFixed(0)}% conviction` : ""}
              </p>
              {s.ipfsCid && (
                <a
                  href={`https://w3s.link/ipfs/${s.ipfsCid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-terracotta/70 hover:text-terracotta"
                >
                  record ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Redistribution history */}
      {recentSlashes.length > 0 && (
        <>
          <h2 className="font-display text-2xl mb-4">Performance penalties</h2>
          <div className="space-y-2">
            {recentSlashes.map((sl) => (
              <div key={sl.id} className="flex items-center justify-between py-3 border-b border-ink/5">
                <div>
                  <span className="text-sm">{sl.bps / 100}% of stake redistributed</span>
                  {sl.sharpeAtSlash !== null && (
                    <span className="text-xs text-ink/40 ml-2">
                      — score was {sl.sharpeAtSlash.toFixed(2)}
                    </span>
                  )}
                </div>
                {sl.txHash && (
                  <a
                    href={`https://scan.testnet.arc.network/tx/${sl.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-terracotta/70 hover:text-terracotta font-mono"
                  >
                    Arcscan ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
