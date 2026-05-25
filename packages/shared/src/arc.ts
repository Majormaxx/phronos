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
  CCTP_MESSENGER_V2:     "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as `0x${string}`,
  CCTP_TRANSMITTER_V2:   "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
} as const;

export const CCTP_ARC_DOMAIN = 26;

// EIP-712 domain for PhronosRouter — must match the deployed contract exactly.
export const PHRONOS_EIP712_DOMAIN = {
  name: "Phronos Router",
  version: "1",
  chainId: 5042002,
} as const;

// Deployed v2 contract addresses — populated after DeployV2.s.sol broadcast.
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
