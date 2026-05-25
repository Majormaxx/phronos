import Link from "next/link";
import { db, intents, copies, agents, traces } from "@phronos/db";
import { eq } from "drizzle-orm";
import { arcscanAddress, resolveUrl } from "@phronos/shared";
import { notFound } from "next/navigation";

const AGENT_NAMES: Record<number, string> = {
  19297: "Momentum", 19298: "Mean Reversion", 19299: "Funding Rate", 19300: "Random Walk",
};

const VENUE_NAMES: Record<number, string> = {
  0: "Arc USDC Swap", 1: "Hyperliquid Perp", 2: "Polymarket",
};

export default async function TracePage({ params }: { params: { hash: string } }) {
  const hash = params.hash;

  const [intentRows, copyRows] = await Promise.all([
    db().select().from(intents).where(eq(intents.intentHash, hash)).limit(1),
    db().select().from(copies).where(eq(copies.intentHash, hash)),
  ]);

  const intent = intentRows[0];
  if (!intent) notFound();

  const [agentRows, traceRows] = await Promise.all([
    db().select().from(agents).where(eq(agents.erc8004Id, intent.erc8004Id)).limit(1),
    db().select().from(traces).where(eq(traces.intentHash, intent.traceCid)).limit(1),
  ]);
  const agent    = agentRows[0];
  const ipfsCid  = traceRows[0]?.traceCid ?? null;

  const isLong = Number(intent.notionalUsdc) >= 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link
        href={`/agent/${intent.erc8004Id}`}
        className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block"
      >
        ← {AGENT_NAMES[intent.erc8004Id] ?? `Agent #${intent.erc8004Id}`}
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <span className={`text-xs font-mono px-2 py-0.5 ${isLong ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
          {isLong ? "LONG" : "SHORT"}
        </span>
        <h1 className="font-display text-4xl">{intent.marketId}</h1>
      </div>
      <p className="text-xs font-mono text-ink/30 mb-8 break-all">{hash}</p>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Notional</p>
          <p className="font-mono text-lg">${(Math.abs(Number(intent.notionalUsdc)) / 1e6).toFixed(2)} USDC</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Venue</p>
          <p className="font-mono text-sm">{VENUE_NAMES[intent.venue] ?? `Venue ${intent.venue}`}</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Submitted</p>
          <p className="font-mono text-sm">{new Date(intent.submittedAt).toISOString().replace("T", " ").slice(0, 19)} UTC</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Valid until</p>
          <p className="font-mono text-sm">{new Date(intent.validUntil).toISOString().replace("T", " ").slice(0, 19)} UTC</p>
        </div>
      </div>

      {/* Trace */}
      <h2 className="font-display text-2xl mb-3">Replay trace</h2>
      <div className="card mb-10 space-y-3 text-xs font-mono">
        <div className="flex justify-between items-start">
          <span className="text-ink/40 shrink-0">Trace CID</span>
          {ipfsCid ? (
            <a
              href={resolveUrl(ipfsCid)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta hover:underline break-all text-right ml-4"
            >
              {ipfsCid} ↗
            </a>
          ) : (
            <span className="text-ink/80 break-all text-right ml-4">{intent.traceCid}</span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-ink/40">Strategy hash</span>
          <span className="text-ink/80 break-all text-right ml-4">{intent.strategyHash}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink/40">Block</span>
          <span className="text-ink/80">{intent.blockNumber.toLocaleString()}</span>
        </div>
        {agent && (
          <div className="flex justify-between">
            <span className="text-ink/40">Operator</span>
            <a
              href={arcscanAddress(agent.operatorAddr)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta hover:underline"
            >
              {agent.operatorAddr.slice(0, 14)}…↗
            </a>
          </div>
        )}
      </div>

      {/* Copies */}
      <h2 className="font-display text-2xl mb-3">Follower copies</h2>
      {copyRows.length === 0 ? (
        <p className="text-ink/30 text-sm mb-10">No copies for this intent.</p>
      ) : (
        <div className="space-y-2 mb-10">
          {copyRows.map((c) => (
            <div key={c.followerAddr} className="flex items-center justify-between py-3 border-b border-ink/5 text-xs font-mono">
              <a
                href={arcscanAddress(c.followerAddr)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-terracotta hover:underline"
              >
                {c.followerAddr.slice(0, 14)}…↗
              </a>
              <span className="text-ink/60">${(Number(c.followerNotional) / 1e6).toFixed(2)} USDC</span>
              <span className="text-ink/30">{new Date(c.executedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Link href={`/agent/${intent.erc8004Id}`} className="text-sm text-ink/40 hover:text-ink/70">
          ← Back to {AGENT_NAMES[intent.erc8004Id] ?? `Agent #${intent.erc8004Id}`}
        </Link>
      </div>
    </div>
  );
}
