import Link from "next/link";
import { db, intents, copies, refusals, agents, traces } from "@phronos/db";
import { eq } from "drizzle-orm";
import { rawSql } from "@phronos/db";
import { arcscanAddress, arcscanBlock, resolveUrl } from "@phronos/shared";
import { notFound } from "next/navigation";
import { agentName } from "@/lib/agents";
import { ShareButton } from "@/components/ShareButton";
import type { Metadata } from "next";

const VENUE_NAMES: Record<number, string> = {
  0: "Arc USDC Swap", 1: "Hyperliquid Perp", 2: "Polymarket",
};

const REFUSAL_REASONS: Record<number, { name: string; description: string; color: string }> = {
  1: { name: "LLM Judgment",       description: "Claude determined this intent conflicts with current market context or risk parameters.", color: "text-amber-600" },
  2: { name: "Macro Shift",        description: "BTC funding rate z-score exceeded policy threshold — abnormal macro conditions detected.", color: "text-terracotta" },
  3: { name: "Whale Contradiction", description: "Large on-chain wallet activity contradicts the trade direction at this size.",            color: "text-terracotta" },
};

async function getIntentData(hash: string) {
  const [intentRows, copyRows, refusalRows] = await Promise.all([
    db().select().from(intents).where(eq(intents.intentHash, hash)).limit(1),
    db().select().from(copies).where(eq(copies.intentHash, hash)),
    db().select().from(refusals).where(eq(refusals.intentHash, hash)),
  ]);
  const intent = intentRows[0];
  if (!intent) return null;

  const [agentRows, traceRows, metaRows] = await Promise.all([
    db().select().from(agents).where(eq(agents.erc8004Id, intent.erc8004Id)).limit(1),
    db().select().from(traces).where(eq(traces.intentHash, intent.traceCid)).limit(1),
    rawSql()`SELECT name FROM agent_metadata WHERE erc8004_id = ${intent.erc8004Id} LIMIT 1`,
  ]);

  return {
    intent, agent: agentRows[0], ipfsCid: traceRows[0]?.traceCid ?? null,
    copies: copyRows, refusals: refusalRows,
    agentDisplayName: (metaRows as Array<{name: string}>)[0]?.name ?? agentName(intent.erc8004Id),
  };
}

export async function generateMetadata({ params }: { params: { hash: string } }): Promise<Metadata> {
  const data = await getIntentData(params.hash);
  if (!data) return { title: "Intent not found — Phronos" };

  const { intent, agentDisplayName } = data;
  const isLong  = Number(intent.notionalUsdc) >= 0;
  const entry   = intent.entryPricePx ? Number(intent.entryPricePx) : null;
  const close   = intent.closePricePx ? Number(intent.closePricePx) : null;

  let pctStr = "";
  if (entry && close) {
    const pct = (close - entry) / entry * 100 * (isLong ? 1 : -1);
    pctStr = ` → ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }

  const title       = `${agentDisplayName}: ${isLong ? "LONG" : "SHORT"} ${intent.marketId}${pctStr} — verified on Phronos`;
  const description = entry
    ? `Entry $${entry.toLocaleString()}${close ? ` → close $${close.toLocaleString()}` : " (open)"}. Anchored at block ${intent.blockNumber.toLocaleString()} on Arc Testnet. Fully reproducible.`
    : `${isLong ? "LONG" : "SHORT"} ${intent.marketId} intent by ${agentDisplayName}. Anchored on Arc at block ${intent.blockNumber.toLocaleString()}.`;

  return {
    title,
    description,
    openGraph: { title, description, url: `https://phronos.xyz/traces/${params.hash}` },
    twitter:   { card: "summary", title, description },
  };
}

export default async function TracePage({ params }: { params: { hash: string } }) {
  const hash = params.hash;
  const data = await getIntentData(hash);
  if (!data) notFound();

  const { intent, agent, ipfsCid, copies: copyRows, refusals: refusalRows, agentDisplayName } = data;
  const isLong  = Number(intent.notionalUsdc) >= 0;
  const entry   = intent.entryPricePx ? Number(intent.entryPricePx)  : null;
  const close   = intent.closePricePx ? Number(intent.closePricePx)  : null;
  const pct     = (entry && close) ? (close - entry) / entry * 100 * (isLong ? 1 : -1) : null;
  const pnlGain = pct !== null && pct >= 0;
  const totalFollowerPnl = copyRows.reduce((s, c) => s + (c.pnlUsdc ? Number(c.pnlUsdc) : 0), 0);

  // Fetch IPFS trace content if available
  interface TraceContent {
    result?: { rationale?: string };
    snapshot?: { btcPrice?: number; ethPrice?: number; btcChange24h?: number; ethChange24h?: number };
    priceSource?: string; seed?: number;
  }
  let traceContent: TraceContent | null = null;
  if (ipfsCid && (ipfsCid.startsWith("Qm") || ipfsCid.startsWith("bafy"))) {
    try {
      const r = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsCid}`, { signal: AbortSignal.timeout(5000), next: { revalidate: 86400 } });
      if (r.ok) traceContent = await r.json();
    } catch {}
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <Link href={`/agent/${intent.erc8004Id}`} className="text-sm text-ink/40 hover:text-ink/70">
          ← {agentDisplayName}
        </Link>
        <ShareButton label="Share this call" />
      </div>

      {/* ── Call header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-2">
        <span className={`text-xs font-mono px-2 py-0.5 ${isLong ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
          {isLong ? "LONG" : "SHORT"}
        </span>
        <h1 className="font-display text-4xl">{intent.marketId}</h1>
      </div>
      <p className="text-xs font-mono text-ink/25 mb-8 break-all">{hash}</p>

      {/* ── P&L proof block — the social currency ────────────────────── */}
      {entry && (
        <div className={`mb-8 p-6 border ${pct !== null ? (pnlGain ? "border-olive/25 bg-olive/[0.03]" : "border-terracotta/25 bg-terracotta/[0.03]") : "border-ink/10 bg-surface"}`}>
          <p className="text-[10px] font-mono text-ink/25 uppercase tracking-widest mb-4">Verified performance</p>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-xs text-ink/30 mb-1">Entry</p>
              <p className="font-mono text-lg">${entry.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-xs text-ink/30 mb-1">Exit</p>
              {close
                ? <p className="font-mono text-lg">${close.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</p>
                : <p className="font-mono text-lg text-ink/30">open</p>
              }
            </div>
            <div>
              <p className="text-xs text-ink/30 mb-1">Return</p>
              {pct !== null
                ? <p className={`font-mono text-2xl font-medium ${pnlGain ? "text-olive" : "text-terracotta"}`}>
                    {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                  </p>
                : <p className="font-mono text-lg text-ink/25">pending</p>
              }
            </div>
          </div>
          {copyRows.some(c => c.pnlUsdc) && (
            <div className="mt-4 pt-4 border-t border-ink/8 flex items-center justify-between text-xs font-mono">
              <span className="text-ink/30">{copyRows.filter(c => c.pnlUsdc).length} followers earned</span>
              <span className={totalFollowerPnl >= 0 ? "text-olive" : "text-terracotta"}>
                {totalFollowerPnl >= 0 ? "+" : ""}${totalFollowerPnl.toFixed(4)} USDC total
              </span>
            </div>
          )}
          <p className="text-[10px] text-ink/15 font-mono mt-3 text-center">
            Prices from Hyperliquid · anchored at block {intent.blockNumber.toLocaleString()} on Arc Testnet
          </p>
        </div>
      )}

      {/* ── Key metrics ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-8">
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
          <p className="text-xs text-ink/40 mb-1">Copies executed</p>
          <p className="font-mono text-lg">{copyRows.length}</p>
        </div>
      </div>

      {/* ── Copy this agent CTA ───────────────────────────────────────── */}
      <div className="mb-8 p-5 border border-ink/10 bg-ink/[0.015] flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium mb-0.5">Copy {agentDisplayName}</p>
          <p className="text-xs text-ink/40">Follow this agent and get every future intent automatically.</p>
        </div>
        <Link href={`/agent/${intent.erc8004Id}`} className="btn-primary text-sm shrink-0">
          Copy agent →
        </Link>
      </div>

      {/* ── Strategy rationale ────────────────────────────────────────── */}
      {traceContent?.result?.rationale && (
        <div className="mb-8 p-5 border border-ink/10 bg-surface">
          <p className="text-[10px] font-mono text-ink/20 uppercase tracking-widest mb-3">Strategy rationale</p>
          <p className="font-mono text-sm text-ink/80 mb-4">{traceContent.result.rationale}</p>
          {traceContent.snapshot && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-ink/8 text-xs font-mono">
              {traceContent.snapshot.btcPrice != null && (
                <div><p className="text-ink/30 mb-0.5">BTC at signal</p><p>${traceContent.snapshot.btcPrice.toLocaleString()}</p></div>
              )}
              {traceContent.snapshot.ethPrice != null && (
                <div><p className="text-ink/30 mb-0.5">ETH at signal</p><p>${traceContent.snapshot.ethPrice.toLocaleString()}</p></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── On-chain proof ────────────────────────────────────────────── */}
      <h2 className="font-display text-2xl mb-3">On-chain proof</h2>
      <div className="card mb-8 space-y-3 text-xs font-mono">
        <div className="flex justify-between gap-4">
          <span className="text-ink/40 shrink-0">Block</span>
          <a href={arcscanBlock(intent.blockNumber)} target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline">
            {intent.blockNumber.toLocaleString()} ↗
          </a>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink/40 shrink-0">Trace CID</span>
          {ipfsCid && (ipfsCid.startsWith("Qm") || ipfsCid.startsWith("bafy"))
            ? <a href={resolveUrl(ipfsCid)} target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline break-all text-right">{ipfsCid} ↗</a>
            : <span className="text-ink/50 break-all text-right">{intent.traceCid}</span>
          }
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink/40 shrink-0">Strategy hash</span>
          <span className="text-ink/50 break-all text-right">{intent.strategyHash}</span>
        </div>
        {agent && (
          <div className="flex justify-between gap-4">
            <span className="text-ink/40 shrink-0">Operator</span>
            <a href={arcscanAddress(agent.operatorAddr)} target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline">
              {agent.operatorAddr} ↗
            </a>
          </div>
        )}
      </div>

      {/* ── Policy outcomes ───────────────────────────────────────────── */}
      {(copyRows.length > 0 || refusalRows.length > 0) && (
        <div className="mb-10">
          <h2 className="font-display text-2xl mb-3">Policy outcomes</h2>
          {copyRows.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-mono text-ink/30 uppercase tracking-widest mb-3">Copies ({copyRows.length})</p>
              <div className="space-y-0">
                {copyRows.map(c => (
                  <div key={c.followerAddr} className="flex items-center justify-between py-3 border-b border-ink/5 text-xs font-mono">
                    <a href={arcscanAddress(c.followerAddr)} target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline truncate max-w-[200px]">
                      {c.followerAddr.slice(0,12)}… ↗
                    </a>
                    <div className="flex items-center gap-4 ml-4 shrink-0">
                      <span className="text-ink/40">${(Number(c.followerNotional) / 1e6).toFixed(4)}</span>
                      {c.pnlUsdc !== null && (
                        <span className={Number(c.pnlUsdc) >= 0 ? "text-olive" : "text-terracotta"}>
                          {Number(c.pnlUsdc) >= 0 ? "+" : ""}${Number(c.pnlUsdc).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {refusalRows.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-ink/30 uppercase tracking-widest mb-3">Refused ({refusalRows.length})</p>
              <div className="space-y-2">
                {refusalRows.map(r => {
                  const reason = REFUSAL_REASONS[r.reason] ?? { name: `Code ${r.reason}`, description: "Unknown refusal reason.", color: "text-ink/40" };
                  return (
                    <div key={r.followerAddr} className="border border-ink/8 p-3 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-terracotta/60 border border-terracotta/20 px-1.5 py-0.5">REFUSED</span>
                        <span className={`font-medium ${reason.color}`}>{reason.name}</span>
                      </div>
                      <p className="text-ink/40">{reason.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <Link href={`/agent/${intent.erc8004Id}`} className="text-sm text-ink/40 hover:text-ink/70">
        ← Back to {agentDisplayName}
      </Link>
    </div>
  );
}
