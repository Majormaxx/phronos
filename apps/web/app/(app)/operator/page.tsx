import { db, agents, bonds, intents, slashes } from "@phronos/db";
import { eq, desc } from "drizzle-orm";
import { arcscanAddress, getDeployedAddresses } from "@phronos/shared";
import Link from "next/link";

const AGENT_NAMES: Record<number, string> = {
  19297: "Momentum", 19298: "Mean Reversion", 19299: "Funding Rate", 19300: "Random Walk",
};

export default async function OperatorPage() {
  const { registry: registryAddr, router: routerAddr, operator: OPERATOR } = getDeployedAddresses();

  if (!OPERATOR) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="font-display text-5xl mb-4">Operator</h1>
        <p className="text-ink/40 text-sm">OPERATOR_ADDRESS not configured.</p>
      </div>
    );
  }

  const allAgents = await db().select().from(agents).where(eq(agents.operatorAddr, OPERATOR));

  const agentData = await Promise.all(allAgents.map(async (a) => {
    const [bondRows, recentIntents, slashRows] = await Promise.all([
      db().select().from(bonds).where(eq(bonds.erc8004Id, a.erc8004Id)).limit(1),
      db().select().from(intents).where(eq(intents.erc8004Id, a.erc8004Id)).orderBy(desc(intents.submittedAt)).limit(5),
      db().select().from(slashes).where(eq(slashes.erc8004Id, a.erc8004Id)).orderBy(desc(slashes.blockNumber)).limit(5),
    ]);
    return { agent: a, bond: bondRows[0], intents: recentIntents, slashes: slashRows };
  }));

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="font-display text-5xl mb-1">Operator</h1>
      <p className="text-ink/40 text-sm mb-2">
        <a href={arcscanAddress(OPERATOR)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-terracotta">
          {OPERATOR.slice(0, 12)}… ↗
        </a>
      </p>
      <p className="text-ink/30 text-xs mb-8">
        Managing {allAgents.length} agent{allAgents.length !== 1 ? "s" : ""} · bonds in USDC collateralised in USYC
      </p>

      <div className="mb-8 space-y-1 text-xs text-ink/40 font-mono">
        {registryAddr && <p>Registry: <a href={arcscanAddress(registryAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{registryAddr.slice(0, 12)}…↗</a></p>}
        {routerAddr   && <p>Router:   <a href={arcscanAddress(routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{routerAddr.slice(0, 12)}…↗</a></p>}
      </div>

      <div className="space-y-8">
        {agentData.map(({ agent, bond, intents: agentIntents, slashes: agentSlashes }) => (
          <div key={agent.erc8004Id} className="card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <Link href={`/agent/${agent.erc8004Id}`} className="font-display text-xl hover:text-terracotta transition-colors">
                  {AGENT_NAMES[agent.erc8004Id] ?? `Agent #${agent.erc8004Id}`}
                </Link>
                <p className="text-xs font-mono text-ink/30">ERC-8004 #{agent.erc8004Id}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm">${(Number(bond?.usdcEquiv ?? "0") / 1e6).toFixed(2)}</p>
                <p className="text-xs text-ink/40">bond (USDC)</p>
              </div>
            </div>

            {agentSlashes.length > 0 && (
              <div className="mb-3 p-2 bg-terracotta/5 border border-terracotta/20 text-xs font-mono text-terracotta">
                {agentSlashes.length} slash event{agentSlashes.length !== 1 ? "s" : ""} · last: {agentSlashes[0]!.bps} bps
              </div>
            )}

            <div className="space-y-1">
              {agentIntents.length === 0 && <p className="text-ink/30 text-xs">No intents indexed yet.</p>}
              {agentIntents.map((i) => (
                <div key={i.intentHash} className="flex items-center justify-between text-xs text-ink/50 py-1 border-b border-ink/5">
                  <span className={`px-1.5 mr-2 ${Number(i.notionalUsdc) >= 0 ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                    {Number(i.notionalUsdc) >= 0 ? "LONG" : "SHORT"}
                  </span>
                  <span className="font-mono flex-1">{i.marketId.slice(0, 20)}</span>
                  <span className="font-mono">${(Math.abs(Number(i.notionalUsdc)) / 1e6).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70">← Leaderboard</Link>
      </div>
    </div>
  );
}
