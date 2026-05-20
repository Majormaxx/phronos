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
    default: { name: "Arcscan", url: "https://scan.testnet.arc.network" },
  },
  testnet: true,
});

// All Arc Testnet addresses in one place — never inline these in application code.
export const addresses = {
  USDC:               "0x3600000000000000000000000000000000000000" as `0x${string}`,
  USYC:               "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`,
  USYC_TELLER:        "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" as `0x${string}`,
  IDENTITY_REGISTRY:  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`,
  REPUTATION_REGISTRY:"0x8004B663056A597Dffe9eCcC1965A193B7388713" as `0x${string}`,
  GATEWAY_WALLET:     "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
  CCTP_MESSENGER_V2:  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as `0x${string}`,
  CCTP_TRANSMITTER_V2:"0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
} as const;

export const CCTP_ARC_DOMAIN = 26;

// Deployed contract addresses — populated after Day 2 deploy.
export function getDeployedAddresses() {
  return {
    vault:         (process.env.VAULT_ADDRESS         ?? "") as `0x${string}`,
    benchRegistry: (process.env.BENCH_REGISTRY_ADDRESS ?? "") as `0x${string}`,
    slashOracle:   (process.env.SLASH_ORACLE_ADDRESS   ?? "") as `0x${string}`,
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
