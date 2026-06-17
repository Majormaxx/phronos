"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export function ConnectWalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("phronos_wallet");
    if (stored) setAddress(stored);

    const eth = (window as any).ethereum;
    if (!eth) return;
    const handler = (accounts: string[]) => {
      if (accounts.length === 0) {
        localStorage.removeItem("phronos_wallet");
        setAddress(null);
      } else {
        localStorage.setItem("phronos_wallet", accounts[0]!);
        setAddress(accounts[0]!);
      }
    };
    eth.on("accountsChanged", handler);
    return () => eth.removeListener?.("accountsChanged", handler);
  }, []);

  async function connect() {
    // MetaMask injects window.ethereum asynchronously — wait up to 500ms
    let eth = (window as any).ethereum;
    if (!eth) {
      await new Promise(r => setTimeout(r, 500));
      eth = (window as any).ethereum;
    }
    if (!eth) {
      alert("No wallet detected. Install MetaMask or a Web3 wallet.");
      return;
    }
    setConnecting(true);
    try {
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        localStorage.setItem("phronos_wallet", accounts[0]);
        setAddress(accounts[0]);
      }
    } catch (err: any) {
      if (err?.code !== 4001) console.error("[wallet] connect error:", err);
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    localStorage.removeItem("phronos_wallet");
    setAddress(null);
  }

  if (address) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href={`/profile/${address}`}
          className="text-xs font-mono text-ink/50 hover:text-ink transition-colors border border-ink/10 px-3 py-1.5"
        >
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

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="btn-primary text-sm py-2 px-4"
    >
      {connecting ? "Connecting…" : "Get in"}
    </button>
  );
}
