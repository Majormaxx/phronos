import { NextResponse } from "next/server";

export const revalidate = 60;

export async function GET() {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);

    const [meta, ctxs] = await res.json() as [
      { universe: Array<{ name: string }> },
      Array<{ funding: string }>
    ];

    const btcIdx = meta.universe.findIndex(u => u.name === "BTC");
    const ethIdx = meta.universe.findIndex(u => u.name === "ETH");

    const btcFunding = btcIdx >= 0 ? parseFloat(ctxs[btcIdx]?.funding ?? "0") : 0;
    const ethFunding = ethIdx >= 0 ? parseFloat(ctxs[ethIdx]?.funding ?? "0") : 0;
    const spread     = ethFunding - btcFunding;

    return NextResponse.json({
      btcFunding,
      ethFunding,
      spread,
      signal:    spread > 0 ? "LONG_ETH" : "LONG_BTC",
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
