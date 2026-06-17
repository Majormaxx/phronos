"use client";

import { useState, useEffect } from "react";
import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet, getDeployedAddresses } from "@phronos/shared";
import { useWallet } from "@/lib/wallet-context";

const ROUTER_ABI = parseAbi([
  "function activateCopy(uint256 erc8004Id) external",
]);

interface Props {
  erc8004Id: number;
  agentName: string;
}

export function FollowButton({ erc8004Id, agentName }: Props) {
  const { address, walletType, getWalletClient, getSCAClient } = useWallet();
  const [following,    setFollowing]    = useState(false);
  const [justFollowed, setJustFollowed] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/policies?follower=${address}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: { erc8004Id: number }[]) => {
        if (rows.some(r => Number(r.erc8004Id) === erc8004Id)) setFollowing(true);
      })
      .catch(() => {});
  }, [address, erc8004Id]);

  async function handleFollow() {
    if (!address) {
      alert("Connect your wallet first — use the button in the top-right nav.");
      return;
    }
    const { router: ROUTER } = getDeployedAddresses();
    if (!ROUTER) { setError("Router address not configured"); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      if (walletType === "circle-sca") {
        const sca = await getSCAClient();
        if (!sca) throw new Error("SCA client unavailable");
        const { encodeFunctionData } = await import("viem");
        await (sca as any).sendUserOperation({
          calls: [{
            to:   ROUTER as `0x${string}`,
            data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "activateCopy", args: [BigInt(erc8004Id)] }),
          }],
          paymaster: true,
        });
      } else {
        // Injected wallet — standard writeContract
        const wc         = await getWalletClient();
        const pubClient  = createPublicClient({ chain: arcTestnet, transport: http() });
        const { request } = await pubClient.simulateContract({
          address:      ROUTER as `0x${string}`,
          abi:          ROUTER_ABI,
          functionName: "activateCopy",
          args:         [BigInt(erc8004Id)],
          account:      address as `0x${string}`,
        });
        await wc.writeContract(request);
      }

      // Register in DB so router worker picks it up
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
      setError(e.shortMessage ?? e.message ?? "Something went wrong");
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
        <span className="text-xs text-ink/30">— every signed intent gets copied to your escrow</span>
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
