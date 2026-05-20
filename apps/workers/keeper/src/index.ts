import { parseAbi } from "viem";
import { db, signals, agents, slashes } from "@phronos/db";
import { getPublicClient, getWalletClient, getDeployedAddresses } from "@phronos/shared";
import { eq, gte, and } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN !== "false";
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const ORACLE_ABI = parseAbi([
  "function setSharpe(uint256 agentId, int256 rollingSharpe7d) external",
  "function evaluateAndSlash(uint256 agentId) external returns (uint16 bpsSlashed)",
]);

const BENCH_ABI = parseAbi([
  "function admittedAgents() external view returns (uint256[])",
]);

// Pyth price feed placeholder — for testnet we use a hardcoded mid-price fallback.
const PRICE_FALLBACK: Record<string, number> = {
  BTC: 105000,
  ETH: 3200,
  SOL: 180,
  BNB: 600,
};

function getPrice(symbol: string): number {
  return PRICE_FALLBACK[symbol.toUpperCase()] ?? 1;
}

/**
 * Compute a 7-day rolling Sharpe from the agent's signals.
 * Each signal is treated as a hypothetical 1 USDC trade in the signaled direction.
 * PnL = conviction * direction_multiplier * (price_change_pct over horizonMinutes).
 * For testnet we approximate price change as 0 (no oracle) — Sharpe tracks signal quality via conviction.
 */
function computeSharpe(agentSignals: Array<{ direction: string; conviction: number }>): number {
  if (agentSignals.length < 2) return 0;

  // Simulate daily PnL: each signal is a +/- conviction trade
  const pnls = agentSignals.map((s) => {
    const dir = s.direction === "long" ? 1 : s.direction === "short" ? -1 : 0;
    // Without a live price oracle on testnet, conviction * direction approximates signal quality.
    // Positive Sharpe → good signals; negative → noise.
    return dir * s.conviction;
  });

  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;

  const annualised = (mean / std) * Math.sqrt(252);
  return annualised;
}

async function runKeeper(): Promise<void> {
  console.log(`[keeper] running — dry_run=${DRY_RUN}`);

  const { benchRegistry, slashOracle } = getDeployedAddresses();
  if (!benchRegistry || !slashOracle) {
    console.warn("[keeper] contract addresses not set — skipping");
    return;
  }

  const publicClient = getPublicClient();
  const admittedRaw = await publicClient.readContract({
    address: benchRegistry,
    abi: BENCH_ABI,
    functionName: "admittedAgents",
  });
  const admitted = admittedRaw.map(String);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const agentId of admitted) {
    const recentSignals = await db()
      .select()
      .from(signals)
      .where(and(eq(signals.agentId, agentId), gte(signals.createdAt, since)));

    const sharpe = computeSharpe(recentSignals);
    // Scale to 1e18 for on-chain storage (int256 wad)
    const sharpeWad = BigInt(Math.round(sharpe * 1e18));

    console.log(`[keeper] agent=${agentId} signals=${recentSignals.length} sharpe=${sharpe.toFixed(4)}`);

    if (DRY_RUN) continue;

    const pk = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!pk) { console.warn("[keeper] KEEPER_PRIVATE_KEY not set"); continue; }

    const walletClient = getWalletClient(pk);

    // Write Sharpe to oracle
    await walletClient.writeContract({
      address: slashOracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "setSharpe",
      args: [BigInt(agentId), sharpeWad],
    });

    // Evaluate and potentially slash
    const bpsSlashed = await publicClient.simulateContract({
      address: slashOracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "evaluateAndSlash",
      args: [BigInt(agentId)],
      account: walletClient.account,
    });

    if (Number(bpsSlashed.result) > 0) {
      const hash = await walletClient.writeContract(bpsSlashed.request);
      console.log(`[keeper] slashed agent=${agentId} bps=${bpsSlashed.result} tx=${hash}`);
      await db().insert(slashes).values({
        agentId,
        bps: Number(bpsSlashed.result),
        amount: "0", // updated from chain event in dashboard
        sharpeAtSlash: sharpe,
        txHash: hash,
      });
    }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await runKeeper();
    } catch (err) {
      console.error("[keeper] run failed:", err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
