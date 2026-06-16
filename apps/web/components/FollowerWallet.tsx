"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData } from "viem";
import { addresses, arcTestnet, CCTP_ARC_DOMAIN } from "@phronos/shared";

const ROUTER = (process.env.NEXT_PUBLIC_PHRONOS_ROUTER_ADDR ?? "0x7988558ed4B654cFc3D89C352b41053ac1d14e3F") as `0x${string}`;
const USDC   = addresses.USDC;

// Circle modular wallets env vars (set in .env.local for Gas Station mode)
const CIRCLE_CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "";
const CIRCLE_CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ?? "";
const CIRCLE_BUNDLER_URL = process.env.NEXT_PUBLIC_CIRCLE_BUNDLER_URL ?? "";

const HAS_CIRCLE_WALLET = !!(CIRCLE_CLIENT_KEY && CIRCLE_CLIENT_URL && CIRCLE_BUNDLER_URL);

const ERC20_ABI = [
  { name: "approve",   type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const ROUTER_ABI = [
  { name: "depositFollower",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "withdrawFollower", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "escrowOf",         type: "function", stateMutability: "view",       inputs: [{ name: "follower", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// CCTP V2 — Arc Testnet burn+mint bridge to Arc from other chains
const CCTP_MESSENGER_ABI = [
  {
    name: "depositForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount",            type: "uint256" },
      { name: "destinationDomain", type: "uint32"  },
      { name: "mintRecipient",     type: "bytes32" },
      { name: "burnToken",         type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

const CCTP_TRANSMITTER_ABI = [
  {
    name: "receiveMessage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message",     type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const IRIS_API = "https://iris-api-sandbox.circle.com/v2/messages/0";

const REASON_NAMES: Record<number, string> = {
  1: "LLM judgment",
  2: "Macro shift",
  3: "Whale contradiction",
};

// Sepolia USDC + CCTP messenger (for cross-chain deposit demo)
const SEPOLIA_USDC    = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`;
const SEPOLIA_CCTP_V2 = "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5" as `0x${string}`;

type WalletMode = "metamask" | "circle-sca";

interface Copy {
  intentHash:       string;
  followerAddr:     string;
  followerNotional: string;
  venueReceipt:     string;
  executedAt:       string;
}

interface Refusal {
  intentHash:   string;
  followerAddr: string;
  reason:       number;
  reasonName:   string;
  reasonCid:    string;
  refusedAt:    string;
}

function getEth() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected");
  return eth;
}

function getPubClient() {
  return createPublicClient({ chain: arcTestnet, transport: custom(getEth()) });
}

function getWalletClientEOA() {
  return createWalletClient({ chain: arcTestnet, transport: custom(getEth()) });
}

async function switchToArc(): Promise<void> {
  const wc = getWalletClientEOA();
  try {
    await wc.switchChain({ id: arcTestnet.id });
  } catch (err: any) {
    if (err.code === 4902) await wc.addChain({ chain: arcTestnet });
  }
}

export function FollowerWallet() {
  const [address,    setAddress]    = useState<string | null>(null);
  const [escrow,     setEscrow]     = useState<bigint>(0n);
  const [usdcBal,    setUsdcBal]    = useState<bigint>(0n);
  const [copies,     setCopies]     = useState<Copy[]>([]);
  const [refusals,   setRefusals]   = useState<Refusal[]>([]);
  const [amount,     setAmount]     = useState("1");
  const [step,       setStep]       = useState<"idle" | "approving" | "depositing" | "withdrawing" | "creating-sca" | "bridging">("idle");
  const [txHash,     setTxHash]     = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [walletMode,    setWalletMode]    = useState<WalletMode>("metamask");
  const [scaAccount,    setScaAccount]    = useState<any>(null);
  const [showBridge,    setShowBridge]    = useState(false);
  const [cctpBurnTx,    setCctpBurnTx]    = useState<string | null>(null);
  const [cctpStatus,    setCctpStatus]    = useState<"idle" | "polling" | "minting" | "done">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadChainData = useCallback(async (addr: `0x${string}`) => {
    try {
      const pub = createPublicClient({ chain: arcTestnet, transport: http() });
      const [esc, bal] = await Promise.all([
        pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "escrowOf",  args: [addr] }),
        pub.readContract({ address: USDC,   abi: ERC20_ABI,  functionName: "balanceOf", args: [addr] }),
      ]);
      setEscrow(esc);
      setUsdcBal(bal);
    } catch { /* rpc may not be available */ }
  }, []);

  const loadActivity = useCallback(async (addr: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/follower/${addr}`);
      if (res.ok) {
        const data = await res.json() as { copies: Copy[]; refusals: Refusal[] };
        setCopies(data.copies ?? []);
        setRefusals(data.refusals ?? []);
      }
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("phronos_wallet");
    if (stored) { setAddress(stored); loadChainData(stored as `0x${string}`); loadActivity(stored); }

    const eth = (window as any).ethereum;
    if (!eth) return;
    const handler = (accs: string[]) => {
      const acc = accs[0] ?? null;
      if (acc) {
        localStorage.setItem("phronos_wallet", acc);
        setAddress(acc);
        loadChainData(acc as `0x${string}`);
        loadActivity(acc);
      } else {
        localStorage.removeItem("phronos_wallet");
        setAddress(null);
        setScaAccount(null);
      }
    };
    eth.on("accountsChanged", handler);
    return () => eth.removeListener?.("accountsChanged", handler);
  }, [loadChainData, loadActivity]);

  // ── CCTP V2 attestation polling + auto-mint on Arc ───────────────────────
  useEffect(() => {
    if (cctpStatus !== "polling" || !cctpBurnTx || !address) return;

    async function pollAttestation() {
      try {
        const res = await fetch(`${IRIS_API}?transactionHash=${cctpBurnTx}`);
        if (!res.ok) return;
        const data = await res.json() as { messages?: Array<{ status: string; message: string; attestation: string }> };
        const msg = data.messages?.[0];
        if (!msg || msg.status !== "complete" || !msg.attestation || msg.attestation === "PENDING") return;

        // Attestation ready — stop polling and mint on Arc
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setCctpStatus("minting");

        const eth = (window as any).ethereum;
        if (!eth) { setCctpStatus("idle"); return; }

        const arcWc = createWalletClient({ chain: arcTestnet, transport: custom(eth) });
        await arcWc.switchChain({ id: arcTestnet.id }).catch(async (err: any) => {
          if (err.code === 4902) await arcWc.addChain({ chain: arcTestnet });
        });

        const mintTx = await arcWc.writeContract({
          address:      addresses.CCTP_TRANSMITTER_V2,
          abi:          CCTP_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args:         [msg.message as `0x${string}`, msg.attestation as `0x${string}`],
          account:      address as `0x${string}`,
          chain:        arcTestnet,
        });

        setTxHash(mintTx);
        setCctpStatus("done");
        await loadChainData(address as `0x${string}`);
      } catch { /* poll silently */ }
    }

    pollRef.current = setInterval(pollAttestation, 10_000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [cctpStatus, cctpBurnTx, address, loadChainData]);

  // ── MetaMask EOA deposit (current mode) ────────────────────────────────────
  async function deposit() {
    if (!address) return;
    if (walletMode === "circle-sca") { await depositSCA(); return; }
    setError(null);
    const amtMicro = BigInt(Math.round(parseFloat(amount) * 1e6));
    const acc = address as `0x${string}`;
    try {
      await switchToArc();
      const pub = getPubClient();
      const wc  = getWalletClientEOA();

      const allowance = await pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [acc, ROUTER] });
      if (allowance < amtMicro) {
        setStep("approving");
        await wc.writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [ROUTER, amtMicro], account: acc, chain: arcTestnet });
        await new Promise(r => setTimeout(r, 3000));
      }

      setStep("depositing");
      const hash = await wc.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "depositFollower", args: [amtMicro], account: acc, chain: arcTestnet });
      setTxHash(hash);
      setStep("idle");
      await loadChainData(acc);
      await loadActivity(acc);
    } catch (e: any) {
      setError(e.message ?? "Transaction rejected");
      setStep("idle");
    }
  }

  // ── Circle SCA / Gas Station deposit (gasless) ─────────────────────────────
  // Uses Circle Modular Wallets SDK: passkey-based SCA + Arc Testnet Gas Station.
  // Arc Testnet has a preconfigured Gas Station policy — no native gas required.
  // Bundles approve + depositFollower into a single UserOperation.
  async function createCircleSCAWallet(): Promise<void> {
    if (!HAS_CIRCLE_WALLET) {
      setError("Set NEXT_PUBLIC_CIRCLE_CLIENT_KEY, NEXT_PUBLIC_CIRCLE_CLIENT_URL, and NEXT_PUBLIC_CIRCLE_BUNDLER_URL to enable gas-free wallet.");
      return;
    }
    setError(null);
    setStep("creating-sca");
    try {
      const {
        toCircleSmartAccount,
        toPasskeyTransport,
        toWebAuthnCredential,
        WebAuthnMode,
      } = await import("@circle-fin/modular-wallets-core");

      const transport   = toPasskeyTransport(CIRCLE_CLIENT_URL, CIRCLE_CLIENT_KEY);
      // Register a new passkey (WebAuthn credential) for this follower
      const credential  = await toWebAuthnCredential({ transport, username: "phronos-follower", mode: WebAuthnMode.Register });
      const pubClient   = createPublicClient({ chain: arcTestnet, transport: http() });
      const account     = await toCircleSmartAccount({ client: pubClient, owner: credential });

      setScaAccount(account);
      setAddress(account.address);
      setWalletMode("circle-sca");
      localStorage.setItem("phronos_wallet", account.address);
      await loadChainData(account.address as `0x${string}`);
      await loadActivity(account.address);
      setStep("idle");
    } catch (e: any) {
      setError(e.message ?? "Failed to create Circle SCA wallet");
      setStep("idle");
    }
  }

  async function depositSCA(): Promise<void> {
    if (!scaAccount) { setError("Create a gas-free wallet first"); return; }
    setError(null);
    const amtMicro = BigInt(Math.round(parseFloat(amount) * 1e6));
    try {
      const {
        toCircleModularWalletClient,
      } = await import("@circle-fin/modular-wallets-core");

      // Create bundler-backed wallet client for ERC-4337 UserOperation flow.
      // Arc Testnet Gas Station automatically sponsors gas for SCA wallets.
      const walletClient = createWalletClient({
        account: scaAccount,
        chain:   arcTestnet,
        transport: http(CIRCLE_BUNDLER_URL),
      });
      const modularClient = toCircleModularWalletClient({ client: walletClient });

      setStep("depositing");

      // Batch: approve USDC + depositFollower in one gasless UserOperation
      const hash = await (modularClient as any).sendUserOperation({
        calls: [
          {
            to:   USDC,
            data: encodeFunctionData({
              abi:          ERC20_ABI,
              functionName: "approve",
              args:         [ROUTER, amtMicro],
            }),
          },
          {
            to:   ROUTER,
            data: encodeFunctionData({
              abi:          ROUTER_ABI,
              functionName: "depositFollower",
              args:         [amtMicro],
            }),
          },
        ],
        paymaster: true, // Gas Station sponsors gas — no USDC for gas needed
      });

      setTxHash(typeof hash === "string" ? hash : (hash as any).userOpHash ?? "");
      setStep("idle");
      await loadChainData(scaAccount.address as `0x${string}`);
      await loadActivity(scaAccount.address);
    } catch (e: any) {
      setError(e.message ?? "Gasless transaction failed");
      setStep("idle");
    }
  }

  async function withdraw() {
    if (!address || escrow === 0n) return;
    setError(null);
    const acc = address as `0x${string}`;
    try {
      await switchToArc();
      const wc = getWalletClientEOA();
      setStep("withdrawing");
      const hash = await wc.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "withdrawFollower", args: [escrow], account: acc, chain: arcTestnet });
      setTxHash(hash);
      setStep("idle");
      await loadChainData(acc);
    } catch (e: any) {
      setError(e.message ?? "Transaction rejected");
      setStep("idle");
    }
  }

  // ── Cross-chain USDC bridge via Circle CCTP V2 ────────────────────────────
  // Bridges USDC from Ethereum Sepolia → Arc Testnet.
  // Uses the standard CCTP V2 depositForBurn flow.
  // CCTP_ARC_DOMAIN = 26 (Arc Testnet destination domain).
  async function bridgeFromSepolia(): Promise<void> {
    if (!address) return;
    setError(null);
    const amtMicro = BigInt(Math.round(parseFloat(amount) * 1e6));
    const recipient = address as `0x${string}`;
    // CCTP requires recipient as left-padded bytes32
    const mintRecipient = `0x${recipient.slice(2).padStart(64, "0")}` as `0x${string}`;

    try {
      // We need the user's Sepolia wallet — switch MetaMask to Sepolia
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("MetaMask required for cross-chain bridge");

      const sepoliaWc = createWalletClient({ transport: custom(eth) });
      await sepoliaWc.switchChain({ id: 11155111 }).catch(async (err: any) => {
        if (err.code === 4902) await sepoliaWc.addChain({
          chain: {
            id: 11155111,
            name: "Sepolia",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: ["https://rpc.sepolia.org"] } },
          } as any,
        });
      });

      const [accts] = await Promise.all([eth.request({ method: "eth_accounts" })]);
      const sepoliaAccount = accts[0] as `0x${string}`;

      const sepoliaPub = createPublicClient({ chain: { id: 11155111 } as any, transport: custom(eth) });

      setStep("approving");
      // Approve CCTP messenger to spend Sepolia USDC
      const approveTx = await sepoliaWc.writeContract({
        address:      SEPOLIA_USDC,
        abi:          ERC20_ABI,
        functionName: "approve",
        args:         [SEPOLIA_CCTP_V2, amtMicro],
        account:      sepoliaAccount,
        chain:        { id: 11155111 } as any,
      });
      await sepoliaPub.waitForTransactionReceipt({ hash: approveTx });

      setStep("bridging");
      // Burn USDC on Sepolia → mint on Arc (Circle CCTP V2, Arc domain 26)
      const burnTx = await sepoliaWc.writeContract({
        address:      SEPOLIA_CCTP_V2,
        abi:          CCTP_MESSENGER_ABI,
        functionName: "depositForBurn",
        args:         [amtMicro, CCTP_ARC_DOMAIN, mintRecipient, SEPOLIA_USDC],
        account:      sepoliaAccount,
        chain:        { id: 11155111 } as any,
      });

      setTxHash(burnTx);
      setCctpBurnTx(burnTx);
      setCctpStatus("polling");
      setStep("idle");
      setShowBridge(false);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Bridge failed");
      setStep("idle");
    }
  }

  if (!address) {
    return (
      <div className="border border-ink/10 p-6 bg-ink/[0.02] text-center">
        <p className="text-sm font-medium mb-1">Connect your wallet to start copying</p>
        <p className="text-xs text-ink/50 mb-4">Deposit USDC escrow, pick an agent, and every intent they emit gets copied to your account after three policy checks pass.</p>
        {HAS_CIRCLE_WALLET && (
          <button
            onClick={createCircleSCAWallet}
            disabled={step !== "idle"}
            className="btn-primary text-xs py-1.5 px-4 mr-3 disabled:opacity-50"
          >
            {step === "creating-sca" ? "Creating wallet…" : "Gas-free wallet ↗"}
          </button>
        )}
        <p className="text-xs text-ink/30 mt-3">Or use the <span className="text-terracotta">Connect wallet</span> button in the top-right nav.</p>
        {error && <p className="text-xs text-terracotta mt-3">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Wallet mode indicator */}
      {walletMode === "circle-sca" && (
        <div className="flex items-center gap-2 text-xs text-olive border border-olive/20 bg-olive/5 px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-olive inline-block" />
          Gas-free wallet active — Circle SCA via Arc Testnet Gas Station
        </div>
      )}

      {/* CCTP bridge status */}
      {cctpStatus === "polling" && (
        <div className="flex items-center gap-2 text-xs text-amber-600 border border-amber-600/20 bg-amber-600/5 px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse inline-block" />
          Waiting for Circle attestation — checking every 10s… USDC arrives on Arc in ~1–2 min
        </div>
      )}
      {cctpStatus === "minting" && (
        <div className="flex items-center gap-2 text-xs text-olive border border-olive/20 bg-olive/5 px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse inline-block" />
          Minting USDC on Arc — submitting receiveMessage…
        </div>
      )}
      {cctpStatus === "done" && (
        <div className="flex items-center gap-2 text-xs text-olive border border-olive/20 bg-olive/5 px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-olive inline-block" />
          Bridge complete — USDC minted on Arc
          <button onClick={() => setCctpStatus("idle")} className="ml-auto text-ink/30 hover:text-ink">✕</button>
        </div>
      )}

      {/* Wallet balances */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Escrow balance</p>
          <p className="font-mono text-lg">${(Number(escrow) / 1e6).toFixed(4)} USDC</p>
          <p className="text-xs text-ink/30 mt-1 font-mono">{address.slice(0, 10)}…</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Wallet USDC</p>
          <p className="font-mono text-lg">${(Number(usdcBal) / 1e6).toFixed(4)} USDC</p>
          <p className="text-xs text-ink/30 mt-1">{walletMode === "circle-sca" ? "Gas Station wallet" : "Arc Testnet balance"}</p>
        </div>
      </div>

      {/* Deposit / withdraw */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium">Manage escrow</p>
          <div className="flex items-center gap-2 text-xs text-ink/40">
            <button
              onClick={() => setShowBridge(!showBridge)}
              className="hover:text-ink transition-colors"
            >
              From another chain ↓
            </button>
            {HAS_CIRCLE_WALLET && walletMode === "metamask" && (
              <button
                onClick={createCircleSCAWallet}
                disabled={step !== "idle"}
                className="text-olive hover:text-olive/80 transition-colors disabled:opacity-50"
              >
                {step === "creating-sca" ? "Creating…" : "Use gas-free wallet"}
              </button>
            )}
          </div>
        </div>

        {/* Cross-chain bridge (CCTP V2 Sepolia → Arc) */}
        {showBridge && (
          <div className="mb-4 p-3 border border-ink/10 bg-ink/[0.02] text-xs">
            <p className="text-ink/60 mb-2 font-medium">Bridge USDC from Ethereum Sepolia → Arc</p>
            <p className="text-ink/40 mb-3">
              Uses Circle CCTP V2 (Arc domain {CCTP_ARC_DOMAIN}). Burns USDC on Sepolia and mints
              on Arc in ~1–2 min. Requires MetaMask with Sepolia network.
            </p>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-24 border border-ink/10 bg-transparent px-2 py-1 font-mono focus:outline-none focus:border-ink/30"
              />
              <span className="text-ink/40">USDC</span>
              <button
                onClick={bridgeFromSepolia}
                disabled={step !== "idle"}
                className="btn-ghost text-xs py-1 px-3 disabled:opacity-50 ml-auto"
              >
                {step === "bridging" ? "Bridging…" : step === "approving" ? "Approving…" : "Bridge →"}
              </button>
            </div>
            {txHash && step === "idle" && (
              <p className="text-olive mt-2 font-mono">
                Bridge tx: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{txHash.slice(0, 18)}…↗</a>
                <span className="text-ink/30 ml-2">(USDC arrives on Arc in ~2 min)</span>
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-ink/40 block mb-1.5">
              Amount (USDC)
              {walletMode === "circle-sca" && <span className="text-olive ml-2">· gasless</span>}
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border border-ink/10 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-ink/30"
            />
          </div>
          <button
            onClick={deposit}
            disabled={step !== "idle"}
            className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
          >
            {step === "approving" ? "Approving…" : step === "depositing" ? "Depositing…" : "Deposit"}
          </button>
          {escrow > 0n && (
            <button
              onClick={withdraw}
              disabled={step !== "idle"}
              className="btn-ghost text-sm py-2 px-4 disabled:opacity-50"
            >
              {step === "withdrawing" ? "Withdrawing…" : "Withdraw all"}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-terracotta mt-3">{error}</p>}
        {txHash && step === "idle" && !showBridge && (
          <p className="text-xs text-olive mt-3 font-mono">
            Tx: <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{txHash.slice(0, 18)}…↗</a>
          </p>
        )}
      </div>

      {/* Copy trades */}
      <div>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl">Copies executed</h2>
          {loading && <span className="text-xs text-ink/30">Loading…</span>}
        </div>
        {!loading && copies.length === 0 && (
          <p className="text-ink/30 text-sm">No copies yet — deposit escrow and the router will copy intents automatically.</p>
        )}
        {copies.map((c) => (
          <div key={`${c.intentHash}-copy`} className="flex items-start justify-between py-3 border-b border-ink/5 text-sm">
            <div>
              <span className={`text-xs font-mono px-2 py-0.5 mr-3 ${Number(c.followerNotional) >= 0 ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                {Number(c.followerNotional) >= 0 ? "LONG" : "SHORT"}
              </span>
              <Link href={`/traces/${c.intentHash}`} className="font-mono text-xs text-ink/40 hover:text-terracotta">
                {c.intentHash.slice(0, 16)}… ↗
              </Link>
            </div>
            <div className="text-right">
              <p className="font-mono">${(Math.abs(Number(c.followerNotional)) / 1e6).toFixed(4)}</p>
              <p className="text-xs text-ink/30">{new Date(c.executedAt).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Blocked copies */}
      {refusals.length > 0 && (
        <div>
          <h2 className="font-display text-2xl mb-4">Blocked copies</h2>
          {refusals.map((r) => (
            <div key={`${r.intentHash}-refusal`} className="flex items-start justify-between py-3 border-b border-ink/5 text-sm">
              <div>
                <span className="text-xs font-mono px-2 py-0.5 mr-3 bg-terracotta/10 text-terracotta border border-terracotta/20">
                  REFUSED
                </span>
                <span className="text-xs text-ink/50 mr-3">{r.reasonName ?? REASON_NAMES[r.reason] ?? `Code ${r.reason}`}</span>
                <Link href={`/traces/${r.intentHash}`} className="font-mono text-xs text-ink/30 hover:text-terracotta">
                  {r.intentHash.slice(0, 14)}… ↗
                </Link>
              </div>
              <p className="text-xs text-ink/25 shrink-0 ml-3">
                {new Date(r.refusedAt).toLocaleTimeString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
