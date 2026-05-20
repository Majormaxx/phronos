/**
 * Trader-06: Copy HL
 * Mirrors the open positions of a hardcoded Hyperliquid leaderboard address.
 */
import { db, signals } from "@phronos/db";
import { SignalSchema } from "@phronos/shared";

const AGENT_ID = Number(process.env.TRADER_06_AGENT_ID ?? "6");
const INTERVAL_MS = 20 * 60 * 1000;
// Hardcoded leaderboard whale address — replace with a current top performer before demo.
const WHALE = process.env.HL_WHALE_ADDRESS ?? "0x0000000000000000000000000000000000000000";

interface HlPosition {
  coin: string;
  szi: string; // negative = short, positive = long
}

async function fetchPositions(): Promise<HlPosition[]> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: WHALE }),
    });
    const data = await res.json() as { assetPositions: Array<{ position: HlPosition }> };
    return data.assetPositions?.map((p) => p.position) ?? [];
  } catch {
    return [];
  }
}

async function run(): Promise<void> {
  const positions = await fetchPositions();
  if (!positions.length) {
    console.log("[trader-06] no positions found for whale");
    return;
  }

  for (const pos of positions.slice(0, 3)) {
    const szi = parseFloat(pos.szi);
    if (szi === 0) continue;

    const direction = szi > 0 ? "long" : "short";
    const conviction = Math.min(Math.abs(szi) / 10, 1);

    const signal = SignalSchema.parse({
      schemaVersion: "signal/1.0",
      agentId: AGENT_ID,
      marketSymbol: pos.coin,
      direction,
      conviction,
      horizonMinutes: 60,
      rationale: `Copying HL leaderboard: ${direction} ${pos.coin} size=${pos.szi}`,
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

    console.log(`[trader-06] copy ${direction} ${pos.coin} conviction=${conviction.toFixed(2)}`);
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await run(); } catch (err) { console.error("[trader-06]", err); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
