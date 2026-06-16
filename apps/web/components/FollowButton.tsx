"use client";

import { useState, useEffect } from "react";
import { createWalletClient, custom, parseAbi } from "viem";
import { arcTestnet } from "@phronos/shared";

const ROUTER = (process.env.NEXT_PUBLIC_PHRONOS_ROUTER_ADDR ?? "0x7988558ed4B654cFc3D89C352b41053ac1d14e3F") as `0x${string}`;

const ROUTER_ABI = parseAbi([
  "function activateCopy(uint256 erc8004Id) external",
]);

interface Props {
  erc8004Id: number;
  agentName: string;
}

export function FollowButton({ erc8004Id, agentName }: Props) {
  const [address,      setAddress]      = useState<string | null>(null);
  const [following,    setFollowing]    = useState(false);
  const [justFollowed, setJustFollowed] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("phronos_wallet");
    if (!stored) return;
    setAddress(stored);

    fetch(`/api/policies?follower=${stored}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: { erc8004Id: number }[]) => {
        if (rows.some(r => Number(r.erc8004Id) === erc8004Id)) setFollowing(true);
      })
      .catch(() => {});
  }, [erc8004Id]);

  async function handleFollow() {
    if (!address) {
      alert("Connect your wallet first — use the button in the top-right nav.");
      return;
    }
    const eth = (window as any).ethereum;
    if (!eth) {
      alert("No wallet detected.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Step 1: set copyActive on-chain
      const wc = createWalletClient({ transport: custom(eth), chain: arcTestnet });
      try {
        await wc.switchChain({ id: arcTestnet.id });
      } catch (err: any) {
        if (err.code === 4902) await wc.addChain({ chain: arcTestnet });
      }
      await wc.writeContract({
        address:      ROUTER,
        abi:          ROUTER_ABI,
        functionName: "activateCopy",
        args:         [BigInt(erc8004Id)],
        account:      address as `0x${string}`,
        chain:        arcTestnet,
      });

      // Step 2: register in DB so router worker picks it up in demo mode
      const res = await fetch("/api/policies", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ followerAddr: address, erc8004Id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Policy registration failed");
      setFollowing(true);
      setJustFollowed(true);
      setTimeout(() => setJustFollowed(false), 800);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (following) {
    return (
      <div className={`flex flex-col sm:flex-row sm:items-center gap-2 ${justFollowed ? "follow-flash" : ""}`}>
        <span className="inline-flex items-center gap-2 text-sm font-mono text-olive">
          <span className="w-2 h-2 rounded-full bg-olive inline-block animate-pulse" />
          Copying {agentName}
        </span>
        <span className="text-xs text-ink/30">
          — every signed intent gets copied to your escrow
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleFollow}
        disabled={loading}
        className="btn-primary py-2.5 px-6 text-sm self-start disabled:opacity-50"
      >
        {loading ? "Activating…" : `Copy ${agentName}`}
      </button>
      {!address && (
        <p className="text-xs text-ink/30">Get in first — connect your wallet top-right.</p>
      )}
      {error && <p className="text-xs text-terracotta">{error}</p>}
    </div>
  );
}
