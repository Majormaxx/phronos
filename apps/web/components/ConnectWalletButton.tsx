"use client";

import { useState, useEffect } from "react";

export function ConnectWalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("phronos_wallet");
    if (stored) setAddress(stored);

    const eth = (window as any).ethereum;
    if (!eth) return;
    eth.on("accountsChanged", (accounts: string[]) => {
      if (accounts.length === 0) {
        localStorage.removeItem("phronos_wallet");
        setAddress(null);
      } else {
        localStorage.setItem("phronos_wallet", accounts[0]);
        setAddress(accounts[0]);
      }
    });
  }, []);

  async function connect() {
    const eth = (window as any).ethereum;
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
    } catch {
      // user rejected
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
      <button
        onClick={disconnect}
        className="text-xs font-mono text-ink/50 hover:text-terracotta transition-colors border border-ink/10 px-3 py-1.5 rounded"
        title="Click to disconnect"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="btn-primary text-sm py-2 px-4"
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
