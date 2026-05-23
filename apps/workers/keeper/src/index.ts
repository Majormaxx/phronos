/**
 * Keeper: computes 7-day rolling Sharpe for each agent from on-chain IntentSubmitted events,
 * writes Sharpe to SlashOracle, triggers evaluateAndSlash.
 * Chain is source of truth — no DB dependency.
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

function computeSharpe(notionals: bigint[]): number {
  if (notionals.length < 2) return 0;
  const pnls = notionals.map((n) => Number(n) / 10_000_000);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length;
  const std = Math.sqrt(variance);
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
  const agentIdsBig = await publicClient.readContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "allAgentIds",
  });

  const currentBlock = await publicClient.getBlockNumber();
  // Arc Testnet: eth_getLogs max range is 10,000 blocks (~2.8h at 1s/block)
  const fromBlock = currentBlock > 9999n ? currentBlock - 9999n : 0n;

  const logs = await publicClient.getLogs({
    address: router,
    event: ROUTER_ABI[0],
    fromBlock,
    toBlock: currentBlock,
  });

  for (const agentId of agentIdsBig) {
    const agentLogs = logs.filter((l) => l.args.erc8004Id === agentId);
    const notionals = agentLogs.map((l) => l.args.notionalUSDC ?? 0n);
    const sharpe    = computeSharpe(notionals);
    const sharpeWad = BigInt(Math.round(sharpe * 1e18));
    console.log(`[keeper] agent=${agentId} intents=${agentLogs.length} sharpe=${sharpe.toFixed(4)}`);

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
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
