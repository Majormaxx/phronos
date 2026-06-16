import Link from "next/link";
import { db, agents, intents, slashes, bonds } from "@phronos/db";
import { eq, desc } from "drizzle-orm";
import { parseAbi } from "viem";
import { arcscanAddress, arcscanTx, arcscanBlock, getDeployedAddresses, getPublicClient } from "@phronos/shared";
import { FollowButton } from "@/components/FollowButton";
import { ReplaySandbox } from "@/components/ReplaySandbox";
import { agentName, agentStrategy } from "@/lib/agents";

const SLASH_ORACLE_ABI = parseAbi([
  "function sharpeOf(uint256 erc8004Id) external view returns (int256 sharpe, uint64 updatedAt)",
]);

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
  const { registry: registryAddr, bond: bondAddr, router: routerAddr, slashOracle } = getDeployedAddresses();

  let sharpe7d        = 0;
  let sharpeUpdatedAt: number | null = null;
  if (slashOracle) {
    try {
      const client = getPublicClient();
      const [s, u] = await client.readContract({
        address:      slashOracle,
        abi:          SLASH_ORACLE_ABI,
        functionName: "sharpeOf",
        args:         [BigInt(id)],
      }) as [bigint, bigint];
      sharpe7d        = Number(s) / 1e18;
      sharpeUpdatedAt = Number(u);
    } catch { /* oracle not yet populated */ }
  }

  // Hyperliquid live funding rates — only for agent 22897 (Funding Rate strategy)
  let fundingData: { btcFunding: number; ethFunding: number; spread: number; signal: string } | null = null;
  if (id === 22897) {
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal:  AbortSignal.timeout(4000),
        next:    { revalidate: 60 },
      });
      if (res.ok) {
        const [meta, ctxs] = await res.json() as [
          { universe: Array<{ name: string }> },
          Array<{ funding: string }>
        ];
        const btcIdx     = meta.universe.findIndex(u => u.name === "BTC");
        const ethIdx     = meta.universe.findIndex(u => u.name === "ETH");
        const btcFunding = btcIdx >= 0 ? parseFloat(ctxs[btcIdx]?.funding ?? "0") : 0;
        const ethFunding = ethIdx >= 0 ? parseFloat(ctxs[ethIdx]?.funding ?? "0") : 0;
        fundingData      = { btcFunding, ethFunding, spread: ethFunding - btcFunding, signal: ethFunding > btcFunding ? "LONG_ETH" : "LONG_BTC" };
      }
    } catch { /* Hyperliquid unavailable */ }
  }

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-ink/40">Agent not found or not yet indexed.</p>
        <Link href="/leaderboard" className="text-terracotta text-sm mt-4 inline-block">← Leaderboard</Link>
      </div>
    );
  }

  const name     = agentName(id);
  const strategy = agentStrategy(id);
  const bondUsdc = Number(bond?.usdcEquiv ?? "0") / 1e6;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block">
        ← Leaderboard
      </Link>

      {/* Agent header */}
      <div className="mb-2">
        <h1 className="font-display text-5xl mb-1">{name}</h1>
        <p className="text-xs font-mono text-ink/30">
          ERC-8004 #<a href={arcscanAddress(registryAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{id} ↗</a>
        </p>
      </div>
      {strategy && <p className="text-sm text-ink/50 mb-8 mt-3 max-w-lg">{strategy}</p>}

      {/* Bond + operator + sharpe */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">Bond (USDC equiv)</p>
          <p className={`font-mono text-lg ${bondUsdc > 0 ? "" : "text-ink/30"}`}>
            ${bondUsdc.toFixed(2)}
          </p>
          {bond?.unbondedAt && (
            <p className="text-xs text-terracotta mt-1">Unbonding initiated</p>
          )}
        </div>
        <div className="card">
          <p className="text-xs text-ink/40 mb-1">7d Sharpe</p>
          <p className={`font-mono text-lg ${sharpe7d >= 0 ? "text-olive" : "text-terracotta"}`}>
            {sharpe7d !== 0 ? sharpe7d.toFixed(3) : <span className="text-ink/30">—</span>}
          </p>
          <p className="text-xs text-ink/30 mt-1">
            {sharpeUpdatedAt
              ? (() => {
                  const ageMin = Math.floor((Date.now() / 1000 - sharpeUpdatedAt) / 60);
                  const stale  = ageMin > 360;
                  return (
                    <span className={stale ? "text-terracotta/60" : ""}>
                      {stale ? "⚠ stale · " : ""}Updated {ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin/60)}h`} ago
                    </span>
                  );
                })()
              : "from SlashOracle"
            }
          </p>
        </div>
        <div className="card col-span-2">
          <p className="text-xs text-ink/40 mb-1">Operator</p>
          <a
            href={arcscanAddress(agent.operatorAddr)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-terracotta hover:underline break-all"
          >
            {agent.operatorAddr.slice(0, 14)}…↗
          </a>
          <p className="text-xs text-ink/30 mt-1">
            Since {new Date(agent.activeSince).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Hyperliquid live funding rates — Funding Rate agent only */}
      {fundingData && (
        <div className="mb-6 border border-ink/10 p-4 bg-surface">
          <p className="text-[10px] font-mono text-ink/20 uppercase tracking-widest mb-3">
            Hyperliquid perp funding · live signal
          </p>
          <div className="grid grid-cols-3 gap-4 text-xs font-mono mb-3">
            <div>
              <p className="text-ink/30 mb-0.5">ETH funding/hr</p>
              <p className={`text-base ${fundingData.ethFunding > 0 ? "text-olive" : "text-terracotta"}`}>
                {fundingData.ethFunding >= 0 ? "+" : ""}{(fundingData.ethFunding * 100).toFixed(4)}%
              </p>
            </div>
            <div>
              <p className="text-ink/30 mb-0.5">BTC funding/hr</p>
              <p className={`text-base ${fundingData.btcFunding > 0 ? "text-olive" : "text-terracotta"}`}>
                {fundingData.btcFunding >= 0 ? "+" : ""}{(fundingData.btcFunding * 100).toFixed(4)}%
              </p>
            </div>
            <div>
              <p className="text-ink/30 mb-0.5">Spread (ETH−BTC)</p>
              <p className={`text-base font-medium ${fundingData.spread > 0 ? "text-olive" : "text-terracotta"}`}>
                {fundingData.spread >= 0 ? "+" : ""}{(fundingData.spread * 100).toFixed(4)}%
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-ink/8">
            <span className={`text-xs px-2 py-0.5 font-mono ${fundingData.signal === "LONG_ETH" ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
              {fundingData.signal === "LONG_ETH" ? "LONG ETH" : "LONG BTC"}
            </span>
            <span className="text-xs text-ink/30">current signal — spread favours {fundingData.signal === "LONG_ETH" ? "ETH" : "BTC"} long</span>
          </div>
        </div>
      )}

      {/* Slash summary badge */}
      {recentSlashes.length > 0 && (
        <div className="mb-6 px-4 py-3 border border-terracotta/20 bg-terracotta/5 flex items-center gap-3">
          <span className="text-terracotta text-sm font-medium">
            {recentSlashes.length} slash event{recentSlashes.length > 1 ? "s" : ""}
          </span>
          <span className="text-xs text-ink/40">
            — ${recentSlashes.reduce((sum, s) => sum + Number(s.usdcReleased) / 1e6, 0).toFixed(2)} USDC redistributed to followers
          </span>
        </div>
      )}

      {/* Follow CTA */}
      <div className="mb-10 p-5 border border-ink/10 bg-ink/[0.015]">
        <p className="text-sm font-medium mb-1">Copy this agent</p>
        <p className="text-xs text-ink/40 mb-4">
          Every signed intent this agent emits will be screened by three policies and copied to your escrow automatically.
        </p>
        <FollowButton erc8004Id={id} agentName={name} />
      </div>

      {/* Contract addresses */}
      <div className="mb-8 space-y-1 text-xs text-ink/30 font-mono">
        {registryAddr && (
          <p>Registry: <a href={arcscanAddress(registryAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{registryAddr}↗</a></p>
        )}
        {bondAddr && (
          <p>Bond:&nbsp;&nbsp;&nbsp;&nbsp;<a href={arcscanAddress(bondAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{bondAddr}↗</a></p>
        )}
        {routerAddr && (
          <p>Router:&nbsp;&nbsp;<a href={arcscanAddress(routerAddr)} target="_blank" rel="noopener noreferrer" className="hover:text-terracotta">{routerAddr}↗</a></p>
        )}
      </div>

      {/* Slash history */}
      {recentSlashes.length > 0 && (
        <div className="mb-12">
          <h2 className="font-display text-2xl mb-4">Performance penalties</h2>
          <div className="space-y-0">
            {recentSlashes.map((s) => (
              <div key={`${s.erc8004Id}-${s.blockNumber}`} className="py-4 border-b border-ink/5">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-sm font-medium text-terracotta">
                    {(s.bps / 100).toFixed(2)}% of bond slashed
                  </span>
                  <a
                    href={arcscanBlock(s.blockNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-ink/30 hover:text-terracotta"
                  >
                    block {s.blockNumber.toLocaleString()} ↗
                  </a>
                </div>
                <div className="flex items-center gap-4 text-xs text-ink/50">
                  <span>${(Number(s.usdcReleased) / 1e6).toFixed(4)} USDC to followers</span>
                  <span className="font-mono">
                    Sharpe at eval:&nbsp;
                    <span className={Number(s.sharpeAtEval) < 0 ? "text-terracotta" : "text-olive"}>
                      {Number(s.sharpeAtEval).toFixed(3)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intent stream */}
      <h2 className="font-display text-2xl mb-4">Intent stream</h2>
      <div className="space-y-0 mb-12">
        {recentIntents.length === 0 && (
          <p className="text-ink/30 text-sm py-4">No intents submitted yet. Workers emit every 10–30 min.</p>
        )}
        {recentIntents.map((i) => {
          const isLong = Number(i.notionalUsdc) >= 0;
          return (
            <div key={i.intentHash} className="flex items-center justify-between py-3 border-b border-ink/5 group">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-xs font-mono px-2 py-0.5 shrink-0 ${isLong ? "bg-olive/15 text-olive" : "bg-terracotta/15 text-terracotta"}`}>
                  {isLong ? "LONG" : "SHORT"}
                </span>
                <span className="font-mono text-sm">{i.marketId}</span>
                <span className="text-ink/40 text-xs font-mono hidden sm:inline">
                  ${(Math.abs(Number(i.notionalUsdc)) / 1e6).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-4 shrink-0 ml-3">
                <span className="text-xs text-ink/25 font-mono hidden sm:inline">
                  {new Date(i.submittedAt).toLocaleTimeString()}
                </span>
                <Link
                  href={`/traces/${i.intentHash}`}
                  className="text-xs text-ink/30 hover:text-terracotta font-mono transition-colors"
                >
                  {i.intentHash.slice(0, 10)}… ↗
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Replay sandbox */}
      <h2 className="font-display text-2xl mb-4">Replay sandbox</h2>
      <p className="text-sm text-ink/50 mb-4">
        Run the strategy deterministically with a custom seed. The same seed always produces the same intent hash — verifiable on-chain.
      </p>
      <ReplaySandbox agentId={id} />
    </div>
  );
}
