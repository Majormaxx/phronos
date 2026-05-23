import { db, followers, copies, refusals } from "@phronos/db";
import { eq, desc } from "drizzle-orm";
import { arcscanAddress, arcscanTx, getDeployedAddresses } from "@phronos/shared";
import Link from "next/link";

const DEMO_FOLLOWER = "0x1BD759e9a1D70ce5F4f14e4D0501ffFdf534350E";

export default async function FollowerPage() {
  const { router: routerAddr, bond: bondAddr } = getDeployedAddresses();

  const [followerRows, recentCopies, recentRefusals] = await Promise.all([
    db().select().from(followers).where(eq(followers.address, DEMO_FOLLOWER)).limit(1),
    db().select().from(copies).where(eq(copies.followerAddr, DEMO_FOLLOWER)).orderBy(desc(copies.executedAt)).limit(20),
    db().select().from(refusals).where(eq(refusals.followerAddr, DEMO_FOLLOWER)).orderBy(desc(refusals.refusedAt)).limit(10),
  ]);

  const follower = followerRows[0];

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-display text-5xl mb-1">Follower</h1>
      <p className="text-ink/40 text-sm mb-8">Demo account · {DEMO_FOLLOWER.slice(0, 12)}…</p>

      {/* Escrow */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Escrow balance</p>
          <p className="font-mono text-lg">${(Number(follower?.escrowUsdc ?? "0") / 1e6).toFixed(2)} USDC</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Copy trades executed</p>
          <p className="font-mono text-lg">{recentCopies.length}</p>
        </div>
      </div>

      {/* Contracts */}
      <div className="mb-8 space-y-1 text-xs text-ink/40 font-mono">
        {routerAddr && <p>Router: <a href={arcscanAddress(routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{routerAddr.slice(0, 12)}…↗</a></p>}
        {bondAddr   && <p>Bond:   <a href={arcscanAddress(bondAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{bondAddr.slice(0, 12)}…↗</a></p>}
      </div>

      {/* Copy trades */}
      <h2 className="font-display text-2xl mb-4">Copy trades</h2>
      <div className="space-y-2 mb-10">
        {recentCopies.length === 0 && <p className="text-ink/30 text-sm">No copies yet — router processes intents as they arrive.</p>}
        {recentCopies.map((c) => (
          <div key={`${c.intentHash}-${c.followerAddr}`} className="flex items-start justify-between py-3 border-b border-ink/5 text-sm">
            <div>
              <span className={`text-xs font-mono px-2 py-0.5 mr-3 ${Number(c.followerNotional) >= 0 ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                {Number(c.followerNotional) >= 0 ? "LONG" : "SHORT"}
              </span>
              <span className="font-mono text-xs text-ink/40">{c.intentHash.slice(0, 16)}…</span>
            </div>
            <div className="text-right">
              <p className="font-mono">${(Math.abs(Number(c.followerNotional)) / 1e6).toFixed(4)}</p>
              <p className="text-xs text-ink/30">{new Date(c.executedAt).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Refusals */}
      {recentRefusals.length > 0 && (
        <>
          <h2 className="font-display text-2xl mb-4">Policy refusals</h2>
          <div className="space-y-2">
            {recentRefusals.map((r) => (
              <div key={`${r.intentHash}-${r.followerAddr}`} className="py-3 border-b border-ink/5 text-sm">
                <p className="text-terracotta font-mono text-xs">
                  reason={r.reason} hash={r.intentHash.slice(0, 16)}…
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-8">
        <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70">← Leaderboard</Link>
      </div>
    </div>
  );
}
