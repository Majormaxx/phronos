/**
 * DCW operator setup — run once per deployment to wire Circle DCW wallets as
 * the registered operators for all four Phronos trader agents.
 *
 * What it does:
 *  1. Gets or creates a Circle DCW wallet for each agent (index 1–4).
 *  2. Calls PhronosRegistry.updateOperator(erc8004Id, dcwWallet.address)
 *     from the deployer private key (current operator).
 *  3. Prints CIRCLE_WALLET_ID_0{n}=<id> lines to persist in .env.
 *  4. [Mainnet only] Sets per-wallet spending limits via Circle API.
 *  5. Creates one SCA (Smart Contract Account) demo follower wallet for
 *     Gas Station testing — SCA wallets on Arc Testnet have gas sponsored
 *     by the preconfigured Gas Station policy automatically.
 *
 * Requirements:
 *   CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET + CIRCLE_WALLET_SET_ID must be set.
 *   DEPLOYER_PRIVATE_KEY must be set (current operator for all 4 agents).
 *   PHRONOS_REGISTRY_ADDR must point to a registry with updateOperator() (v2+).
 *
 * Run:
 *   pnpm tsx apps/workers/agents/setup-dcw.ts
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployedAddresses, getAgentWallet } from "@phronos/shared";

const DEPLOYER_PK     = (process.env.DEPLOYER_PRIVATE_KEY ?? "") as `0x${string}`;
const CIRCLE_API_KEY  = process.env.CIRCLE_API_KEY ?? "";
const CIRCLE_NETWORK  = process.env.CIRCLE_NETWORK ?? "testnet"; // "testnet" | "mainnet"
const IS_MAINNET      = CIRCLE_NETWORK === "mainnet";

const AGENT_IDS: [number, 1 | 2 | 3 | 4][] = [
  [Number(process.env.TRADER_01_AGENT_ID ?? "22892"), 1],
  [Number(process.env.TRADER_02_AGENT_ID ?? "22893"), 2],
  [Number(process.env.TRADER_03_AGENT_ID ?? "22897"), 3],
  [Number(process.env.TRADER_04_AGENT_ID ?? "22900"), 4],
];

const REGISTRY_ABI = parseAbi([
  "function updateOperator(uint256 erc8004Id, address newOperator) external",
  "function agentInfo(uint256 erc8004Id) external view returns (uint256, address, string, string, uint64, bool)",
  "event OperatorUpdated(uint256 indexed erc8004Id, address indexed oldOperator, address indexed newOperator)",
]);

// ── Spending policy (mainnet only) ────────────────────────────────────────────
// Circle DCW spending limits are only enforced on mainnet wallets.
// On testnet this call is skipped — set CIRCLE_NETWORK=mainnet to enable.
//
// Limits:
//   Daily:  $500 USDC max total outflow per wallet
//   Per-tx: $100 USDC max single transaction
//   Allowlist: only PhronosRouter and PhronosBond can receive funds
async function setSpendingPolicy(walletId: string, routerAddr: string, bondAddr: string): Promise<void> {
  if (!IS_MAINNET) {
    console.log(`[setup-dcw]   spending policy: SKIPPED (testnet — enable with CIRCLE_NETWORK=mainnet)`);
    return;
  }
  if (!CIRCLE_API_KEY) {
    console.warn(`[setup-dcw]   spending policy: SKIPPED (CIRCLE_API_KEY not set)`);
    return;
  }

  const baseUrl = "https://api.circle.com/v1/w3s";

  // Per-transaction limit: $100 USDC
  const txLimitRes = await fetch(`${baseUrl}/developer/wallets/${walletId}/limits`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      limits: [
        { limitType: "TRANSACTION", amount: "100" },
        { limitType: "DAILY",       amount: "500" },
      ],
    }),
  });
  if (!txLimitRes.ok) {
    const err = await txLimitRes.text();
    console.error(`[setup-dcw]   spending policy: FAILED (${txLimitRes.status}) ${err.slice(0, 200)}`);
    return;
  }

  // Contract allowlist: only PhronosRouter + PhronosBond
  const allowlistRes = await fetch(`${baseUrl}/developer/wallets/${walletId}/contractAllowlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      contracts: [
        { address: routerAddr, label: "PhronosRouter" },
        { address: bondAddr,   label: "PhronosBond"   },
      ],
    }),
  });
  if (!allowlistRes.ok) {
    const err = await allowlistRes.text();
    console.error(`[setup-dcw]   contract allowlist: FAILED (${allowlistRes.status}) ${err.slice(0, 200)}`);
    return;
  }

  console.log(`[setup-dcw]   spending policy: $100/tx, $500/day, allowlist: Router + Bond`);
}

// ── SCA demo follower wallet ──────────────────────────────────────────────────
// Creates one Smart Contract Account wallet for Gas Station demo.
// SCA wallets on Arc Testnet are automatically sponsored by the preconfigured
// Gas Station policy — no native gas token required for followers.
//
// For browser-based SCA wallets (passkey / WebAuthn), use @circle-fin/modular-wallets-core
// in the frontend instead. This function creates a developer-controlled SCA wallet
// suitable for automated/scripted follower testing.
async function createSCAFollowerWallet(): Promise<{ walletId: string; address: string } | null> {
  if (!CIRCLE_API_KEY || !process.env.CIRCLE_WALLET_SET_ID || !process.env.CIRCLE_ENTITY_SECRET) {
    console.warn("[setup-dcw] SCA follower wallet: SKIPPED (CIRCLE_API_KEY / CIRCLE_WALLET_SET_ID / CIRCLE_ENTITY_SECRET not set)");
    return null;
  }

  const body = {
    walletSetId: process.env.CIRCLE_WALLET_SET_ID,
    count: 1,
    blockchains: ["ARC-TESTNET"],
    accountType: "SCA", // Smart Contract Account — Gas Station sponsors gas
    metadata: [{ name: "phronos-demo-follower", refId: "follower-gas-station-demo" }],
  };

  const idempotencyKey = `phronos-sca-follower-${Date.now()}`;

  // Entity secret ciphertext is required for developer-controlled wallets
  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  const client = initiateDeveloperControlledWalletsClient({
    apiKey:              CIRCLE_API_KEY,
    entitySecret:        process.env.CIRCLE_ENTITY_SECRET!,
  });

  try {
    const response = await client.createWallets({
      idempotencyKey,
      walletSetId: process.env.CIRCLE_WALLET_SET_ID!,
      blockchains: ["ARC-TESTNET"],
      count: 1,
      accountType: "SCA",
      metadata: [{ name: "phronos-demo-follower", refId: "follower-gas-station-demo" }],
    });
    const wallet = response.data?.wallets?.[0];
    if (!wallet) return null;
    console.log(`[setup-dcw] SCA follower wallet created: ${wallet.address} (id=${wallet.id})`);
    console.log(`[setup-dcw] Gas Station: Arc Testnet preconfigured policy sponsors gas for this SCA wallet`);
    return { walletId: wallet.id, address: wallet.address };
  } catch (err) {
    console.error(`[setup-dcw] SCA follower wallet creation failed:`, (err as Error).message?.slice(0, 200));
    return null;
  }
}

async function main(): Promise<void> {
  if (!DEPLOYER_PK) {
    console.error("[setup-dcw] DEPLOYER_PRIVATE_KEY not set");
    process.exit(1);
  }

  const { registry, router: routerAddr, bond: bondAddr } = getDeployedAddresses();
  if (!registry) {
    console.error("[setup-dcw] PHRONOS_REGISTRY_ADDR not set");
    process.exit(1);
  }

  const account      = privateKeyToAccount(DEPLOYER_PK);
  const pubClient    = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  console.log(`[setup-dcw] Deployer:  ${account.address}`);
  console.log(`[setup-dcw] Registry:  ${registry}`);
  console.log(`[setup-dcw] Network:   ${CIRCLE_NETWORK}`);
  console.log();

  const envLines: string[] = [];

  for (const [erc8004Id, agentIndex] of AGENT_IDS) {
    console.log(`─── Agent ${agentIndex} (ERC-8004 ID ${erc8004Id}) ───`);

    // Step 1: Get or create DCW wallet
    let dcwWallet: { walletId: string; address: `0x${string}` } | null = null;
    try {
      dcwWallet = await getAgentWallet(agentIndex);
    } catch (err) {
      console.error(`[setup-dcw] getAgentWallet(${agentIndex}) failed:`, (err as Error).message);
    }

    if (!dcwWallet) {
      console.warn(`[setup-dcw] No DCW wallet for agent ${agentIndex} — skipping`);
      continue;
    }

    console.log(`[setup-dcw] DCW wallet address: ${dcwWallet.address}`);
    console.log(`[setup-dcw] DCW wallet ID:      ${dcwWallet.walletId}`);
    envLines.push(`CIRCLE_WALLET_ID_0${agentIndex}=${dcwWallet.walletId}`);

    // Step 2: Check current operator on-chain
    let currentOperator: `0x${string}`;
    try {
      const info = await pubClient.readContract({
        address: registry,
        abi:     REGISTRY_ABI,
        functionName: "agentInfo",
        args:    [BigInt(erc8004Id)],
      });
      currentOperator = info[1] as `0x${string}`;
      console.log(`[setup-dcw] Current operator:  ${currentOperator}`);
    } catch (err) {
      console.error(`[setup-dcw] agentInfo failed:`, (err as Error).message);
      continue;
    }

    if (currentOperator.toLowerCase() === dcwWallet.address.toLowerCase()) {
      console.log(`[setup-dcw] Operator already matches DCW wallet — skipping\n`);
      // Still set spending policy in case it wasn't set on prior run
      await setSpendingPolicy(dcwWallet.walletId, routerAddr, bondAddr);
      console.log();
      continue;
    }

    if (currentOperator.toLowerCase() !== account.address.toLowerCase()) {
      console.warn(`[setup-dcw] Deployer is not the current operator (got ${currentOperator}) — cannot update\n`);
      continue;
    }

    // Step 3: Call updateOperator from deployer
    console.log(`[setup-dcw] Calling updateOperator(${erc8004Id}, ${dcwWallet.address})`);
    try {
      const { request } = await pubClient.simulateContract({
        address:      registry,
        abi:          REGISTRY_ABI,
        functionName: "updateOperator",
        args:         [BigInt(erc8004Id), dcwWallet.address],
        account,
      });
      const hash = await walletClient.writeContract(request);
      await pubClient.waitForTransactionReceipt({ hash });
      console.log(`[setup-dcw] OperatorUpdated tx=${hash}`);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("updateOperator")) {
        console.error(`[setup-dcw] updateOperator not found on registry — redeploy with latest source`);
      } else {
        console.error(`[setup-dcw] updateOperator failed:`, msg.slice(0, 300));
      }
      continue;
    }

    // Step 4: Set spending policy (mainnet only, silently skipped on testnet)
    await setSpendingPolicy(dcwWallet.walletId, routerAddr, bondAddr);

    console.log(`[setup-dcw] Agent ${agentIndex} operator → ${dcwWallet.address}\n`);
  }

  // Step 5: Create SCA demo follower wallet for Gas Station testing
  console.log(`─── SCA follower wallet (Gas Station demo) ───`);
  const scaWallet = await createSCAFollowerWallet();
  if (scaWallet) {
    envLines.push(`CIRCLE_SCA_FOLLOWER_WALLET_ID=${scaWallet.walletId}`);
    envLines.push(`CIRCLE_SCA_FOLLOWER_ADDRESS=${scaWallet.address}`);
    console.log(`[setup-dcw] Fund this wallet with USDC to test gasless depositFollower:`);
    console.log(`  Address: ${scaWallet.address}`);
    console.log(`  Transactions on Arc Testnet will be sponsored by Gas Station automatically.`);
  }
  console.log();

  if (envLines.length > 0) {
    console.log("═══ Persist these in your .env ═══");
    for (const line of envLines) console.log(line);
  }
}

main().catch((err) => {
  console.error("[setup-dcw] Fatal:", err);
  process.exit(1);
});
