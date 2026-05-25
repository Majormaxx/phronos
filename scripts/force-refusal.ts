/**
 * Force a single on-chain Refused event for demo purposes.
 *
 * Fetches the most recent IntentSubmitted event from PhronosRouter,
 * then calls recordRefusal as the VENUE_ROLE wallet.
 *
 * Usage (from repo root):
 *   pnpm --filter @phronos/router exec tsx ../../scripts/force-refusal.ts
 *
 * Or with dotenv loaded manually:
 *   node -r dotenv/config -e "require('tsx/cjs'); require('./scripts/force-refusal.ts')"
 *
 * Simplest: copy .env vars into shell and run:
 *   export $(grep -v '^#' .env | xargs) && npx tsx scripts/force-refusal.ts
 */
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── config (read from env) ────────────────────────────────────────────────────
const PK     = (process.env.ROUTER_PRIVATE_KEY     ?? "") as `0x${string}`;
const ROUTER = (process.env.PHRONOS_ROUTER_ADDR    ?? "") as `0x${string}`;
const RPC    =  process.env.ARC_TESTNET_RPC         ?? "https://rpc.testnet.arc.network";
const FOLLOWER = (process.env.OPERATOR_ADDRESS      ?? "0x1BD759e9a1D70ce5F4f14e4D0501ffFdf534350E") as `0x${string}`;

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const ROUTER_ABI = parseAbi([
  "event IntentSubmitted(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 venue, int256 notionalUSDC, bytes32 traceCID)",
  "function recordRefusal(bytes32 intentHash, uint256 erc8004Id, address follower, uint8 reason, bytes32 reasonCID) external",
]);

async function main() {
  if (!PK)     { console.error("ROUTER_PRIVATE_KEY not set"); process.exit(1); }
  if (!ROUTER) { console.error("PHRONOS_ROUTER_ADDR not set"); process.exit(1); }

  const client       = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account: privateKeyToAccount(PK), chain: arcTestnet, transport: http() });

  const currentBlock = await client.getBlockNumber();
  const fromBlock    = currentBlock > 9999n ? currentBlock - 9999n : 0n;

  console.log(`Scanning blocks ${fromBlock}–${currentBlock} for IntentSubmitted…`);

  const logs = await client.getLogs({
    address: ROUTER,
    event:   ROUTER_ABI[0],
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    console.error("No IntentSubmitted events found in the last 10k blocks.");
    process.exit(1);
  }

  const log = logs[logs.length - 1]!;
  const { intentHash, erc8004Id, notionalUSDC } = log.args;
  if (!intentHash || !erc8004Id) { console.error("Missing event args"); process.exit(1); }

  console.log(`\nUsing most recent intent:`);
  console.log(`  intentHash  : ${intentHash}`);
  console.log(`  agent       : ${erc8004Id}`);
  console.log(`  notional    : ${notionalUSDC}`);
  console.log(`  follower    : ${FOLLOWER}`);

  const reason    = `Macro shift: BTC funding rate z-score 0.72 exceeded testnet threshold 0.5σ (agent ${erc8004Id})`;
  const blob      = JSON.stringify({ refuser: "macro_shift", allow: false, reason, zscore: 0.72, timestamp: Date.now() });
  const reasonCID = keccak256(toHex(blob)) as `0x${string}`;

  console.log(`\nReasonCID   : ${reasonCID}`);

  const { request } = await client.simulateContract({
    address:      ROUTER,
    abi:          ROUTER_ABI,
    functionName: "recordRefusal",
    args:         [intentHash, erc8004Id, FOLLOWER, 2, reasonCID],
    account:      walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  console.log(`\n✓ Refused tx : ${txHash}`);
  console.log(`  Arcscan    : https://testnet.arcscan.app/tx/${txHash}`);

  await client.waitForTransactionReceipt({ hash: txHash });
  console.log("✓ Confirmed on-chain — Refused event emitted");
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
