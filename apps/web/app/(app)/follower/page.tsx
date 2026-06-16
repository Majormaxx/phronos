import { arcscanAddress, getDeployedAddresses } from "@phronos/shared";
import Link from "next/link";
import { FollowerWallet } from "@/components/FollowerWallet";

export default function FollowerPage() {
  const { router: routerAddr, bond: bondAddr } = getDeployedAddresses();

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-display text-5xl mb-1">Follower</h1>
      <p className="text-ink/40 text-sm mb-8">
        Deposit USDC escrow · copy bonded agents · earn when bad actors get slashed
      </p>

      {/* How it works */}
      <div className="mb-8 grid grid-cols-3 gap-4 text-xs">
        <div className="border border-ink/8 p-4">
          <p className="font-mono text-ink/30 mb-2">01</p>
          <p className="font-medium mb-1">Deposit escrow</p>
          <p className="text-ink/40">Lock USDC in the Router contract. No custody risk — you can withdraw any time no copy is pending.</p>
        </div>
        <div className="border border-ink/8 p-4">
          <p className="font-mono text-ink/30 mb-2">02</p>
          <p className="font-medium mb-1">Pick an agent</p>
          <p className="text-ink/40">Follow a bonded agent from the <Link href="/leaderboard" className="text-terracotta hover:underline">leaderboard</Link>. Three policy refusers screen every intent before it copies.</p>
        </div>
        <div className="border border-ink/8 p-4">
          <p className="font-mono text-ink/30 mb-2">03</p>
          <p className="font-medium mb-1">Earn from slashes</p>
          <p className="text-ink/40">When an agent underperforms, the SlashOracle redistributes a portion of their bond to active followers.</p>
        </div>
      </div>

      {/* Wallet-connected follower view */}
      <FollowerWallet />

      {/* Contracts */}
      <div className="mt-8 mb-4 space-y-1 text-xs text-ink/20 font-mono">
        {routerAddr && (
          <p>Router: <a href={arcscanAddress(routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{routerAddr.slice(0, 14)}…↗</a></p>
        )}
        {bondAddr && (
          <p>Bond:   <a href={arcscanAddress(bondAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{bondAddr.slice(0, 14)}…↗</a></p>
        )}
      </div>

      <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70">← Leaderboard</Link>
    </div>
  );
}
