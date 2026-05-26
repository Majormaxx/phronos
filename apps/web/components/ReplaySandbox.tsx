"use client";

import { useState } from "react";

interface ReplayResult {
  intentHash:      string;
  traceCID:        string;
  agentId:         number;
  seed:            number;
  snapshot:        { btcPrice: number; ethPrice: number; btcChange24h: number; ethChange24h: number };
  result:          { marketId: string; notional: number; rationale: string };
  priceSource:     string;
  replayedAt:      string;
}

function randomSeed() {
  return Math.floor(Math.random() * 999999) + 1;
}

export function ReplaySandbox({ agentId }: { agentId: number }) {
  const [seed,    setSeed]    = useState(() => randomSeed());
  const [result,  setResult]  = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const snapshotHash = `0x${seed.toString(16).padStart(64, "0")}` as `0x${string}`;
      const res = await fetch("/api/replay/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ agentId, snapshotHash, seed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Replay failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isLong = result && result.result.notional >= 0;

  return (
    <div className="card">
      <p className="text-xs font-mono text-ink/30 uppercase tracking-widest mb-4">Deterministic replay</p>

      <div className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="text-xs text-ink/40 block mb-1.5">Seed</label>
          <input
            type="number"
            value={seed}
            min={1}
            onChange={e => { setSeed(parseInt(e.target.value) || 1); setResult(null); }}
            className="w-full border border-ink/10 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-ink/30"
          />
        </div>
        <button
          onClick={() => { setSeed(randomSeed()); setResult(null); }}
          className="btn-ghost text-sm py-2 px-3 shrink-0 font-mono"
          title="New random seed"
        >
          ↺
        </button>
        <button
          onClick={run}
          disabled={loading}
          className="btn-primary text-sm py-2 px-5 shrink-0 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run replay"}
        </button>
      </div>

      <p className="text-xs text-ink/30 mb-4">
        Re-executes the strategy against live prices. Same seed always produces the same intent hash — that&apos;s the replay guarantee.
      </p>

      {error && <p className="text-xs text-terracotta mb-3">{error}</p>}

      {result && (
        <div className="border-t border-ink/8 pt-4 space-y-4">
          {/* Decision */}
          <div className="flex items-center gap-3">
            <span className={`text-xs font-mono px-2 py-0.5 ${isLong ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
              {isLong ? "LONG" : "SHORT"}
            </span>
            <span className="font-medium">{result.result.marketId}</span>
            <span className="font-mono text-ink/60">${(Math.abs(result.result.notional) / 1e6).toFixed(2)} USDC</span>
          </div>

          {/* Rationale */}
          <p className="text-sm text-ink/60 leading-relaxed">{result.result.rationale}</p>

          {/* Proof hashes */}
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between gap-4">
              <span className="text-ink/40 shrink-0">Intent hash</span>
              <span className="text-ink/70 break-all text-right">{result.intentHash}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink/40 shrink-0">Trace CID</span>
              <span className="text-ink/70 break-all text-right">{result.traceCID}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink/40 shrink-0">BTC</span>
              <span className="text-ink/70">
                ${result.snapshot.btcPrice.toLocaleString()}&nbsp;
                <span className={result.snapshot.btcChange24h >= 0 ? "text-olive" : "text-terracotta"}>
                  {result.snapshot.btcChange24h >= 0 ? "+" : ""}{(result.snapshot.btcChange24h * 100).toFixed(2)}%
                </span>
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink/40 shrink-0">Price source</span>
              <span className={result.priceSource === "coingecko-live" ? "text-olive" : "text-terracotta/80"}>
                {result.priceSource}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
