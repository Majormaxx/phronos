import Link from "next/link";
import { db, intents, copies, refusals, agents, traces } from "@phronos/db";
import { eq } from "drizzle-orm";
import { arcscanAddress, arcscanBlock, resolveUrl } from "@phronos/shared";
import { notFound } from "next/navigation";

import { agentName } from "@/lib/agents";

const VENUE_NAMES: Record<number, string> = {
  0: "Arc USDC Swap", 1: "Hyperliquid Perp", 2: "Polymarket",
};

const REFUSAL_REASONS: Record<number, { name: string; description: string; color: string }> = {
  1: {
    name:        "LLM Judgment",
    description: "Claude determined this intent conflicts with current market context or risk parameters.",
    color:       "text-amber-600",
  },
  2: {
    name:        "Macro Shift",
    description: "BTC funding rate z-score exceeded policy threshold — abnormal macro conditions detected.",
    color:       "text-terracotta",
  },
  3: {
    name:        "Whale Contradiction",
    description: "Large on-chain wallet activity contradicts the trade direction at this size.",
    color:       "text-terracotta",
  },
};

export default async function TracePage({ params }: { params: { hash: string } }) {
  const hash = params.hash;

  const [intentRows, copyRows, refusalRows] = await Promise.all([
    db().select().from(intents).where(eq(intents.intentHash, hash)).limit(1),
    db().select().from(copies).where(eq(copies.intentHash, hash)),
    db().select().from(refusals).where(eq(refusals.intentHash, hash)),
  ]);

  const intent = intentRows[0];
  if (!intent) notFound();

  const [agentRows, traceRows] = await Promise.all([
    db().select().from(agents).where(eq(agents.erc8004Id, intent.erc8004Id)).limit(1),
    db().select().from(traces).where(eq(traces.intentHash, intent.traceCid)).limit(1),
  ]);

  const agent   = agentRows[0];
  const ipfsCid = traceRows[0]?.traceCid ?? null;
  const isLong  = Number(intent.notionalUsdc) >= 0;

  // Fetch trace content from IPFS if we have a real CID (Qm... or bafy...)
  interface TraceContent {
    result?:   { rationale?: string; marketId?: string; notional?: number };
    snapshot?: { btcPrice?: number; ethPrice?: number; btcChange24h?: number; ethChange24h?: number };
    priceSource?: string;
    seed?: number;
  }
  let traceContent: TraceContent | null = null;
  if (ipfsCid && (ipfsCid.startsWith("Qm") || ipfsCid.startsWith("bafy"))) {
    try {
      const r = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsCid}`, {
        signal: AbortSignal.timeout(5000),
        next:   { revalidate: 86400 },
      });
      if (r.ok) traceContent = await r.json();
    } catch { /* IPFS unavailable — degrade gracefully */ }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link
        href={`/agent/${intent.erc8004Id}`}
        className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block"
      >
        ← {agentName(intent.erc8004Id)}
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

      {/* Trace rationale — inline IPFS content */}
      {traceContent?.result?.rationale && (
        <div className="mb-8 p-5 border border-ink/10 bg-surface">
          <p className="text-[10px] font-mono text-ink/20 uppercase tracking-widest mb-3">Strategy rationale</p>
          <p className="font-mono text-sm text-ink/80 mb-4">{traceContent.result.rationale}</p>
          {traceContent.snapshot && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-ink/8 text-xs font-mono">
              {traceContent.snapshot.btcPrice != null && (
                <div>
                  <p className="text-ink/30 mb-0.5">BTC at signal</p>
                  <p>${traceContent.snapshot.btcPrice.toLocaleString()}</p>
                </div>
              )}
              {traceContent.snapshot.ethPrice != null && (
                <div>
                  <p className="text-ink/30 mb-0.5">ETH at signal</p>
                  <p>${traceContent.snapshot.ethPrice.toLocaleString()}</p>
                </div>
              )}
              {traceContent.snapshot.btcChange24h != null && (
                <div>
                  <p className="text-ink/30 mb-0.5">BTC 24h Δ</p>
                  <p className={traceContent.snapshot.btcChange24h >= 0 ? "text-olive" : "text-terracotta"}>
                    {traceContent.snapshot.btcChange24h >= 0 ? "+" : ""}{(traceContent.snapshot.btcChange24h * 100).toFixed(2)}%
                  </p>
                </div>
              )}
              {traceContent.snapshot.ethChange24h != null && (
                <div>
                  <p className="text-ink/30 mb-0.5">ETH 24h Δ</p>
                  <p className={traceContent.snapshot.ethChange24h >= 0 ? "text-olive" : "text-terracotta"}>
                    {traceContent.snapshot.ethChange24h >= 0 ? "+" : ""}{(traceContent.snapshot.ethChange24h * 100).toFixed(2)}%
                  </p>
                </div>
              )}
            </div>
          )}
          {traceContent.priceSource && (
            <p className="text-[10px] text-ink/15 font-mono mt-3">
              Price source: {traceContent.priceSource}
              {traceContent.seed != null && ` · seed: ${traceContent.seed}`}
            </p>
          )}
        </div>
      )}

      {/* Replay trace */}
      <h2 className="font-display text-2xl mb-3">Replay trace</h2>
      <div className="card mb-10 space-y-3 text-xs font-mono">
        <div className="flex justify-between items-start gap-4">
          <span className="text-ink/40 shrink-0">Trace CID</span>
          {ipfsCid ? (
            <a
              href={resolveUrl(ipfsCid)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta hover:underline break-all text-right"
            >
              {ipfsCid} ↗
            </a>
          ) : (
            <span className="text-ink/70 break-all text-right">{intent.traceCid}</span>
          )}
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink/40 shrink-0">Strategy hash</span>
          <span className="text-ink/70 break-all text-right">{intent.strategyHash}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink/40 shrink-0">Block</span>
          <a
            href={arcscanBlock(intent.blockNumber)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-terracotta hover:underline"
          >
            {intent.blockNumber.toLocaleString()} ↗
          </a>
        </div>
        {agent && (
          <div className="flex justify-between gap-4">
            <span className="text-ink/40 shrink-0">Operator</span>
            <a
              href={arcscanAddress(agent.operatorAddr)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta hover:underline"
            >
              {agent.operatorAddr} ↗
            </a>
          </div>
        )}
      </div>

      {/* Policy outcomes */}
      <div className="mb-10">
        <h2 className="font-display text-2xl mb-3">Policy outcomes</h2>

        {copyRows.length === 0 && refusalRows.length === 0 && (
          <p className="text-ink/30 text-sm">No copy or refusal records for this intent yet.</p>
        )}

        {/* Copies */}
        {copyRows.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-mono text-ink/30 uppercase tracking-widest mb-3">
              Copies executed ({copyRows.length})
            </p>
            <div className="space-y-0">
              {copyRows.map((c) => (
                <div key={c.followerAddr} className="flex items-center justify-between py-3 border-b border-ink/5 text-xs font-mono">
                  <a
                    href={arcscanAddress(c.followerAddr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-terracotta hover:underline"
                  >
                    {c.followerAddr} ↗
                  </a>
                  <div className="flex items-center gap-4 ml-4 shrink-0">
                    <span className="text-olive">${(Number(c.followerNotional) / 1e6).toFixed(4)}</span>
                    <span className="text-ink/30">{new Date(c.executedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Refusals */}
        {refusalRows.length > 0 && (
          <div>
            <p className="text-xs font-mono text-ink/30 uppercase tracking-widest mb-3">
              Copies refused ({refusalRows.length})
            </p>
            <div className="space-y-3">
              {refusalRows.map((r) => {
                const reason = REFUSAL_REASONS[r.reason] ?? { name: `Code ${r.reason}`, description: "Unknown refusal reason.", color: "text-ink/40" };
                return (
                  <div key={r.followerAddr} className="border border-ink/8 p-4 bg-ink/[0.015]">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-terracotta/60 px-1.5 py-0.5 border border-terracotta/20">REFUSED</span>
                        <span className={`text-sm font-medium ${reason.color}`}>{reason.name}</span>
                      </div>
                      <span className="text-xs font-mono text-ink/25 shrink-0">
                        {new Date(r.refusedAt).toISOString().replace("T", " ").slice(0, 16)} UTC
                      </span>
                    </div>
                    <p className="text-xs text-ink/50 mb-3 leading-relaxed">{reason.description}</p>
                    <div className="text-xs font-mono space-y-1 text-ink/30">
                      <div className="flex justify-between gap-4">
                        <span>Follower</span>
                        <a
                          href={arcscanAddress(r.followerAddr)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-terracotta hover:underline truncate text-right"
                        >
                          {r.followerAddr} ↗
                        </a>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>Reason hash</span>
                        <span className="text-ink/40 truncate text-right">{r.reasonCid.slice(0, 30)}…</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Link href={`/agent/${intent.erc8004Id}`} className="text-sm text-ink/40 hover:text-ink/70">
          ← Back to {agentName(intent.erc8004Id)}
        </Link>
      </div>
    </div>
  );
}
