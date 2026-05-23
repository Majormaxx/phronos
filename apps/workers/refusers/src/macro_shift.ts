import { keccak256, toHex } from "viem";
import type { IntentContext, RefuserResult } from "./llm_judgment.js";

// Baseline VIX-proxy: BTC annualised vol from recent funding rates.
// In production this would come from Pyth. For testnet we use Hyperliquid funding spread.
const BASELINE_FUNDING  = 0.00008; // 0.008% — typical calm funding
const SHIFT_THRESHOLD   = 2.0;     // 2σ

async function fetchCurrentFunding(): Promise<number> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const data = await res.json() as [unknown, Array<{ funding: string }>];
    const btcFunding = parseFloat(data[1]?.[0]?.funding ?? "0");
    return Math.abs(btcFunding);
  } catch {
    return BASELINE_FUNDING;
  }
}

export async function macroShift(intent: IntentContext): Promise<RefuserResult> {
  const current   = await fetchCurrentFunding();
  const deviation = (current - BASELINE_FUNDING) / BASELINE_FUNDING;

  if (deviation > SHIFT_THRESHOLD) {
    const reason = `Macro shift detected: BTC funding ${(current * 100).toFixed(4)}% vs baseline ${(BASELINE_FUNDING * 100).toFixed(4)}% (${deviation.toFixed(1)}σ)`;
    const blob   = JSON.stringify({ refuser: "macro_shift", reason, deviation, timestamp: Date.now() });
    return { allow: false, reason, reasonCode: 2, reasonCID: keccak256(toHex(blob)) };
  }

  return {
    allow: true,
    reason: `Macro stable: funding at ${(current * 100).toFixed(4)}%`,
    reasonCode: 2,
    reasonCID: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
}
