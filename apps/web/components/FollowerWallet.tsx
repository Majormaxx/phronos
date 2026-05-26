"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom } from "viem";
import { addresses, arcTestnet } from "@phronos/shared";

const ROUTER = (process.env.NEXT_PUBLIC_PHRONOS_ROUTER_ADDR ?? "0x7988558ed4B654cFc3D89C352b41053ac1d14e3F") as `0x${string}`;
const USDC   = addresses.USDC;

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

const REASON_NAMES: Record<number, string> = {
  1: "LLM judgment",
  2: "Macro shift",
  3: "Whale contradiction",
};

interface Copy {
  intentHash:       string;
  followerAddr:     string;
  followerNotional: string;
  venueReceipt:     string;
  executedAt:       string;
}

interface Refusal {
  intentHash:  string;
  followerAddr: string;
  reason:      number;
  reasonName:  string;
  reasonCid:   string;
  refusedAt:   string;
}

function getEth() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected");
  return eth;
}

function getPubClient() {
  return createPublicClient({ chain: arcTestnet, transport: custom(getEth()) });
}

function getWalletClient() {
  return createWalletClient({ chain: arcTestnet, transport: custom(getEth()) });
}

async function switchToArc(): Promise<void> {
  const wc = getWalletClient();
  try {
    await wc.switchChain({ id: arcTestnet.id });
  } catch (err: any) {
    if (err.code === 4902) await wc.addChain({ chain: arcTestnet });
  }
}

export function FollowerWallet() {
  const [address,  setAddress]  = useState<string | null>(null);
  const [escrow,   setEscrow]   = useState<bigint>(0n);
  const [usdcBal,  setUsdcBal]  = useState<bigint>(0n);
  const [copies,   setCopies]   = useState<Copy[]>([]);
  const [refusals, setRefusals] = useState<Refusal[]>([]);
  const [amount,   setAmount]   = useState("1");
  const [step,     setStep]     = useState<"idle" | "approving" | "depositing" | "withdrawing">("idle");
  const [txHash,   setTxHash]   = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

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
      }
    };
    eth.on("accountsChanged", handler);
    return () => eth.removeListener?.("accountsChanged", handler);
  }, []);

  async function loadChainData(addr: `0x${string}`) {
    try {
      const pub = getPubClient();
      const [esc, bal] = await Promise.all([
        pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "escrowOf",  args: [addr] }),
        pub.readContract({ address: USDC,   abi: ERC20_ABI,  functionName: "balanceOf", args: [addr] }),
      ]);
      setEscrow(esc);
      setUsdcBal(bal);
    } catch { /* rpc may not be available */ }
  }

  async function loadActivity(addr: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/follower/${addr}`);
      if (res.ok) {
        const data = await res.json() as { copies: Copy[]; refusals: Refusal[] };
        setCopies(data.copies ?? []);
        setRefusals(data.refusals ?? []);
      }
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }

  async function deposit() {
    if (!address) return;
    setError(null);
    const amtMicro = BigInt(Math.round(parseFloat(amount) * 1e6));
    const acc = address as `0x${string}`;
    try {
      await switchToArc();
      const pub = getPubClient();
      const wc  = getWalletClient();

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

  async function withdraw() {
    if (!address || escrow === 0n) return;
    setError(null);
    const acc = address as `0x${string}`;
    try {
      await switchToArc();
      const wc = getWalletClient();
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

  if (!address) {
    return (
      <div className="border border-ink/10 p-6 bg-ink/[0.02] text-center">
        <p className="text-sm font-medium mb-1">Connect your wallet to start copying</p>
        <p className="text-xs text-ink/50 mb-4">Deposit USDC escrow, pick an agent, and every intent they emit gets copied to your account after three policy checks pass.</p>
        <p className="text-xs text-ink/30">Use the <span className="text-terracotta">Connect wallet</span> button in the top-right nav.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
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
          <p className="text-xs text-ink/30 mt-1">Arc Testnet balance</p>
        </div>
      </div>

      {/* Deposit / withdraw */}
      <div className="card">
        <p className="text-sm font-medium mb-4">Manage escrow</p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-ink/40 block mb-1.5">Amount (USDC)</label>
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
        {txHash && (
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
