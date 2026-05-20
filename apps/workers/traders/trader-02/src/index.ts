/**
 * Trader-02: Mean Reversion
 * Fades the 24h extremes — shorts the biggest gainers, longs the biggest losers.
 */
import { db, signals } from "@phronos/db";
import { SignalSchema } from "@phronos/shared";

const AGENT_ID = Number(process.env.TRADER_02_AGENT_ID ?? "2");
const INTERVAL_MS = 25 * 60 * 1000;
const WATCHLIST = ["bitcoin", "ethereum", "solana", "binancecoin", "avalanche-2"];

const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", binancecoin: "BNB", "avalanche-2": "AVAX",
};

async function fetchChanges(): Promise<Record<string, number>> {
  try {
    const ids = WATCHLIST.join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    );
    const data = await res.json() as Record<string, { usd_24h_change?: number }>;
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v.usd_24h_change ?? 0])
    );
  } catch {
    return { bitcoin: 1.2, ethereum: 0.8, solana: 2.1, binancecoin: 0.3, "avalanche-2": -0.5 };
  }
}

async function run(): Promise<void> {
  const changes = await fetchChanges();

  for (const [coin, change] of Object.entries(changes)) {
    if (Math.abs(change) < 1.5) continue; // only trade meaningful moves
    const symbol = SYMBOL_MAP[coin] ?? coin.toUpperCase();
    const direction = change > 0 ? "short" : "long"; // fade the move
    const conviction = Math.min(Math.abs(change) / 6, 1);

    const signal = SignalSchema.parse({
      schemaVersion: "signal/1.0",
      agentId: AGENT_ID,
      marketSymbol: symbol,
      direction,
      conviction,
      horizonMinutes: 120,
      rationale: `Mean-revert ${symbol}: fading ${change.toFixed(2)}% 24h move`,
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

    console.log(`[trader-02] ${direction} ${symbol} conviction=${conviction.toFixed(2)}`);
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-02]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
