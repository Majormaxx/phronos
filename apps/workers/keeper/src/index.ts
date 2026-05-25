/**
 * Keeper: computes 7-day rolling Sharpe for each agent from on-chain IntentSubmitted events.
 * Uses real BTC price history from CoinGecko to compute genuine PnL per intent.
 * Writes Sharpe to SlashOracle, triggers evaluateAndSlash.
 */
import { parseAbi } from "viem";
import { getPublicClient, getWalletClient, getDeployedAddresses } from "@phronos/shared";

const DRY_RUN     = process.env.DRY_RUN !== "false";
const INTERVAL_MS = 15 * 60 * 1000;
const PK          = (process.env.KEEPER_PRIVATE_KEY ?? "") as `0x${string}`;

const ORACLE_ABI = parseAbi([
  "function setSharpe(uint256 erc8004Id, int256 rollingSharpe7dWad) external",
  "function evaluateAndSlash(uint256 erc8004Id) external returns (uint16 bpsSlashed)",
]);
const REGISTRY_ABI = parseAbi([
  "function allAgentIds() external view returns (uint256[])",
]);
const ROUTER_ABI = parseAbi([
  "event IntentSubmitted(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 venue, int256 notionalUSDC, bytes32 traceCID)",
]);

interface PricePoint { time: number; price: number; }

async function fetchBtcPriceHistory(): Promise<{ history: PricePoint[]; current: number }> {
  try {
    const [histRes, curRes] = await Promise.all([
      fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly"),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"),
    ]);
    if (!histRes.ok || !curRes.ok) throw new Error("CoinGecko non-200");
    const [hist, cur] = await Promise.all([histRes.json(), curRes.json()]) as [
      { prices: [number, number][] },
      { bitcoin: { usd: number } },
    ];
    const history = hist.prices.map(([t, p]) => ({ time: Math.floor(t / 1000), price: p }));
    return { history, current: cur.bitcoin.usd };
  } catch (e) {
    console.warn("[keeper] CoinGecko fetch failed:", (e as Error).message);
    return { history: [], current: 0 };
  }
}

function nearestPrice(history: PricePoint[], timestamp: number): number {
  if (history.length === 0) return 0;
  return history.reduce((best, p) =>
    Math.abs(p.time - timestamp) < Math.abs(best.time - timestamp) ? p : best
  ).price;
}

async function computeRealSharpe(
  agentLogs: Array<{ blockNumber: bigint | null; args: { notionalUSDC?: bigint } }>,
  publicClient: ReturnType<typeof getPublicClient>,
  history: PricePoint[],
  currentPrice: number
): Promise<number> {
  if (agentLogs.length < 2) return 0;
  if (currentPrice === 0 || history.length === 0) {
    // Fallback: direction-only Sharpe (sign of notional)
    const signs = agentLogs.map(l => (l.args.notionalUSDC ?? 0n) >= 0n ? 1 : -1);
    const mean  = signs.reduce((a, b) => a + b, 0) / signs.length;
    const std   = Math.sqrt(signs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signs.length);
    return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
  }

  // Fetch block timestamps for unique blocks
  const uniqueBlocks = [...new Set(agentLogs.map(l => l.blockNumber).filter(Boolean) as bigint[])];
  const blockTimes = new Map<bigint, number>();
  await Promise.all(
    uniqueBlocks.map(bn =>
      publicClient.getBlock({ blockNumber: bn })
        .then(b => blockTimes.set(bn, Number(b.timestamp)))
        .catch(() => {})
    )
  );

  const returns: number[] = [];
  for (const log of agentLogs) {
    const bn = log.blockNumber;
    if (!bn) continue;
    const blockTime = blockTimes.get(bn);
    if (!blockTime) continue;

    const entryPrice = nearestPrice(history, blockTime);
    if (entryPrice === 0) continue;

    const direction = (log.args.notionalUSDC ?? 0n) >= 0n ? 1 : -1;
    const ret = direction * (currentPrice - entryPrice) / entryPrice;
    returns.push(ret);
  }

  if (returns.length < 2) return 0;
  const mean     = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const std      = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

async function runKeeper(): Promise<void> {
  console.log(`[keeper] running — dry_run=${DRY_RUN}`);

  const { registry: registryAddr, slashOracle, router } = getDeployedAddresses();
  if (!registryAddr || !slashOracle || !router) {
    console.warn("[keeper] contract addresses not set — skipping");
    return;
  }

  const publicClient = getPublicClient();

  // Fetch real BTC prices + agent IDs in parallel
  const [{ history, current: currentBtcPrice }, agentIdsBig] = await Promise.all([
    fetchBtcPriceHistory(),
    publicClient.readContract({ address: registryAddr, abi: REGISTRY_ABI, functionName: "allAgentIds" }),
  ]);

  console.log(`[keeper] BTC price: $${currentBtcPrice.toFixed(2)} | history points: ${history.length}`);

  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock    = currentBlock > 9999n ? currentBlock - 9999n : 0n;

  const logs = await publicClient.getLogs({
    address: router,
    event: ROUTER_ABI[0],
    fromBlock,
    toBlock: currentBlock,
  });

  for (const agentId of agentIdsBig) {
    const agentLogs = logs.filter(l => l.args.erc8004Id === agentId);
    const sharpe    = await computeRealSharpe(agentLogs, publicClient, history, currentBtcPrice);
    const sharpeWad = BigInt(Math.round(sharpe * 1e18));
    console.log(`[keeper] agent=${agentId} intents=${agentLogs.length} sharpe=${sharpe.toFixed(4)} (real BTC PnL)`);

    if (DRY_RUN) continue;
    if (!PK) { console.warn("[keeper] KEEPER_PRIVATE_KEY not set"); continue; }

    const walletClient = getWalletClient(PK);

    try {
      const setHash = await walletClient.writeContract({
        address: slashOracle as `0x${string}`,
        abi: ORACLE_ABI,
        functionName: "setSharpe",
        args: [agentId, sharpeWad],
      });
      await publicClient.waitForTransactionReceipt({ hash: setHash });
      console.log(`[keeper] setSharpe agent=${agentId} sharpe=${sharpe.toFixed(4)}`);

      const result = await publicClient.simulateContract({
        address: slashOracle as `0x${string}`,
        abi: ORACLE_ABI,
        functionName: "evaluateAndSlash",
        args: [agentId],
        account: walletClient.account,
      });

      if (Number(result.result) > 0) {
        await walletClient.writeContract(result.request);
        console.log(`[keeper] SLASHED agent=${agentId} bps=${result.result}`);
      } else {
        console.log(`[keeper] no slash for agent=${agentId}`);
      }
    } catch (err) {
      console.error(`[keeper] agent=${agentId}:`, (err as Error).message?.slice(0, 200));
    }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try { await runKeeper(); } catch (err) { console.error("[keeper] run failed:", err); }
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

loop();
