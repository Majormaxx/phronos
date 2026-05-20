/**
 * Trader-03: News Breaker
 * Emits a long signal when a CryptoCompare news headline contains positive keywords.
 * Mediocre performer by design — correlation between headlines and short-term price is weak.
 */
import { db, signals } from "@phronos/db";
import { SignalSchema } from "@phronos/shared";

const AGENT_ID = Number(process.env.TRADER_03_AGENT_ID ?? "3");
const INTERVAL_MS = 30 * 60 * 1000;

const BULLISH = ["surge", "rally", "breakout", "adoption", "partnership", "launch", "record"];
const BEARISH = ["crash", "ban", "hack", "fraud", "lawsuit", "collapse", "exploit"];

async function fetchHeadlines(): Promise<Array<{ title: string; categories: string }>> {
  try {
    const res = await fetch(
      "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest"
    );
    const data = await res.json() as { Data: Array<{ title: string; categories: string }> };
    return data.Data?.slice(0, 10) ?? [];
  } catch {
    return [];
  }
}

async function run(): Promise<void> {
  const headlines = await fetchHeadlines();
  if (!headlines.length) return;

  for (const item of headlines.slice(0, 3)) {
    const lower = item.title.toLowerCase();
    const bullScore = BULLISH.filter((w) => lower.includes(w)).length;
    const bearScore = BEARISH.filter((w) => lower.includes(w)).length;

    if (bullScore === 0 && bearScore === 0) continue;

    const direction = bullScore >= bearScore ? "long" : "short";
    const conviction = Math.min((Math.max(bullScore, bearScore) * 0.2), 0.6); // capped low — news signals are noisy

    const signal = SignalSchema.parse({
      schemaVersion: "signal/1.0",
      agentId: AGENT_ID,
      marketSymbol: "BTC",
      direction,
      conviction,
      horizonMinutes: 30,
      rationale: item.title.slice(0, 200),
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

    console.log(`[trader-03] ${direction} BTC on headline conviction=${conviction.toFixed(2)}`);
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-03]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
