import { keccak256, toHex } from "viem";
import type { IntentContext, RefuserResult } from "./llm_judgment.js";

// Top Hyperliquid leaderboard addresses to watch.
// Update before demo with current top performers.
const WHALE_ADDRESSES = [
  "0x0d2050aa7f5ccf2f5e08e07c99e4a4db28d835aa",
  "0x1d2c4cd9bee9dfe088430b95d1896852f57e5e99",
  "0xbbbe0b6bf31d69b1e23fbfef6af03c1d87d89ab1",
  "0x59c73e6e77c7b4a0e80b4491cc25e70c47d6eba8",
  "0x4c81acc72e2aed98ce63b3cc3c3dece4eba67f34",
];

interface HlPosition { coin: string; szi: string; }

async function fetchWhalePositions(): Promise<Map<string, number>> {
  const positions = new Map<string, number>();
  for (const addr of WHALE_ADDRESSES) {
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "clearinghouseState", user: addr }),
      });
      const data = await res.json() as { assetPositions: Array<{ position: HlPosition }> };
      for (const { position } of data.assetPositions ?? []) {
        const szi = parseFloat(position.szi);
        if (szi !== 0) {
          positions.set(position.coin, (positions.get(position.coin) ?? 0) + szi);
        }
      }
    } catch { /* whale fetch failed — non-fatal */ }
  }
  return positions;
}

export async function whaleContradiction(intent: IntentContext): Promise<RefuserResult> {
  const notional  = parseFloat(intent.notionalUSDC);
  const isLong    = notional > 0;
  const symbol    = intent.marketId.slice(0, 10).replace(/[^A-Z]/g, ""); // rough decode

  const positions = await fetchWhalePositions();
  const whaleNet  = positions.get(symbol) ?? 0;

  // Refuse if whales hold opposite direction with meaningful conviction
  if (whaleNet !== 0 && Math.sign(whaleNet) !== Math.sign(notional)) {
    const reason = `Whale contradiction: ${symbol} net whale position ${whaleNet > 0 ? "LONG" : "SHORT"} (${whaleNet.toFixed(2)}) vs our ${isLong ? "LONG" : "SHORT"}`;
    const blob   = JSON.stringify({ refuser: "whale_contradiction", reason, symbol, whaleNet, timestamp: Date.now() });
    return { allow: false, reason, reasonCode: 3, reasonCID: keccak256(toHex(blob)) };
  }

  return {
    allow: true,
    reason: `No whale contradiction on ${symbol}`,
    reasonCode: 3,
    reasonCID: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
}
