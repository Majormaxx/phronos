import Link from "next/link";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { LiveFeed } from "@/components/LiveFeed";

const AGENT_META: Record<number, { name: string; strategy: string; desc: string }> = {
  22892: { name: "Momentum",       strategy: "24h top movers",       desc: "Buys the top 3 performers every 24 hours." },
  22893: { name: "Mean Reversion", strategy: "Fade the rip",         desc: "Shorts the 24h extremes, fades momentum." },
  22897: { name: "Funding Rate",   strategy: "Rate arb",             desc: "Trades Hyperliquid funding skew." },
  22900: { name: "Random Walk",    strategy: "Stochastic",           desc: "Baseline — unstructured random entries." },
};

async function getLiveData() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const [lbRes, statsRes] = await Promise.all([
      fetch(`${base}/api/leaderboard`, { next: { revalidate: 60 } }),
      fetch(`${base}/api/stats`,       { next: { revalidate: 60 } }),
    ]);
    const leaderboard = lbRes.ok ? await lbRes.json() : [];
    const stats       = statsRes.ok ? await statsRes.json() : {};
    return { leaderboard, stats };
  } catch {
    return { leaderboard: [], stats: {} };
  }
}

export default async function LandingPage() {
  const { leaderboard, stats } = await getLiveData();

  const totalBondUsdc = leaderboard.reduce(
    (sum: number, a: { bondUsdc: string }) => sum + Number(a.bondUsdc) / 1e6, 0
  );

  const STATS = [
    { label: "Agents bonded", value: String(stats.agents ?? (leaderboard.length || 4)) },
    { label: "USDC at stake", value: `$${totalBondUsdc > 0 ? totalBondUsdc.toFixed(2) : "8.00"}` },
    { label: "Copy trades",   value: String(stats.copies  ?? 0) },
    { label: "Slash events",  value: String(stats.slashes ?? 0) },
  ];

  return (
    <main className="min-h-screen flex flex-col" style={{ backgroundColor: "#0C0C0E" }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-ink/8">
        <span className="font-display text-2xl tracking-wide text-ink">PHRONOS</span>
        <div className="flex items-center gap-5">
          <Link href="/leaderboard" className="text-sm text-ink/40 hover:text-ink transition-colors hidden sm:block">
            See the board
          </Link>
          <ConnectWalletButton />
        </div>
      </nav>

      {/* Hero */}
      <section className="px-8 pt-20 pb-16 max-w-5xl mx-auto w-full">
        <div className="flex flex-col lg:flex-row lg:items-start lg:gap-20">
          <div className="flex-1">
            <p className="text-xs font-mono text-ink/30 mb-6 uppercase tracking-[0.2em]">
              Arc Testnet · Chain ID 5042002
            </p>
            <h1 className="font-display text-6xl md:text-7xl lg:text-8xl leading-[0.95] mb-6 text-ink">
              Skin in the game.<br />
              <span className="text-ink/40">On chain.</span>
            </h1>
            <p className="text-base text-ink/50 mb-4 max-w-md leading-relaxed">
              Every trader on Phronos has posted a bond before their first signal.
              If they miss targets, they lose it — automatically, on-chain,
              with the proceeds going straight to followers.
            </p>
            <p className="text-sm text-ink/30 mb-10 max-w-md leading-relaxed">
              Most copy trading works like this: a trader posts signals, you follow,
              they&apos;re wrong, they disappear. You&apos;re out money.
              They&apos;ve already got a new account. Phronos doesn&apos;t work like that.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link href="/follower" className="btn-primary text-sm">
                Start copying
              </Link>
              <Link href="/leaderboard" className="btn-ghost text-sm">
                See the board
              </Link>
            </div>
          </div>

          {/* Live leaderboard panel */}
          <div className="mt-14 lg:mt-0 lg:w-80 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono text-ink/30 uppercase tracking-widest">Live · 4 agents</p>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse" />
                <span className="text-xs text-ink/25 font-mono">on-chain</span>
              </span>
            </div>
            <div className="border border-ink/10 divide-y divide-ink/8 bg-surface">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[10px] font-mono text-ink/25 uppercase tracking-wider">
                <span>Agent</span>
                <span className="text-right">Bond</span>
                <span className="text-right w-14">7d Sharpe</span>
              </div>
              {leaderboard.length > 0
                ? leaderboard.map((a: { erc8004Id: number; sharpe7d: number; bondUsdc: string; slashCount: number }) => {
                    const meta = AGENT_META[a.erc8004Id] ?? { name: `Agent #${a.erc8004Id}`, strategy: "", desc: "" };
                    const sharpeStr = a.sharpe7d >= 0 ? `+${a.sharpe7d.toFixed(2)}` : a.sharpe7d.toFixed(2);
                    const atRisk = a.sharpe7d < 0;
                    const bond = (Number(a.bondUsdc) / 1e6).toFixed(2);
                    return (
                      <Link
                        key={a.erc8004Id}
                        href={`/agent/${a.erc8004Id}`}
                        className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 hover:bg-ink/5 transition-colors group"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink group-hover:text-olive transition-colors">{meta.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-ink/30">{meta.strategy}</p>
                            {atRisk && (
                              <span className="text-[9px] font-mono uppercase tracking-wider text-terracotta bg-terracotta/10 px-1 py-0.5 rounded">
                                at risk
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-mono text-ink/50 text-right">${bond}</span>
                        <span className={`text-xs font-mono tabular-nums text-right w-14 ${a.sharpe7d < 0 ? "text-terracotta" : "text-olive"}`}>
                          {sharpeStr}
                        </span>
                      </Link>
                    );
                  })
                : Object.entries(AGENT_META).map(([id, meta]) => (
                    <div key={id} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 opacity-40">
                      <div>
                        <p className="text-sm font-medium text-ink">{meta.name}</p>
                        <p className="text-xs text-ink/30">{meta.strategy}</p>
                      </div>
                      <span className="text-xs font-mono text-ink/50 text-right">$2.00</span>
                      <span className="text-xs font-mono text-ink/30 text-right w-14">—</span>
                    </div>
                  ))}
            </div>
            <p className="text-xs text-ink/20 mt-2 font-mono">7d Sharpe · updates every 15 min</p>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-t border-ink/8 px-8 py-8">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map(({ label, value }) => (
            <div key={label}>
              <p className="font-display text-4xl text-ink mb-1 tabular-nums">{value}</p>
              <p className="text-xs text-ink/30 uppercase tracking-wide font-mono">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live activity */}
      <section className="border-t border-ink/8 px-8 py-10">
        <div className="max-w-5xl mx-auto">
          <LiveFeed />
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-ink/8 px-8 py-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono text-ink/25 uppercase tracking-widest mb-10">How it works</p>
          <div className="grid md:grid-cols-3 gap-px bg-ink/8">
            {[
              {
                step: "Bond",
                heading: "Every trader posts collateral before their first signal.",
                body: "No bond, no platform. The collateral is locked on-chain against an ERC-8004 identity. It can't be withdrawn until a cooldown period clears.",
                cta:  "See the board →",
                href: "/leaderboard",
              },
              {
                step: "Trade",
                heading: "They send signed trade intents. You copy. Every move is on-chain, forever.",
                body: "Three independent policies run on every intent before it reaches your account — LLM judgment, macro shift detection, whale contradiction. Refusals are recorded, not silent.",
                cta:  null,
                href: null,
              },
              {
                step: "Slash",
                heading: "Underperform long enough and the bond goes to the followers who trusted you.",
                body: "A Sharpe-decay oracle monitors performance. When it fires, the bond transfers directly to follower escrow — not a protocol fee, not a treasury.",
                cta:  "Start copying →",
                href: "/follower",
              },
            ].map(({ step, heading, body, cta, href }) => (
              <div key={step} className="bg-surface p-8">
                <p className="font-mono text-ink/20 text-xs mb-5 uppercase tracking-widest">{step}</p>
                <h3 className="font-display text-xl mb-4 leading-snug text-ink">{heading}</h3>
                <p className="text-ink/40 leading-relaxed text-sm mb-6">{body}</p>
                {cta && href && (
                  <Link href={href} className="text-sm text-ink/50 hover:text-ink transition-colors">
                    {cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Receipts strip */}
      <section className="border-t border-ink/8 px-8 py-12">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="font-display text-3xl mb-2 text-ink">Copy trading with receipts.</h2>
            <p className="text-ink/40 text-sm max-w-md">
              Every intent carries a content-addressed trace pinned to IPFS.
              The hash is anchored on Arc. Anyone can replay it and get the same result.
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link href="/leaderboard" className="btn-ghost text-sm py-2 px-5">
              Explore agents
            </Link>
            <Link href="/status" className="text-sm text-ink/30 hover:text-ink/60 flex items-center transition-colors">
              System status ↗
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink/8 px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-display text-lg text-ink/20">PHRONOS</span>
          <div className="flex items-center gap-6 text-xs text-ink/20 font-mono">
            <span>Arc Testnet · 5042002</span>
            <a
              href="https://github.com/Majormaxx/phronos"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink/50 transition-colors"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
