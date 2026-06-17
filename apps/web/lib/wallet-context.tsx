"use client";
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, http, type WalletClient } from "viem";
import { arcTestnet } from "@phronos/shared";

export type WalletType = "circle-sca" | "injected" | null;

// Circle env vars — all must be set for passkey mode to activate
const CIRCLE_CLIENT_KEY  = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY  ?? "";
const CIRCLE_CLIENT_URL  = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL  ?? "";
const CIRCLE_BUNDLER_URL = process.env.NEXT_PUBLIC_CIRCLE_BUNDLER_URL ?? "";
export const HAS_CIRCLE  = !!(CIRCLE_CLIENT_KEY && CIRCLE_CLIENT_URL && CIRCLE_BUNDLER_URL);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SCAAccount = any; // toCircleSmartAccount return type — avoid importing at module level

interface WalletCtx {
  address:         string | null;
  walletType:      WalletType;
  scaAccount:      SCAAccount | null;
  connectCircle:   () => Promise<void>;
  connectInjected: () => Promise<void>;
  disconnect:      () => void;
  /** viem WalletClient for writeContract / signTypedData */
  getWalletClient: () => Promise<WalletClient>;
  /** ERC-4337 modular client for sendUserOperation (Circle SCA only) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSCAClient:    () => Promise<any | null>;
}

const WalletContext = createContext<WalletCtx | null>(null);

export function useWallet(): WalletCtx {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be inside <WalletProvider>");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address,    setAddress]    = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [scaAccount, setScaAccount] = useState<SCAAccount | null>(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    const addr = localStorage.getItem("phronos_wallet");
    const type = localStorage.getItem("phronos_wallet_type") as WalletType;
    if (!addr || !type) return;

    if (type === "injected") {
      setAddress(addr);
      setWalletType("injected");
      // Listen for MetaMask account changes
      const eth = (window as Window & { ethereum?: { on: (e: string, h: (a: string[]) => void) => void; removeListener?: (e: string, h: (a: string[]) => void) => void } }).ethereum;
      if (eth) {
        const handler = (accounts: string[]) => {
          if (!accounts.length) { disconnect(); }
          else { localStorage.setItem("phronos_wallet", accounts[0]!); setAddress(accounts[0]!); }
        };
        eth.on("accountsChanged", handler);
      }
    } else if (type === "circle-sca" && HAS_CIRCLE) {
      // Re-assert passkey to restore scaAccount
      reassertPasskey(addr).catch(() => {
        // If reassertion fails (e.g. passkey removed), clear session
        localStorage.removeItem("phronos_wallet");
        localStorage.removeItem("phronos_wallet_type");
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reassertPasskey(expectedAddr: string) {
    const {
      toCircleSmartAccount, toPasskeyTransport,
      toWebAuthnCredential, WebAuthnMode,
    } = await import("@circle-fin/modular-wallets-core");

    const transport  = toPasskeyTransport(CIRCLE_CLIENT_URL, CIRCLE_CLIENT_KEY);
    const credential = await toWebAuthnCredential({
      transport,
      username: "phronos-user",
      mode:     WebAuthnMode.Login,   // Assert existing passkey credential
    });
    const pubClient = createPublicClient({ chain: arcTestnet, transport: http() });
    const account   = await toCircleSmartAccount({ client: pubClient, owner: credential });

    // Sanity-check the recovered address matches stored address
    if (account.address.toLowerCase() !== expectedAddr.toLowerCase()) {
      throw new Error("Passkey address mismatch");
    }
    setScaAccount(account);
    setAddress(account.address);
    setWalletType("circle-sca");
  }

  const connectCircle = useCallback(async () => {
    if (!HAS_CIRCLE) throw new Error("Circle env vars not configured");
    const {
      toCircleSmartAccount, toPasskeyTransport,
      toWebAuthnCredential, WebAuthnMode,
    } = await import("@circle-fin/modular-wallets-core");

    const transport  = toPasskeyTransport(CIRCLE_CLIENT_URL, CIRCLE_CLIENT_KEY);
    const credential = await toWebAuthnCredential({
      transport,
      username: "phronos-user",
      mode:     WebAuthnMode.Register,
    });
    const pubClient = createPublicClient({ chain: arcTestnet, transport: http() });
    const account   = await toCircleSmartAccount({ client: pubClient, owner: credential });

    setScaAccount(account);
    setAddress(account.address);
    setWalletType("circle-sca");
    localStorage.setItem("phronos_wallet",      account.address);
    localStorage.setItem("phronos_wallet_type", "circle-sca");
  }, []);

  const connectInjected = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eth = (window as any).ethereum;
    if (!eth) {
      await new Promise(r => setTimeout(r, 500));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eth = (window as any).ethereum;
    }
    if (!eth) throw new Error("No wallet detected. Install MetaMask or a Web3 wallet.");

    const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
    if (!accounts[0]) throw new Error("No accounts returned");

    setAddress(accounts[0]);
    setWalletType("injected");
    localStorage.setItem("phronos_wallet",      accounts[0]);
    localStorage.setItem("phronos_wallet_type", "injected");

    // Listen for account changes
    const handler = (accs: string[]) => {
      if (!accs.length) { disconnect(); }
      else { localStorage.setItem("phronos_wallet", accs[0]!); setAddress(accs[0]!); }
    };
    eth.on("accountsChanged", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function disconnect() {
    setAddress(null);
    setWalletType(null);
    setScaAccount(null);
    localStorage.removeItem("phronos_wallet");
    localStorage.removeItem("phronos_wallet_type");
  }

  const getWalletClient = useCallback(async (): Promise<WalletClient> => {
    if (walletType === "circle-sca" && scaAccount) {
      return createWalletClient({
        account:   scaAccount,
        chain:     arcTestnet,
        transport: http(CIRCLE_BUNDLER_URL || undefined),
      }) as WalletClient;
    }
    // Injected (MetaMask) path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet connected");
    const wc = createWalletClient({ transport: custom(eth), chain: arcTestnet });
    try { await wc.switchChain({ id: arcTestnet.id }); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch (e: any) { if (e.code === 4902) await wc.addChain({ chain: arcTestnet }); }
    return wc;
  }, [walletType, scaAccount]);

  // Returns the Circle modular client for sendUserOperation (SCA only), null otherwise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getSCAClient = useCallback(async (): Promise<any | null> => {
    if (walletType !== "circle-sca" || !scaAccount) return null;
    const { toCircleModularWalletClient } = await import("@circle-fin/modular-wallets-core");
    const wc = createWalletClient({
      account:   scaAccount,
      chain:     arcTestnet,
      transport: http(CIRCLE_BUNDLER_URL),
    });
    return toCircleModularWalletClient({ client: wc });
  }, [walletType, scaAccount]);

  return (
    <WalletContext.Provider value={{
      address, walletType, scaAccount,
      connectCircle, connectInjected, disconnect,
      getWalletClient, getSCAClient,
    }}>
      {children}
    </WalletContext.Provider>
  );
}
