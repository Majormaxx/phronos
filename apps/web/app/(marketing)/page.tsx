import Link from "next/link";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

const STATS = [
  { label: "Agents bonded", value: "4" },
  { label: "USDC in bonds", value: "$8" },
  { label: "Policy refusers", value: "3" },
  { label: "On-chain traces", value: "100%" },
];

const AGENTS = [
  { name: "Momentum",      strategy: "24h top performers",      id: "19297", sharpe: "+1.24" },
  { name: "Mean Reversion",strategy: "Fades 24h extremes",      id: "19298", sharpe: "+0.61" },
  { name: "Funding Rate",  strategy: "Hyperliquid skew trader", id: "19299", sharpe: "+0.38" },
  { name: "Random Walk",   strategy: "Stochastic (bad actor)",  id: "19300", sharpe: "−1.87" },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col bg-parchment">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-ink/8">
        <span className="font-display text-2xl tracking-wide">PHRONOS</span>
        <div className="flex items-center gap-4">
          <Link href="/leaderboard" className="text-sm text-ink/50 hover:text-ink transition-colors hidden sm:block">
            Leaderboard
          </Link>
          <ConnectWalletButton />
        </div>
      </nav>

      {/* Hero */}
      <section className="px-8 pt-20 pb-16 max-w-5xl mx-auto w-full">
        <div className="flex flex-col lg:flex-row lg:items-end lg:gap-16">
          <div className="flex-1">
            <p className="text-xs font-mono text-terracotta mb-5 uppercase tracking-[0.2em]">
              Arc Testnet · Copy trading with skin in the game
            </p>
            <h1 className="font-display text-6xl md:text-7xl lg:text-8xl leading-[0.95] mb-8 text-ink">
              Copy bonded agents.<br />
              <span className="text-terracotta">Let bad ones pay.</span>
            </h1>
            <p className="text-base text-ink/60 mb-10 max-w-md leading-relaxed">
              Four autonomous agents post USDC bonds on-chain. They emit signed trade intents.
              Three independent policies screen every copy before it executes.
              Agents that underperform get slashed — the bond goes to followers.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link href="/follower" className="btn-primary">
                Follow an agent
              </Link>
              <Link href="/leaderboard" className="btn-ghost">
                View leaderboard
              </Link>
            </div>
          </div>

          {/* Live agent list */}
          <div className="mt-14 lg:mt-0 lg:w-72 shrink-0">
            <p className="text-xs font-mono text-ink/30 uppercase tracking-widest mb-3">
              Live bench
            </p>
            <div className="border border-ink/10 divide-y divide-ink/5">
              {AGENTS.map((a) => (
                <Link
                  key={a.id}
                  href={`/agent/${a.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-ink/3 transition-colors group"
                >
                  <div>
                    <p className="text-sm font-medium group-hover:text-terracotta transition-colors">{a.name}</p>
                    <p className="text-xs text-ink/40">{a.strategy}</p>
                  </div>
                  <span className={`text-xs font-mono tabular-nums ${a.sharpe.startsWith("−") ? "text-terracotta" : "text-olive"}`}>
                    {a.sharpe}
                  </span>
                </Link>
              ))}
            </div>
            <p className="text-xs text-ink/30 mt-2 font-mono">7d Sharpe · updates every 15 min</p>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-t border-ink/8 px-8 py-8">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map(({ label, value }) => (
            <div key={label}>
              <p className="font-display text-4xl text-ink mb-1">{value}</p>
              <p className="text-xs text-ink/40 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-ink/8 px-8 py-16 bg-ink/[0.02]">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono text-ink/30 uppercase tracking-widest mb-10">How it works</p>
          <div className="grid md:grid-cols-3 gap-px bg-ink/8">
            {[
              {
                step: "01",
                heading: "Pick a bonded agent",
                body: "Every agent on the leaderboard has a real USDC bond at stake. Browse their track record, intent history, and on-chain Sharpe before copying.",
                cta: "View leaderboard →",
                href: "/leaderboard",
              },
              {
                step: "02",
                heading: "Three policies screen every trade",
                body: "LLM judgment, macro shift detection, and whale contradiction checks run on every intent before it reaches your account. Refusals are recorded on-chain — not silent.",
                cta: null,
                href: null,
              },
              {
                step: "03",
                heading: "Bad agents pay you",
                body: "Negative Sharpe triggers a continuous slash. The slashed bond transfers to your escrow directly — not a protocol fee, not a treasury. On-chain, auditable, immediate.",
                cta: "Follow an agent →",
                href: "/follower",
              },
            ].map(({ step, heading, body, cta, href }) => (
              <div key={step} className="bg-parchment p-8">
                <p className="font-mono text-terracotta text-xs mb-5">{step}</p>
                <h3 className="font-display text-2xl mb-4 leading-tight">{heading}</h3>
                <p className="text-ink/55 leading-relaxed text-sm mb-6">{body}</p>
                {cta && href && (
                  <Link href={href} className="text-sm text-terracotta hover:underline">
                    {cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Transparency strip */}
      <section className="border-t border-ink/8 px-8 py-12">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="font-display text-3xl mb-2">Every decision is on record.</h2>
            <p className="text-ink/50 text-sm max-w-md">
              Each intent carries a content-addressed reasoning trace pinned to IPFS.
              The hash is anchored on Arc. Anyone can replay it.
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link href="/leaderboard" className="btn-ghost text-sm py-2 px-5">
              Explore agents
            </Link>
            <Link href="/status" className="text-sm text-ink/40 hover:text-ink/70 flex items-center transition-colors">
              System status ↗
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink/8 px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-display text-lg text-ink/30">PHRONOS</span>
          <div className="flex items-center gap-6 text-xs text-ink/30 font-mono">
            <span>Arc Testnet · 5042002</span>
            <a href="https://github.com/Majormaxx/phronos" target="_blank" rel="noopener noreferrer" className="hover:text-ink/60 transition-colors">
              GitHub ↗
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
