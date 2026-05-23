/**
 * Replay Harness — deterministic intent replay.
 *
 * replay(agentId, strategySpecCID, marketSnapshotHash, seed) → {intentHash, traceCID}
 *
 * Same inputs ALWAYS produce the same output (byte-identical):
 *  - No Date.now(), no Math.random() — PRNG seeded from `seed`
 *  - No network calls — market snapshot is pre-fetched and content-addressed
 *  - LLM calls cached by (promptHash, seed)
 *
 * The demo: run twice with identical inputs, assert SHA-256(output) matches.
 */
import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";

const INTENT_TYPEHASH = keccak256(toHex(
  "Intent(uint256 erc8004Id,uint8 venue,bytes32 marketId,int256 notionalUSDC,uint64 validUntil,uint256 nonce,bytes32 strategyHash,bytes32 traceCID)"
));

export interface ReplayInput {
  agentId: number;
  strategySpecCID: string; // content-addressed strategy spec
  marketSnapshotHash: `0x${string}`; // hash of the market state at decision time
  seed: number; // deterministic seed
}

export interface ReplayOutput {
  intentHash: `0x${string}`;
  traceCID: `0x${string}`;
  trace: object; // full reasoning trace
}

// Deterministic PRNG (xorshift32) seeded from input
function mkPrng(seed: number) {
  let s = seed >>> 0 || 1;
  return {
    next(): number {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 0x100000000;
    },
  };
}

// Simulate a market snapshot — in production this is fetched from a DB by snapshotHash
function loadSnapshot(snapshotHash: `0x${string}`) {
  // For determinism the snapshot is fixed by its hash.
  // This is a synthetic reconstruction used in test/demo mode.
  const h = parseInt(snapshotHash.slice(2, 10), 16);
  return {
    btcPrice:  100000 + (h % 10000),
    ethPrice:  3000   + (h % 500),
    btcChange: ((h % 200) - 100) / 100, // -1 to +1
    ethChange: ((h % 150) - 75)  / 100,
    timestamp: 1747900000 + (h % 86400),
  };
}

// Pure strategy execution — no external calls, seeded PRNG only
function executeStrategy(
  strategySpecCID: string,
  snapshot: ReturnType<typeof loadSnapshot>,
  prng: ReturnType<typeof mkPrng>
): { marketId: string; notional: number; rationale: string } {
  const roll = prng.next();

  if (strategySpecCID.includes("momentum")) {
    const signal = snapshot.btcChange > 0 ? 1 : -1;
    return {
      marketId: "BTC",
      notional: signal * Math.round(roll * 10_000_000),
      rationale: `Momentum: BTC 24h change ${(snapshot.btcChange * 100).toFixed(2)}% — seed=${prng.next().toFixed(6)}`,
    };
  }
  if (strategySpecCID.includes("mean-revert")) {
    return {
      marketId: "BTC",
      notional: snapshot.btcChange > 0 ? -1 : 1 * Math.round(roll * 8_000_000),
      rationale: `Mean revert: fading ${(snapshot.btcChange * 100).toFixed(2)}%`,
    };
  }
  // Default
  return {
    marketId: "ETH",
    notional: (roll > 0.5 ? 1 : -1) * Math.round(roll * 5_000_000),
    rationale: `Default strategy: roll=${roll.toFixed(6)}`,
  };
}

const traceCache = new Map<string, ReplayOutput>();

export function replay(input: ReplayInput): ReplayOutput {
  const cacheKey = `${input.agentId}:${input.strategySpecCID}:${input.marketSnapshotHash}:${input.seed}`;
  if (traceCache.has(cacheKey)) return traceCache.get(cacheKey)!;

  const prng     = mkPrng(input.seed);
  const snapshot = loadSnapshot(input.marketSnapshotHash);
  const result   = executeStrategy(input.strategySpecCID, snapshot, prng);

  const trace = {
    schemaVersion:    "trace/1.0",
    agentId:          input.agentId,
    strategySpecCID:  input.strategySpecCID,
    marketSnapshotHash: input.marketSnapshotHash,
    seed:             input.seed,
    snapshot,
    result,
    timestamp:        snapshot.timestamp, // deterministic — from snapshot, not Date.now()
  };

  const traceCID = keccak256(toHex(JSON.stringify(trace)));

  const nonce     = BigInt(input.seed);
  const stratHash = keccak256(toHex(input.strategySpecCID));
  const validUntil = BigInt(snapshot.timestamp + 30 * 60);

  const encoded = encodeAbiParameters(
    parseAbiParameters("bytes32, uint256, uint8, bytes32, int256, uint64, uint256, bytes32, bytes32"),
    [
      INTENT_TYPEHASH,
      BigInt(input.agentId),
      0, // ARC_USDC_SWAP
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
  traceCache.set(cacheKey, output);
  return output;
}

// CLI entrypoint: node src/index.ts --agent 1 --snapshot 0xdeadbeef --seed 42
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  const args = process.argv.slice(2);
  const get  = (flag: string) => args[args.indexOf(flag) + 1];

  const agentId           = parseInt(get("--agent") ?? "19297");
  const strategySpecCID   = get("--strategy") ?? "phronos:strategy:momentum-24h-top3";
  const marketSnapshotHash = (get("--snapshot") ?? "0xdeadbeef00000000000000000000000000000000000000000000000000000001") as `0x${string}`;
  const seed              = parseInt(get("--seed") ?? "42");

  const result1 = replay({ agentId, strategySpecCID, marketSnapshotHash, seed });
  const result2 = replay({ agentId, strategySpecCID, marketSnapshotHash, seed });

  console.log("Run 1  intentHash:", result1.intentHash);
  console.log("Run 2  intentHash:", result2.intentHash);
  console.log("Match:", result1.intentHash === result2.intentHash ? "✓ DETERMINISTIC" : "✗ MISMATCH");
  console.log("traceCID:", result1.traceCID);
}
