"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const ROUTER  = "0x7988558ed4B654cFc3D89C352b41053ac1d14e3F";
const USDC    = "0x3600000000000000000000000000000000000000";
const CHAIN_ID = 5042002;

const ERC20_ABI = [
  { name: "approve",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance",  type: "function", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf",  type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const ROUTER_ABI = [
  { name: "depositFollower",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "withdrawFollower", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "escrowOf",         type: "function", stateMutability: "view",       inputs: [{ name: "follower", type: "address" }], outputs: [{ type: "uint256" }] },
];

function encodeCall(signature: string, ...args: (string | bigint)[]): string {
  const sel = signature.slice(0, signature.indexOf("("));
  // Compute selector: keccak256(signature)[0:4] — use a lookup table for our two functions
  const selectors: Record<string, string> = {
    approve:         "095ea7b3",
    allowance:       "dd62ed3e",
    balanceOf:       "70a08231",
    depositFollower: "c43e9e30",
    withdrawFollower:"4f7e9b73",
    escrowOf:        "e5d4abb5",
  };
  const selectorHex = selectors[sel];
  if (!selectorHex) throw new Error(`Unknown function: ${sel}`);
  const encodedArgs = args.map(a => BigInt(a).toString(16).padStart(64, "0")).join("");
  return "0x" + selectorHex + encodedArgs;
}

async function ethCall(to: string, data: string): Promise<string> {
  const eth = (window as any).ethereum;
  const res = await eth.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  return res as string;
}

async function ethSend(from: string, to: string, data: string): Promise<string> {
  const eth = (window as any).ethereum;
  return await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data }] });
}

async function switchToArc(): Promise<void> {
  const eth = (window as any).ethereum;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x4CFF52" }] }); // 5042002 hex
  } catch (err: any) {
    if (err.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x4CFF52",
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
          rpcUrls: ["https://rpc.testnet.arc.network"],
          blockExplorerUrls: ["https://testnet.arcscan.app"],
        }],
      });
    }
  }
}

export function FollowerWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [escrow, setEscrow]   = useState<bigint>(0n);
  const [usdcBal, setUsdcBal] = useState<bigint>(0n);
  const [copies, setCopies]   = useState<any[]>([]);
  const [amount, setAmount]   = useState("1");
  const [step, setStep]       = useState<"idle" | "approving" | "depositing" | "withdrawing">("idle");
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("phronos_wallet");
    if (stored) { setAddress(stored); loadChainData(stored); loadCopies(stored); }

    const eth = (window as any).ethereum;
    if (!eth) return;
    eth.on("accountsChanged", (accs: string[]) => {
      const acc = accs[0] ?? null;
      localStorage.setItem("phronos_wallet", acc ?? "");
      setAddress(acc);
      if (acc) { loadChainData(acc); loadCopies(acc); }
    });
  }, []);

  async function loadChainData(addr: string) {
    try {
      const [escrowHex, balHex] = await Promise.all([
        ethCall(ROUTER, encodeCall("escrowOf(address)", addr)),
        ethCall(USDC,   encodeCall("balanceOf(address)", addr)),
      ]);
      setEscrow(BigInt(escrowHex));
      setUsdcBal(BigInt(balHex));
    } catch { /* rpc may not be available */ }
  }

  async function loadCopies(addr: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/follower/${addr}`);
      if (res.ok) setCopies(await res.json());
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }

  async function deposit() {
    if (!address) return;
    setError(null);
    const amtMicro = BigInt(Math.round(parseFloat(amount) * 1e6));
    try {
      await switchToArc();

      // Check allowance
      const allowHex = await ethCall(USDC, encodeCall("allowance(address,address)", address, ROUTER));
      const allowance = BigInt(allowHex);

      if (allowance < amtMicro) {
        setStep("approving");
        const approveTx = await ethSend(address, USDC, encodeCall("approve(address,uint256)", ROUTER, amtMicro));
        // Wait briefly for approval to be mined
        await new Promise(r => setTimeout(r, 3000));
      }

      setStep("depositing");
      const depositTx = await ethSend(address, ROUTER, encodeCall("depositFollower(uint256)", amtMicro));
      setTxHash(depositTx);
      setStep("idle");
      // Reload balances
      await loadChainData(address);
      await loadCopies(address);
    } catch (e: any) {
      setError(e.message ?? "Transaction rejected");
      setStep("idle");
    }
  }

  async function withdraw() {
    if (!address || escrow === 0n) return;
    setError(null);
    try {
      await switchToArc();
      setStep("withdrawing");
      const tx = await ethSend(address, ROUTER, encodeCall("withdrawFollower(uint256)", escrow));
      setTxHash(tx);
      setStep("idle");
      await loadChainData(address);
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
    <div className="space-y-6">
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
            <label className="text-xs text-ink/40 block mb-1">Amount (USDC)</label>
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
            className="btn-primary text-sm py-2 px-4"
          >
            {step === "approving" ? "Approving…" : step === "depositing" ? "Depositing…" : "Deposit"}
          </button>
          {escrow > 0n && (
            <button
              onClick={withdraw}
              disabled={step !== "idle"}
              className="btn-ghost text-sm py-2 px-4"
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
        <h2 className="font-display text-2xl mb-4">Your copy trades</h2>
        {loading && <p className="text-ink/30 text-sm">Loading…</p>}
        {!loading && copies.length === 0 && (
          <p className="text-ink/30 text-sm">No copies yet — deposit escrow and the router will copy intents automatically.</p>
        )}
        {copies.map((c: any) => (
          <div key={`${c.intentHash}-${c.followerAddr}`} className="flex items-start justify-between py-3 border-b border-ink/5 text-sm">
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
    </div>
  );
}
