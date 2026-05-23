import Link from "next/link";
import { db, agents, intents, slashes, bonds } from "@phronos/db";
import { eq, desc } from "drizzle-orm";
import { arcscanAddress, arcscanTx, getDeployedAddresses } from "@phronos/shared";

const AGENT_NAMES: Record<number, string> = {
  19297: "Momentum", 19298: "Mean Reversion", 19299: "Funding Rate", 19300: "Random Walk",
};

export default async function AgentPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);

  const [agentRows, recentIntents, recentSlashes, bondRows] = await Promise.all([
    db().select().from(agents).where(eq(agents.erc8004Id, id)).limit(1),
    db().select().from(intents).where(eq(intents.erc8004Id, id)).orderBy(desc(intents.submittedAt)).limit(50),
    db().select().from(slashes).where(eq(slashes.erc8004Id, id)).orderBy(desc(slashes.blockNumber)).limit(10),
    db().select().from(bonds).where(eq(bonds.erc8004Id, id)).limit(1),
  ]);

  const agent = agentRows[0];
  const bond  = bondRows[0];
  const { registry: registryAddr, bond: bondAddr, router: routerAddr } = getDeployedAddresses();

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-ink/40">Agent not found or not yet indexed.</p>
        <Link href="/leaderboard" className="text-terracotta text-sm mt-4 inline-block">← Leaderboard</Link>
      </div>
    );
  }

  const name = AGENT_NAMES[id] ?? `Agent #${id}`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block">
        ← Leaderboard
      </Link>

      <h1 className="font-display text-5xl mb-1">{name}</h1>
      <p className="text-xs font-mono text-ink/30 mb-8">ERC-8004 #{id}</p>

      {/* Bond + operator card */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Bond</p>
          <p className="font-mono text-lg">${(Number(bond?.usdcEquiv ?? "0") / 1e6).toFixed(2)} USDC</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Operator</p>
          <a
            href={arcscanAddress(agent.operatorAddr)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-terracotta hover:underline break-all"
          >
            {agent.operatorAddr.slice(0, 12)}…↗
          </a>
        </div>
      </div>

      {/* Contracts */}
      <div className="mb-8 space-y-1 text-xs text-ink/40 font-mono">
        {registryAddr && <p>Registry: <a href={arcscanAddress(registryAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{registryAddr.slice(0, 12)}…↗</a></p>}
        {bondAddr     && <p>Bond:     <a href={arcscanAddress(bondAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{bondAddr.slice(0, 12)}…↗</a></p>}
        {routerAddr   && <p>Router:   <a href={arcscanAddress(routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{routerAddr.slice(0, 12)}…↗</a></p>}
      </div>

      {/* Intent stream */}
      <h2 className="font-display text-2xl mb-4">Intent stream</h2>
      <div className="space-y-2 mb-12">
        {recentIntents.length === 0 && <p className="text-ink/30 text-sm">No intents submitted yet.</p>}
        {recentIntents.map((i) => (
          <div key={i.intentHash} className="flex items-start justify-between py-3 border-b border-ink/5">
            <div>
              <span className={`text-xs font-mono px-2 py-0.5 mr-3 ${Number(i.notionalUsdc) >= 0 ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                {Number(i.notionalUsdc) >= 0 ? "LONG" : "SHORT"}
              </span>
              <span className="font-mono text-sm">{i.marketId}</span>
              <span className="text-ink/40 text-xs ml-3 font-mono">{(Number(i.notionalUsdc) / 1e6).toFixed(2)} USDC</span>
            </div>
            <div className="text-right ml-4">
              <Link href={`/traces/${i.intentHash}`} className="text-xs text-terracotta/70 hover:text-terracotta font-mono">
                trace ↗
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Slash history */}
      {recentSlashes.length > 0 && (
        <>
          <h2 className="font-display text-2xl mb-4">Performance penalties</h2>
          <div className="space-y-2">
            {recentSlashes.map((s) => (
              <div key={`${s.erc8004Id}-${s.blockNumber}`} className="flex items-center justify-between py-3 border-b border-ink/5">
                <div>
                  <span className="text-sm text-terracotta">{s.bps / 100}% of bond redistributed</span>
                  <span className="text-xs text-ink/40 ml-2">— ${(Number(s.usdcReleased) / 1e6).toFixed(2)} USDC to followers</span>
                </div>
                <span className="text-xs font-mono text-ink/30">block {s.blockNumber}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
