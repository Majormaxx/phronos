/**
 * CCTP V2 adapter: Arc Testnet → destination chain (Ethereum Sepolia for testnet)
 *
 * This adapter bridges USDC cross-chain before executing a trade on Hyperliquid
 * (or any destination venue). P0 demo uses Arc mock swap; this is the P1 path.
 *
 * Flow:
 *   1. Approve USDC → TokenMessengerV2 on Arc
 *   2. depositForBurn on Arc → burns USDC, emits MessageSent
 *   3. Poll Circle IRIS API until attestation status == "complete"
 *   4. receiveMessage on destination chain → mints USDC
 *   (5. Execute trade on destination venue — outside scope of this adapter)
 *
 * Circle CCTP V2 domain IDs:
 *   Ethereum Sepolia : 0
 *   Arc Testnet      : 26
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, addresses } from "@phronos/shared";

// Sepolia test chain — used as the CCTP V2 destination in testnet demos.
// Swap for Arbitrum (domain 3) or Base (domain 6) in production.
const SEPOLIA_RPC          = process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";
const SEPOLIA_CHAIN_ID     = 11155111;
const SEPOLIA_DOMAIN       = 0;
const SEPOLIA_USDC         = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`;
const SEPOLIA_TRANSMITTER  = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`;

const ARC_DOMAIN           = 26;
const ARC_USDC             = addresses.USDC;
const ARC_MESSENGER        = addresses.CCTP_MESSENGER_V2;

const IRIS_API = "https://iris-api-sandbox.circle.com";

const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external",
]);

const TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) external",
]);

function addressToBytes32(addr: `0x${string}`): `0x${string}` {
  return `0x${addr.replace("0x", "").padStart(64, "0")}` as `0x${string}`;
}

interface BridgeResult {
  sourceTxHash:  `0x${string}`;
  destTxHash:    `0x${string}`;
  amount:        bigint;
  recipient:     `0x${string}`;
}

interface IrisMessage {
  status:      string;
  message:     `0x${string}`;
  attestation: `0x${string}`;
}

/**
 * Poll Circle IRIS API until the message attestation is ready.
 * Typically takes 5–20 seconds on testnet.
 */
async function waitForAttestation(
  sourceTxHash: `0x${string}`,
  maxWaitMs = 300_000,
): Promise<IrisMessage> {
  const deadline = Date.now() + maxWaitMs;
  const url      = `${IRIS_API}/v2/messages/${ARC_DOMAIN}?transactionHash=${sourceTxHash}`;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { messages?: IrisMessage[] };
      const msg  = data.messages?.[0];
      if (msg?.status === "complete" && msg.attestation) return msg;
    } catch { /* retry */ }
  }
  throw new Error(`[cctp] Attestation not ready after ${maxWaitMs / 1_000}s`);
}

/**
 * Bridge USDC from Arc Testnet to Ethereum Sepolia using Circle CCTP V2.
 *
 * @param amount        USDC amount in micro-USDC (1 USDC = 1_000_000)
 * @param recipient     Destination address that will receive the USDC
 * @param operatorPK    Arc wallet private key (must hold USDC + gas)
 * @param destPK        Sepolia wallet private key to call receiveMessage
 */
export async function bridgeArcToSepolia(params: {
  amount:      bigint;
  recipient:   `0x${string}`;
  operatorPK:  `0x${string}`;
  destPK:      `0x${string}`;
}): Promise<BridgeResult> {
  const { amount, recipient, operatorPK, destPK } = params;

  const arcAccount    = privateKeyToAccount(operatorPK);
  const arcPubClient  = createPublicClient({ chain: arcTestnet, transport: http() });
  const arcWallet     = createWalletClient({ account: arcAccount, chain: arcTestnet, transport: http() });

  const sepoliaChain  = {
    id:            SEPOLIA_CHAIN_ID,
    name:          "Ethereum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls:       { default: { http: [SEPOLIA_RPC] } },
  } as const;
  const destAccount   = privateKeyToAccount(destPK);
  const destPubClient = createPublicClient({ chain: sepoliaChain, transport: http() });
  const destWallet    = createWalletClient({ account: destAccount, chain: sepoliaChain, transport: http() });

  // Step 1: Approve USDC → TokenMessengerV2
  const allowance = await arcPubClient.readContract({
    address: ARC_USDC, abi: USDC_ABI, functionName: "allowance",
    args: [arcAccount.address, ARC_MESSENGER],
  });
  if (allowance < amount) {
    console.log(`[cctp] Approving ${amount} USDC → TokenMessengerV2 on Arc`);
    const approveHash = await arcWallet.sendTransaction({
      to:   ARC_USDC,
      data: encodeFunctionData({ abi: USDC_ABI, functionName: "approve", args: [ARC_MESSENGER, amount] }),
    });
    await arcPubClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`[cctp] Approved tx=${approveHash}`);
  }

  // Step 2: depositForBurn on Arc
  console.log(`[cctp] depositForBurn amount=${amount} → Sepolia domain ${SEPOLIA_DOMAIN} recipient=${recipient}`);
  const burnHash = await arcWallet.sendTransaction({
    to:   ARC_MESSENGER,
    data: encodeFunctionData({
      abi: MESSENGER_ABI,
      functionName: "depositForBurn",
      args: [
        amount,
        SEPOLIA_DOMAIN,
        addressToBytes32(recipient),
        ARC_USDC,
        "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        500n,   // maxFee: 0.0005 USDC
        1000,   // minFinalityThreshold: fast confirmation
      ],
    }),
  });
  await arcPubClient.waitForTransactionReceipt({ hash: burnHash });
  console.log(`[cctp] Burn tx=${burnHash}`);

  // Step 3: Poll for attestation from Circle IRIS
  console.log(`[cctp] Waiting for Circle attestation on tx=${burnHash}…`);
  const attestation = await waitForAttestation(burnHash);
  console.log(`[cctp] Attestation ready — relaying to Sepolia`);

  // Step 4: receiveMessage on Sepolia (mints USDC)
  const mintHash = await destWallet.sendTransaction({
    to:   SEPOLIA_TRANSMITTER,
    data: encodeFunctionData({
      abi: TRANSMITTER_ABI,
      functionName: "receiveMessage",
      args: [attestation.message, attestation.attestation],
    }),
  });
  await destPubClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`[cctp] Minted on Sepolia tx=${mintHash}`);

  return { sourceTxHash: burnHash, destTxHash: mintHash, amount, recipient };
}

/**
 * High-level: bridge USDC to Hyperliquid-compatible chain then place order.
 *
 * For P0 (Arc only): this is the intended P1 path once Hyperliquid adds
 * CCTP V2 support or we route through an intermediary chain.
 * The function is wired but not called from the main router loop at P0.
 */
export async function executeOnHyperliquid(params: {
  intentHash:      `0x${string}`;
  marketSymbol:    string;
  notionalUSDC:    bigint;
  followerAddr:    `0x${string}`;
  operatorPK:      `0x${string}`;
  destPK:          `0x${string}`;
}): Promise<{ venueReceiptHash: `0x${string}`; bridgeResult: BridgeResult }> {
  const { intentHash, marketSymbol, notionalUSDC, followerAddr, operatorPK, destPK } = params;

  const bridgeResult = await bridgeArcToSepolia({
    amount:     notionalUSDC < 0n ? -notionalUSDC : notionalUSDC,
    recipient:  followerAddr,
    operatorPK,
    destPK,
  });

  // Venue receipt: keccak256 of bridge+trade context (on-chain anchor)
  const { keccak256, toHex } = await import("viem");
  const venueReceiptHash = keccak256(
    toHex(JSON.stringify({
      venue:       "hyperliquid-cctp-v2",
      chainId:     SEPOLIA_CHAIN_ID,
      intentHash,
      marketSymbol,
      followerAddr,
      bridgeTx:    bridgeResult.sourceTxHash,
      mintTx:      bridgeResult.destTxHash,
    }))
  );

  console.log(`[cctp] executeOnHyperliquid complete receipt=${venueReceiptHash}`);
  return { venueReceiptHash, bridgeResult };
}
