import { defineChain, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: [process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

// All Arc Testnet protocol addresses — never inline these in application code.
export const addresses = {
  USDC:                  "0x3600000000000000000000000000000000000000" as `0x${string}`,
  USYC:                  "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`,
  USYC_TELLER:           "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" as `0x${string}`,
  USYC_ENTITLEMENTS:     "0xcc205224862c7641930c87679e98999d23c26113" as `0x${string}`,
  IDENTITY_REGISTRY:     "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`,
  REPUTATION_REGISTRY:   "0x8004B663056A597Dffe9eCcC1965A193B7388713" as `0x${string}`,
  JOB_FACTORY:           "0x0747EEf0706327138c69792bF28Cd525089e4583" as `0x${string}`,
  GATEWAY_WALLET:        "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
  GATEWAY_MINTER:        "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as `0x${string}`,
  CCTP_MESSENGER_V2:     "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as `0x${string}`,
  CCTP_TRANSMITTER_V2:   "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
  MULTICALL3:            "0xcA11bde05977b3631167028862bE2a173976CA11" as `0x${string}`,
  STABLEFX_ESCROW:       "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8" as `0x${string}`,
  // Stork oracle — set once Arc Testnet address is published.
  // Pass this address to SlashOracle.setOracle() via DeployV3.s.sol env STORK_ORACLE_ADDR.
  STORK_ORACLE:          (process.env.STORK_ORACLE_ADDR ?? "") as `0x${string}`,
} as const;

export const CCTP_ARC_DOMAIN = 26;

// BTC/USD Stork asset ID — used for Sharpe evaluation freshness verification.
// Stork encodes asset IDs as right-padded UTF-8 bytes32: "BTCUSD" = 0x425443555344...
export const STORK_BTCUSD_ASSET_ID =
  "0x4254435553440000000000000000000000000000000000000000000000000000" as `0x${string}`;

// EIP-712 domain for PhronosRouter — must match the deployed contract exactly.
export const PHRONOS_EIP712_DOMAIN = {
  name: "Phronos Router",
  version: "1",
  chainId: 5042002,
} as const;

// Deployed v3 contract addresses — populated after DeployV3.s.sol broadcast.
export function getDeployedAddresses() {
  return {
    registry:    (process.env.PHRONOS_REGISTRY_ADDR   ?? "") as `0x${string}`,
    bond:        (process.env.PHRONOS_BOND_ADDR        ?? "") as `0x${string}`,
    router:      (process.env.PHRONOS_ROUTER_ADDR      ?? "") as `0x${string}`,
    slashOracle: (process.env.SLASH_ORACLE_ADDR        ?? "") as `0x${string}`,
    mockUsyc:    (process.env.MOCK_USYC_ADDR           ?? "") as `0x${string}`,
    operator:    (process.env.OPERATOR_ADDRESS         ?? "") as `0x${string}`,
  };
}

export function getPublicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

export function getWalletClient(privateKey: `0x${string}`) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: arcTestnet,
    transport: http(),
  });
}

export function arcscanTx(hash: string): string {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

export function arcscanAddress(addr: string): string {
  return `https://testnet.arcscan.app/address/${addr}`;
}

export function arcscanBlock(block: number | bigint): string {
  return `https://testnet.arcscan.app/block/${block}`;
}
