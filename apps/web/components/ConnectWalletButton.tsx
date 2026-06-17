"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet, HAS_CIRCLE } from "@/lib/wallet-context";

export function ConnectWalletButton() {
  const { address, walletType, connectCircle, connectInjected, disconnect } = useWallet();
  const [connecting, setConnecting] = useState<"circle" | "injected" | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  async function handleCircle() {
    setConnecting("circle");
    setError(null);
    try { await connectCircle(); }
    catch (e: any) { setError(e.message?.slice(0, 80) ?? "Passkey failed"); }
    finally { setConnecting(null); }
  }

  async function handleInjected() {
    setConnecting("injected");
    setError(null);
    try { await connectInjected(); }
    catch (e: any) { setError(e.message?.slice(0, 80) ?? "Wallet connection failed"); }
    finally { setConnecting(null); }
  }

  if (address) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href={`/profile/${address}`}
          className="flex items-center gap-1.5 text-xs font-mono text-ink/50 hover:text-ink border border-ink/10 px-3 py-1.5 transition-colors"
        >
          {walletType === "circle-sca" && (
            <span className="w-1.5 h-1.5 rounded-full bg-olive" title="Circle passkey wallet" />
          )}
          {address.slice(0, 6)}…{address.slice(-4)}
        </Link>
        <button
          onClick={disconnect}
          className="text-ink/20 hover:text-terracotta transition-colors text-xs px-1.5 py-1.5 border border-ink/8"
          title="Disconnect"
        >
          ×
        </button>
      </div>
    );
  }

  if (HAS_CIRCLE) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <button
            onClick={handleCircle}
            disabled={!!connecting}
            className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
          >
            {connecting === "circle" ? "Creating passkey…" : "Passkey"}
          </button>
          <button
            onClick={handleInjected}
            disabled={!!connecting}
            className="text-xs font-mono text-ink/40 hover:text-ink border border-ink/10 px-3 py-2 transition-colors disabled:opacity-40"
          >
            {connecting === "injected" ? "Connecting…" : "Wallet"}
          </button>
        </div>
        {error && <p className="text-[10px] text-terracotta font-mono max-w-[200px] text-right">{error}</p>}
      </div>
    );
  }

  // No Circle env vars — existing single-button MetaMask flow
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleInjected}
        disabled={!!connecting}
        className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Get in"}
      </button>
      {error && <p className="text-[10px] text-terracotta font-mono">{error}</p>}
    </div>
  );
}
