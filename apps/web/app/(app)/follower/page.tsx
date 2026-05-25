import { arcscanAddress, getDeployedAddresses } from "@phronos/shared";
import Link from "next/link";
import { FollowerWallet } from "@/components/FollowerWallet";

export default function FollowerPage() {
  const { router: routerAddr, bond: bondAddr } = getDeployedAddresses();

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-display text-5xl mb-1">Follower</h1>
      <p className="text-ink/40 text-sm mb-8">
        Deposit USDC escrow · copy bonded agents · earn from slashes
      </p>

      {/* Contracts */}
      <div className="mb-6 space-y-1 text-xs text-ink/30 font-mono">
        {routerAddr && (
          <p>Router: <a href={arcscanAddress(routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{routerAddr.slice(0, 14)}…↗</a></p>
        )}
        {bondAddr && (
          <p>Bond:   <a href={arcscanAddress(bondAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{bondAddr.slice(0, 14)}…↗</a></p>
        )}
      </div>

      {/* Wallet-connected follower view */}
      <FollowerWallet />

      <div className="mt-10">
        <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70">← Leaderboard</Link>
      </div>
    </div>
  );
}
