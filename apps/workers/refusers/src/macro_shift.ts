import { keccak256, toHex } from "viem";
import type { IntentContext, RefuserResult } from "./llm_judgment.js";

// Testnet threshold: 0.1σ — fires on any minor funding drift for demo visibility.
// Production value would be 2.0σ.
const SHIFT_SIGMA = 0.1;

// Static fallback only used if Hyperliquid is completely unreachable
const STATIC_BASELINE = 0.00008;
const STATIC_STDDEV   = 0.00004;

interface FundingStats {
  mean:    number;
  stddev:  number;
  samples: number;
  source:  "live" | "static-fallback";
}

async function fetchFundingStats24h(): Promise<FundingStats> {
  const startTime = Date.now() - 24 * 60 * 60 * 1000;
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ type: "fundingHistory", coin: "BTC", startTime }),
    signal:  AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Hyperliquid fundingHistory ${res.status}`);
  const rows = await res.json() as Array<{ fundingRate: string; time: number }>;
  if (!rows.length) throw new Error("fundingHistory returned empty");

  const rates = rows.map(r => Math.abs(parseFloat(r.fundingRate)));
  const mean  = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rates.length;
  return { mean, stddev: Math.sqrt(variance), samples: rates.length, source: "live" };
}

async function fetchCurrentFunding(): Promise<number> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal:  AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Hyperliquid metaAndAssetCtxs ${res.status}`);
  const data = await res.json() as [unknown, Array<{ funding: string }>];
  return Math.abs(parseFloat(data[1]?.[0]?.funding ?? "0"));
}

export async function macroShift(intent: IntentContext): Promise<RefuserResult> {
  let stats: FundingStats;
  let current: number;

  try {
    [stats, current] = await Promise.all([fetchFundingStats24h(), fetchCurrentFunding()]);
  } catch (err) {
    console.warn("[macro_shift] Hyperliquid unavailable, using static baseline:", (err as Error).message);
    // Fall back to static values — still functional, just less precise
    stats   = { mean: STATIC_BASELINE, stddev: STATIC_STDDEV, samples: 0, source: "static-fallback" };
    try { current = await fetchCurrentFunding(); } catch { current = STATIC_BASELINE; }
  }

  const stddev = stats.stddev > 0 ? stats.stddev : STATIC_STDDEV;
  const zscore = (current - stats.mean) / stddev;

  if (zscore > SHIFT_SIGMA) {
    const reason = `Macro shift: BTC funding ${(current * 100).toFixed(4)}% is ${zscore.toFixed(1)}σ above 24h mean ${(stats.mean * 100).toFixed(4)}% (n=${stats.samples}, source=${stats.source})`;
    const blob   = JSON.stringify({ refuser: "macro_shift", reason, zscore, current, mean: stats.mean, stddev, timestamp: Date.now() });
    return { allow: false, reason, reasonCode: 2, reasonCID: keccak256(toHex(blob)) };
  }

  const allowReason = `Macro stable: BTC funding ${(current * 100).toFixed(4)}% at ${zscore.toFixed(1)}σ (mean=${(stats.mean * 100).toFixed(4)}%, source=${stats.source})`;
  const allowBlob   = JSON.stringify({ refuser: "macro_shift", allow: true, reason: allowReason, zscore, current, mean: stats.mean, stddev, timestamp: Date.now() });
  return {
    allow: true,
    reason: allowReason,
    reasonCode: 2,
    reasonCID: keccak256(toHex(allowBlob)),
  };
}
