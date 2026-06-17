/**
 * Keeper:
 * 1. Closes expired HL testnet positions and records realized P&L per copy.
 * 2. Computes 7-day rolling Sharpe for each agent — real P&L when available,
 *    CoinGecko price-estimate as fallback for mock-venue intents.
 * 3. Writes Sharpe to SlashOracle and calls evaluateAndSlash.
 */
import { parseAbi } from "viem";
import { getPublicClient, getWalletClient, getDeployedAddresses } from "@phronos/shared";
import { hlClosePosition, hlMidPrice }                           from "@phronos/shared";
import { privateKeyToAccount }                                   from "viem/accounts";
import { rawSql, db, intents, copies, eq, and, sql }             from "@phronos/db";

const DRY_RUN          = process.env.DRY_RUN !== "false";
const INTERVAL_MS      = 15 * 60 * 1000;
const PK               = (process.env.KEEPER_PRIVATE_KEY  ?? "") as `0x${string}`;
const ROUTER_PK        = (process.env.ROUTER_PRIVATE_KEY  ?? "") as `0x${string}`;
const HYPERLIQUID_MODE = process.env.HYPERLIQUID_MODE ?? "mock";

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

const AGENT_MARKET: Record<string, string> = {
  "22892": "BTC", "22893": "BTC", "22897": "ETH", "22900": "BTC",
};

interface PricePoint { time: number; price: number; }

async function fetchPriceHistory(): Promise<{ btc: PricePoint[]; eth: PricePoint[]; btcNow: number; ethNow: number }> {
  try {
    const [histBtc, histEth, cur] = await Promise.all([
      fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly").then(r => r.json()),
      fetch("https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1&interval=hourly").then(r => r.json()),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd").then(r => r.json()),
    ]) as [{ prices: [number, number][] }, { prices: [number, number][] }, { bitcoin: { usd: number }; ethereum: { usd: number } }];
    return {
      btc:    histBtc.prices.map(([t, p]) => ({ time: Math.floor(t / 1000), price: p })),
      eth:    histEth.prices.map(([t, p]) => ({ time: Math.floor(t / 1000), price: p })),
      btcNow: cur.bitcoin.usd,
      ethNow: cur.ethereum.usd,
    };
  } catch (e) {
    console.warn("[keeper] price fetch failed:", (e as Error).message);
    return { btc: [], eth: [], btcNow: 0, ethNow: 0 };
  }
}

function nearestPrice(history: PricePoint[], ts: number): number {
  if (!history.length) return 0;
  return history.reduce((b, p) => Math.abs(p.time - ts) < Math.abs(b.time - ts) ? p : b).price;
}

// ── Phase 1: close expired HL positions and record P&L ─────────────────────

async function closeExpiredPositions(): Promise<void> {
  const nsql = rawSql();

  // Any intent with an entry price but no close price that has expired —
  // covers both live HL fills and mock-mode price-tracked intents.
  const expired = await nsql`
    SELECT i.intent_hash, i.market_id, i.notional_usdc, i.fill_sz_base,
           i.entry_price_px, i.hl_order_id, i.valid_until
    FROM intents i
    WHERE i.entry_price_px IS NOT NULL
      AND i.close_price_px  IS NULL
      AND i.valid_until      < NOW()
    ORDER BY i.valid_until ASC
    LIMIT 50
  ` as Array<{
    intent_hash:    string;
    market_id:      string;
    notional_usdc:  string;
    fill_sz_base:   string | null;
    entry_price_px: string;
    hl_order_id:    string | null;
    valid_until:    Date;
  }>;

  if (!expired.length) return;
  console.log(`[keeper] settling ${expired.length} expired position(s) (mode=${HYPERLIQUID_MODE})`);

  for (const row of expired) {
    const market    = row.market_id;
    const openIsBuy = BigInt(row.notional_usdc) >= 0n;
    const entryPx   = parseFloat(row.entry_price_px);

    try {
      let closePx: number;

      // Live mode with a real HL position: attempt to close it on-chain
      if (HYPERLIQUID_MODE === "live" && ROUTER_PK && row.hl_order_id && row.fill_sz_base) {
        const routerAddr = privateKeyToAccount(ROUTER_PK).address;
        const closeFill  = await hlClosePosition({
          pk:        ROUTER_PK,
          address:   routerAddr,
          market,
          openIsBuy,
          openSz:    parseFloat(row.fill_sz_base),
        });
        closePx = closeFill?.avgPx ?? await hlMidPrice(market);
        console.log(`[keeper] HL close intent=${row.intent_hash.slice(0,10)} closePx=${closePx}`);
      } else {
        // Mock mode (or live without a fill): use current HL mid as close price.
        // This gives real P&L from real price movement without exchange fills.
        closePx = await hlMidPrice(market);
        console.log(`[keeper] mock settle intent=${row.intent_hash.slice(0,10)} entry=${entryPx} close=${closePx}`);
      }

      await nsql`UPDATE intents SET close_price_px = ${closePx.toString()} WHERE intent_hash = ${row.intent_hash}`;

      // Compute and persist P&L for every copy of this intent
      const copiesOfIntent = await nsql`
        SELECT follower_addr, follower_notional FROM copies WHERE intent_hash = ${row.intent_hash}
      ` as Array<{ follower_addr: string; follower_notional: string }>;

      for (const copy of copiesOfIntent) {
        const notionalUsd = Number(copy.follower_notional) / 1_000_000;
        const direction   = openIsBuy ? 1 : -1;
        const pnlUsdc     = direction * (closePx - entryPx) / entryPx * notionalUsd;
        await nsql`
          UPDATE copies SET pnl_usdc = ${pnlUsdc.toFixed(10)}
          WHERE intent_hash = ${row.intent_hash} AND follower_addr = ${copy.follower_addr}
        `;
      }
      console.log(`[keeper] P&L settled for ${copiesOfIntent.length} copies of ${row.intent_hash.slice(0,10)}`);
    } catch (e) {
      console.error(`[keeper] settle failed intent=${row.intent_hash.slice(0,10)}:`, (e as Error).message?.slice(0,200));
    }
  }
}

// ── Phase 2: compute Sharpe using real P&L where available ─────────────────

async function computeAgentSharpe(
  agentId:       bigint,
  intentLogs:    Array<{ blockNumber: bigint | null; args: { notionalUSDC?: bigint; intentHash?: `0x${string}` } }>,
  publicClient:  ReturnType<typeof getPublicClient>,
  prices:        { btc: PricePoint[]; eth: PricePoint[]; btcNow: number; ethNow: number },
): Promise<number> {
  const market  = AGENT_MARKET[agentId.toString()] ?? "BTC";
  const history = market === "ETH" ? prices.eth : prices.btc;
  const nowPrice = market === "ETH" ? prices.ethNow : prices.btcNow;

  if (!intentLogs.length) return 0;

  // Fetch real P&L from DB for these intents (HL live fills)
  const intentHashes = intentLogs.map(l => l.args.intentHash).filter(Boolean) as string[];

  let realReturns: number[] = [];
  if (intentHashes.length) {
    try {
      const nsql = rawSql();
      const rows = await nsql`
        SELECT c.pnl_usdc, c.follower_notional
        FROM copies c
        WHERE c.intent_hash = ANY(${intentHashes})
          AND c.pnl_usdc IS NOT NULL
      ` as Array<{ pnl_usdc: string; follower_notional: string }>;

      realReturns = rows.map(r => {
        const notionalUsd = Number(r.follower_notional) / 1_000_000;
        return notionalUsd > 0 ? Number(r.pnl_usdc) / notionalUsd : 0;
      });
    } catch { /* fallthrough to price estimate */ }
  }

  // If we have real P&L for at least 2 intents, use it
  if (realReturns.length >= 2) {
    const mean     = realReturns.reduce((a, b) => a + b, 0) / realReturns.length;
    const variance = realReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / realReturns.length;
    const std      = Math.sqrt(variance);
    console.log(`[keeper] agent=${agentId} using REAL P&L (${realReturns.length} fills) sharpe_raw=${std === 0 ? 0 : mean / std}`);
    return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
  }

  // Fallback: estimate from block timestamp + CoinGecko price history
  if (!nowPrice || !history.length) {
    const signs = intentLogs.map(l => (l.args.notionalUSDC ?? 0n) >= 0n ? 1 : -1);
    const mean  = signs.reduce((a, b) => a + b, 0) / signs.length;
    const std   = Math.sqrt(signs.reduce((a, b) => a + (b - mean) ** 2, 0) / signs.length);
    return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
  }

  const uniqueBlocks = [...new Set(intentLogs.map(l => l.blockNumber).filter(Boolean) as bigint[])];
  const blockTimes   = new Map<bigint, number>();
  await Promise.all(
    uniqueBlocks.map(bn =>
      publicClient.getBlock({ blockNumber: bn })
        .then(b => blockTimes.set(bn, Number(b.timestamp)))
        .catch(() => {})
    )
  );

  const returns: number[] = [];
  for (const log of intentLogs) {
    const bn = log.blockNumber;
    if (!bn) continue;
    const blockTime  = blockTimes.get(bn);
    if (!blockTime) continue;
    const entryPrice = nearestPrice(history, blockTime);
    if (!entryPrice) continue;
    const direction  = (log.args.notionalUSDC ?? 0n) >= 0n ? 1 : -1;
    returns.push(direction * (nowPrice - entryPrice) / entryPrice);
  }

  if (returns.length < 2) return 0;
  const mean     = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std      = Math.sqrt(variance);
  console.log(`[keeper] agent=${agentId} using PRICE-ESTIMATE (${returns.length} intents)`);
  return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
}

// ── Main keeper loop ────────────────────────────────────────────────────────

async function runKeeper(): Promise<void> {
  console.log(`[keeper] running — dry_run=${DRY_RUN} hl_mode=${HYPERLIQUID_MODE}`);

  // Phase 1: close expired HL positions
  await closeExpiredPositions();

  const { registry: registryAddr, slashOracle, router } = getDeployedAddresses();
  if (!registryAddr || !slashOracle || !router) {
    console.warn("[keeper] contract addresses not set — skipping Sharpe"); return;
  }

  const publicClient = getPublicClient();

  const [prices, agentIdsBig] = await Promise.all([
    fetchPriceHistory(),
    publicClient.readContract({ address: registryAddr, abi: REGISTRY_ABI, functionName: "allAgentIds" }),
  ]);

  console.log(`[keeper] BTC=$${prices.btcNow.toFixed(2)} ETH=$${prices.ethNow.toFixed(2)}`);

  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock    = currentBlock > 9999n ? currentBlock - 9999n : 0n;

  const logs = await publicClient.getLogs({
    address: router, event: ROUTER_ABI[0], fromBlock, toBlock: currentBlock,
  });

  for (const agentId of agentIdsBig) {
    const agentLogs = logs.filter(l => l.args.erc8004Id === agentId);
    const sharpe    = await computeAgentSharpe(agentId, agentLogs, publicClient, prices);
    const sharpeWad = BigInt(Math.round(sharpe * 1e18));
    console.log(`[keeper] agent=${agentId} intents=${agentLogs.length} sharpe=${sharpe.toFixed(4)}`);

    if (DRY_RUN || !PK) continue;

    const walletClient = getWalletClient(PK);
    try {
      const setHash = await walletClient.writeContract({
        address: slashOracle as `0x${string}`, abi: ORACLE_ABI,
        functionName: "setSharpe", args: [agentId, sharpeWad],
      });
      await publicClient.waitForTransactionReceipt({ hash: setHash });

      const result = await publicClient.simulateContract({
        address: slashOracle as `0x${string}`, abi: ORACLE_ABI,
        functionName: "evaluateAndSlash", args: [agentId],
        account: walletClient.account,
      });
      if (Number(result.result) > 0) {
        await walletClient.writeContract(result.request);
        console.log(`[keeper] SLASHED agent=${agentId} bps=${result.result}`);
      }
    } catch (err) {
      console.error(`[keeper] agent=${agentId}:`, (err as Error).message?.slice(0,200));
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
