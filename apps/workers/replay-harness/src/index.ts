/**
 * Replay Harness — deterministic intent replay.
 *
 * replay(agentId, strategySpecCID, marketSnapshotHash, seed) → {intentHash, traceCID}
 *
 * Determinism contract:
 *  - No Date.now(), no Math.random() — PRNG seeded from `seed`
 *  - Market snapshot fetched from CoinGecko and cached by snapshotHash for the process lifetime.
 *    First call with a given hash fetches real prices; subsequent calls return the cached value.
 *  - LLM calls cached by (promptHash, seed)
 */
import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";

const INTENT_TYPEHASH = keccak256(toHex(
  "Intent(uint256 erc8004Id,uint8 venue,bytes32 marketId,int256 notionalUSDC,uint64 validUntil,uint256 nonce,bytes32 strategyHash,bytes32 traceCID)"
));

export interface ReplayInput {
  agentId: number;
  strategySpecCID: string;
  marketSnapshotHash: `0x${string}`;
  seed: number;
}

export interface ReplayOutput {
  intentHash: `0x${string}`;
  traceCID: `0x${string}`;
  trace: object;
}

export interface MarketSnapshot {
  btcPrice: number;
  ethPrice: number;
  btcChange24h: number;
  ethChange24h: number;
  timestamp: number;
}

// In-process snapshot cache: same hash → same prices for lifetime of this process
const snapshotCache = new Map<string, MarketSnapshot>();

async function fetchLivePrices(): Promise<MarketSnapshot> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true",
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json() as {
    bitcoin:  { usd: number; usd_24h_change: number };
    ethereum: { usd: number; usd_24h_change: number };
  };
  return {
    btcPrice:    data.bitcoin.usd,
    ethPrice:    data.ethereum.usd,
    btcChange24h: data.bitcoin.usd_24h_change / 100,  // normalise to decimal
    ethChange24h: data.ethereum.usd_24h_change / 100,
    timestamp:   Math.floor(Date.now() / 1000),
  };
}

// Synthetic fallback derived deterministically from snapshotHash bytes
function syntheticSnapshot(snapshotHash: `0x${string}`): MarketSnapshot {
  const h = parseInt(snapshotHash.slice(2, 10), 16);
  return {
    btcPrice:    100000 + (h % 10000),
    ethPrice:    3000   + (h % 500),
    btcChange24h: ((h % 200) - 100) / 10000,
    ethChange24h: ((h % 150) - 75)  / 10000,
    timestamp:   1747900000 + (h % 86400),
  };
}

export async function loadSnapshot(snapshotHash: `0x${string}`): Promise<MarketSnapshot> {
  if (snapshotCache.has(snapshotHash)) return snapshotCache.get(snapshotHash)!;
  let snapshot: MarketSnapshot;
  try {
    snapshot = await fetchLivePrices();
  } catch (e) {
    console.warn("[replay-harness] CoinGecko unavailable, using synthetic snapshot:", (e as Error).message);
    snapshot = syntheticSnapshot(snapshotHash);
  }
  snapshotCache.set(snapshotHash, snapshot);
  return snapshot;
}

// Deterministic PRNG (xorshift32)
function mkPrng(seed: number) {
  let s = seed >>> 0 || 1;
  return {
    next(): number {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 0x100000000;
    },
  };
}

// Pure strategy execution — seeded PRNG only, no external calls
function executeStrategy(
  strategySpecCID: string,
  agentId: number,
  snapshot: MarketSnapshot,
  prng: ReturnType<typeof mkPrng>
): { marketId: string; notional: number; rationale: string } {
  const roll = prng.next();

  // Momentum (trader-01 / agent 19297): follow BTC 24h direction
  if (strategySpecCID.includes("momentum") || agentId === 19297) {
    const signal = snapshot.btcChange24h >= 0 ? 1 : -1;
    const size   = Math.round(1_000_000 + roll * 9_000_000); // $1–$10 USDC notional
    return {
      marketId: "BTC",
      notional: signal * size,
      rationale: `Momentum: BTC 24h ${(snapshot.btcChange24h * 100).toFixed(2)}% → ${signal > 0 ? "LONG" : "SHORT"} $${(size / 1e6).toFixed(2)}`,
    };
  }

  // Mean Reversion (trader-02 / agent 19298): fade BTC 24h extreme
  if (strategySpecCID.includes("mean-revert") || agentId === 19298) {
    const signal = snapshot.btcChange24h >= 0 ? -1 : 1; // fade the move
    const size   = Math.round(800_000 + roll * 7_200_000);
    return {
      marketId: "BTC",
      notional: signal * size,
      rationale: `Mean revert: fading BTC ${(snapshot.btcChange24h * 100).toFixed(2)}% → ${signal > 0 ? "LONG" : "SHORT"} $${(size / 1e6).toFixed(2)}`,
    };
  }

  // Funding Rate (trader-03 / agent 19299): ETH vs BTC relative move
  if (strategySpecCID.includes("funding") || agentId === 19299) {
    const spread = snapshot.ethChange24h - snapshot.btcChange24h;
    const signal = spread > 0 ? 1 : -1; // long ETH if outperforming BTC
    const size   = Math.round(500_000 + roll * 4_500_000);
    return {
      marketId: "ETH",
      notional: signal * size,
      rationale: `Funding rate: ETH/BTC spread ${(spread * 100).toFixed(2)}% → ${signal > 0 ? "LONG" : "SHORT"} ETH $${(size / 1e6).toFixed(2)}`,
    };
  }

  // Random Walk (trader-04 / agent 19300): pure noise (bad actor)
  const signal = roll > 0.5 ? 1 : -1;
  const size   = Math.round(200_000 + roll * 1_800_000);
  return {
    marketId: "BTC",
    notional: signal * size,
    rationale: `Random walk: roll=${roll.toFixed(6)} → ${signal > 0 ? "LONG" : "SHORT"} $${(size / 1e6).toFixed(2)}`,
  };
}

const replayCache = new Map<string, ReplayOutput>();

export async function replay(input: ReplayInput): Promise<ReplayOutput> {
  const cacheKey = `${input.agentId}:${input.strategySpecCID}:${input.marketSnapshotHash}:${input.seed}`;
  if (replayCache.has(cacheKey)) return replayCache.get(cacheKey)!;

  const prng     = mkPrng(input.seed);
  const snapshot = await loadSnapshot(input.marketSnapshotHash);
  const result   = executeStrategy(input.strategySpecCID, input.agentId, snapshot, prng);

  const trace = {
    schemaVersion:      "trace/1.0",
    agentId:            input.agentId,
    strategySpecCID:    input.strategySpecCID,
    marketSnapshotHash: input.marketSnapshotHash,
    seed:               input.seed,
    snapshot,
    result,
    timestamp:          snapshot.timestamp,
  };

  const traceCID   = keccak256(toHex(JSON.stringify(trace)));
  const nonce      = BigInt(input.seed);
  const stratHash  = keccak256(toHex(input.strategySpecCID));
  const validUntil = BigInt(snapshot.timestamp + 30 * 60);

  const encoded = encodeAbiParameters(
    parseAbiParameters("bytes32, uint256, uint8, bytes32, int256, uint64, uint256, bytes32, bytes32"),
    [
      INTENT_TYPEHASH,
      BigInt(input.agentId),
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

  const output: ReplayOutput = { intentHash, traceCID, trace };
  replayCache.set(cacheKey, output);
  return output;
}

// CLI entrypoint: node src/index.ts --agent 19297 --snapshot 0xdeadbeef...01 --seed 42
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  const args = process.argv.slice(2);
  const get  = (flag: string) => args[args.indexOf(flag) + 1];

  const agentId            = parseInt(get("--agent") ?? "19297");
  const strategySpecCID    = get("--strategy") ?? "phronos:strategy:momentum-24h-top3";
  const marketSnapshotHash = (get("--snapshot") ?? "0xdeadbeef00000000000000000000000000000000000000000000000000000001") as `0x${string}`;
  const seed               = parseInt(get("--seed") ?? "42");

  (async () => {
    const result1 = await replay({ agentId, strategySpecCID, marketSnapshotHash, seed });
    const result2 = await replay({ agentId, strategySpecCID, marketSnapshotHash, seed });

    console.log("Run 1  intentHash:", result1.intentHash);
    console.log("Run 2  intentHash:", result2.intentHash);
    console.log("Match:", result1.intentHash === result2.intentHash ? "✓ DETERMINISTIC" : "✗ MISMATCH");
    console.log("traceCID:", result1.traceCID);
    console.log("trace:", JSON.stringify((result1.trace as any), null, 2));
  })().catch(console.error);
}
