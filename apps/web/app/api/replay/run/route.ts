export const dynamic    = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";

const INTENT_TYPEHASH = keccak256(toHex(
  "Intent(uint256 erc8004Id,uint8 venue,bytes32 marketId,int256 notionalUSDC,uint64 validUntil,uint256 nonce,bytes32 strategyHash,bytes32 traceCID)"
));

interface MarketSnapshot {
  btcPrice: number;
  ethPrice: number;
  btcChange24h: number;
  ethChange24h: number;
  timestamp: number;
}

async function fetchSnapshot(): Promise<MarketSnapshot> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true",
    { cache: "no-store", signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json() as {
    bitcoin:  { usd: number; usd_24h_change: number };
    ethereum: { usd: number; usd_24h_change: number };
  };
  return {
    btcPrice:    data.bitcoin.usd,
    ethPrice:    data.ethereum.usd,
    btcChange24h: data.bitcoin.usd_24h_change / 100,
    ethChange24h: data.ethereum.usd_24h_change / 100,
    timestamp:   Math.floor(Date.now() / 1000),
  };
}

function mkPrng(seed: number) {
  let s = seed >>> 0 || 1;
  return {
    next(): number {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 0x100000000;
    },
  };
}

function executeStrategy(
  strategySpecCID: string,
  agentId: number,
  snapshot: MarketSnapshot,
  prng: ReturnType<typeof mkPrng>
): { marketId: string; notional: number; rationale: string } {
  const roll = prng.next();

  if (strategySpecCID.includes("momentum") || agentId === 22892) {
    const signal = snapshot.btcChange24h >= 0 ? 1 : -1;
    const size   = Math.round(1_000_000 + roll * 9_000_000);
    return {
      marketId: "BTC",
      notional: signal * size,
      rationale: `Momentum: BTC 24h ${(snapshot.btcChange24h * 100).toFixed(2)}% → ${signal > 0 ? "LONG" : "SHORT"} $${(size / 1e6).toFixed(2)}`,
    };
  }

  if (strategySpecCID.includes("mean-revert") || agentId === 22893) {
    const signal = snapshot.btcChange24h >= 0 ? -1 : 1;
    const size   = Math.round(800_000 + roll * 7_200_000);
    return {
      marketId: "BTC",
      notional: signal * size,
      rationale: `Mean revert: fading BTC ${(snapshot.btcChange24h * 100).toFixed(2)}% → ${signal > 0 ? "LONG" : "SHORT"} $${(size / 1e6).toFixed(2)}`,
    };
  }

  if (strategySpecCID.includes("funding") || agentId === 22897) {
    const spread = snapshot.ethChange24h - snapshot.btcChange24h;
    const signal = spread > 0 ? 1 : -1;
    const size   = Math.round(500_000 + roll * 4_500_000);
    return {
      marketId: "ETH",
      notional: signal * size,
      rationale: `Funding rate: ETH/BTC spread ${(spread * 100).toFixed(2)}% → ${signal > 0 ? "LONG" : "SHORT"} ETH $${(size / 1e6).toFixed(2)}`,
    };
  }

  const signal = roll > 0.5 ? 1 : -1;
  const size   = Math.round(200_000 + roll * 1_800_000);
  return {
    marketId: "BTC",
    notional: signal * size,
    rationale: `Random walk: roll=${roll.toFixed(6)} → ${signal > 0 ? "LONG" : "SHORT"} $${(size / 1e6).toFixed(2)}`,
  };
}

export async function POST(req: Request) {
  try {
    const { agentId, snapshotHash, seed, strategySpecCID } = await req.json() as {
      agentId: number;
      snapshotHash: `0x${string}`;
      seed: number;
      strategySpecCID?: string;
    };

    if (!agentId || !snapshotHash || seed === undefined) {
      return NextResponse.json({ error: "agentId, snapshotHash, seed required" }, { status: 400 });
    }

    const specCID = strategySpecCID ?? `phronos:strategy:agent-${agentId}`;

    let snapshot: MarketSnapshot;
    let priceSource: string;
    try {
      snapshot    = await fetchSnapshot();
      priceSource = "coingecko-live";
    } catch {
      const h = parseInt(snapshotHash.slice(2, 10), 16);
      snapshot    = {
        btcPrice:    100000 + (h % 10000),
        ethPrice:    3000   + (h % 500),
        btcChange24h: ((h % 200) - 100) / 10000,
        ethChange24h: ((h % 150) - 75)  / 10000,
        timestamp:   Math.floor(Date.now() / 1000),
      };
      priceSource = "synthetic-fallback";
    }

    const prng   = mkPrng(seed);
    const result = executeStrategy(specCID, agentId, snapshot, prng);

    const trace = {
      schemaVersion:      "trace/1.0",
      agentId,
      strategySpecCID:    specCID,
      marketSnapshotHash: snapshotHash,
      seed,
      snapshot,
      result,
      timestamp:          snapshot.timestamp,
      priceSource,
    };

    const traceCID   = keccak256(toHex(JSON.stringify(trace)));
    const nonce      = BigInt(seed);
    const stratHash  = keccak256(toHex(specCID));
    const validUntil = BigInt(snapshot.timestamp + 30 * 60);

    const encoded = encodeAbiParameters(
      parseAbiParameters("bytes32, uint256, uint8, bytes32, int256, uint64, uint256, bytes32, bytes32"),
      [
        INTENT_TYPEHASH,
        BigInt(agentId),
        0,
        keccak256(toHex(result.marketId)) as `0x${string}`,
        BigInt(result.notional),
        validUntil,
        nonce,
        stratHash,
        traceCID,
      ]
    );
    const intentHash = keccak256(encoded);

    return NextResponse.json({
      intentHash,
      traceCID,
      agentId,
      seed,
      snapshotHash,
      strategySpecCID: specCID,
      snapshot,
      result,
      priceSource,
      replayedAt: new Date(snapshot.timestamp * 1000).toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
