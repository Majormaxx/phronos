/**
 * Trader-04: Funding Rate
 * Shorts when Hyperliquid BTC funding > 0.01% (crowded longs).
 * Goes long when funding is deeply negative (crowded shorts).
 */
import { db, signals } from "@phronos/db";
import { SignalSchema } from "@phronos/shared";

const AGENT_ID = Number(process.env.TRADER_04_AGENT_ID ?? "4");
const INTERVAL_MS = 15 * 60 * 1000;
const THRESHOLD = 0.0001; // 0.01%

async function fetchFunding(): Promise<{ btc: number; eth: number }> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const data = await res.json() as [unknown, Array<{ funding: string }>];
    return {
      btc: parseFloat(data[1]?.[0]?.funding ?? "0"),
      eth: parseFloat(data[1]?.[1]?.funding ?? "0"),
    };
  } catch {
    return { btc: 0, eth: 0 };
  }
}

async function run(): Promise<void> {
  const { btc, eth } = await fetchFunding();

  for (const [symbol, funding] of [["BTC", btc] as const, ["ETH", eth] as const]) {
    if (Math.abs(funding) < THRESHOLD) continue;

    const direction = funding > 0 ? "short" : "long";
    const conviction = Math.min(Math.abs(funding) / (THRESHOLD * 5), 1);

    const signal = SignalSchema.parse({
      schemaVersion: "signal/1.0",
      agentId: AGENT_ID,
      marketSymbol: symbol,
      direction,
      conviction,
      horizonMinutes: 60,
      rationale: `${symbol} funding=${(funding * 100).toFixed(4)}% — fade crowded ${funding > 0 ? "longs" : "shorts"}`,
      evidence: [],
      timestamp: Math.floor(Date.now() / 1000),
    });

    await db().insert(signals).values({
      agentId: String(signal.agentId),
      marketSymbol: signal.marketSymbol,
      direction: signal.direction,
      conviction: signal.conviction,
      horizonMinutes: signal.horizonMinutes,
      rationale: signal.rationale,
    });

    console.log(`[trader-04] ${direction} ${symbol} funding=${funding} conviction=${conviction.toFixed(2)}`);
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-04]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
