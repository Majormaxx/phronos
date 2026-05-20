/**
 * Trader-05: Random Walk
 * Emits fully random signals. Designed to underperform and trigger the slash demo.
 * This is the villain of the bench.
 */
import { db, signals } from "@phronos/db";
import { SignalSchema } from "@phronos/shared";

const AGENT_ID = Number(process.env.TRADER_05_AGENT_ID ?? "5");
const INTERVAL_MS = 10 * 60 * 1000; // fires frequently to accumulate a bad track record fast
const MARKETS = ["BTC", "ETH", "SOL", "BNB"];

async function run(): Promise<void> {
  const market = MARKETS[Math.floor(Math.random() * MARKETS.length)]!;
  const directions = ["long", "short", "flat"] as const;
  const direction = directions[Math.floor(Math.random() * directions.length)]!;
  const conviction = Math.random();

  const signal = SignalSchema.parse({
    schemaVersion: "signal/1.0",
    agentId: AGENT_ID,
    marketSymbol: market,
    direction,
    conviction,
    horizonMinutes: 15 + Math.floor(Math.random() * 45),
    rationale: "Stochastic signal — trust the process.",
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

  console.log(`[trader-05] random ${direction} ${market} conviction=${conviction.toFixed(2)}`);
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-05]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
