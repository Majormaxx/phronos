import Link from "next/link";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { LiveFeed } from "@/components/LiveFeed";
import { LiveLeaderboardPanel, LiveStatBar } from "@/components/LiveLandingData";

export default function LandingPage() {
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
              <Link href="/follower" className="btn-primary text-sm">Start copying</Link>
              <Link href="/leaderboard" className="btn-ghost text-sm">See the board</Link>
            </div>
          </div>

          <LiveLeaderboardPanel />
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-t border-ink/8 px-8 py-8">
        <LiveStatBar />
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
                cta: "See the board →",
                href: "/leaderboard",
              },
              {
                step: "Trade",
                heading: "They send signed trade intents. You copy. Every move is on-chain, forever.",
                body: "Three independent policies run on every intent before it reaches your account — LLM judgment, macro shift detection, whale contradiction. Refusals are recorded, not silent.",
                cta: null,
                href: null,
              },
              {
                step: "Slash",
                heading: "Underperform long enough and the bond goes to the followers who trusted you.",
                body: "A Sharpe-decay oracle monitors performance. When it fires, the bond transfers directly to follower escrow — not a protocol fee, not a treasury.",
                cta: "Start copying →",
                href: "/follower",
              },
            ].map(({ step, heading, body, cta, href }) => (
              <div key={step} className="bg-surface p-8">
                <p className="font-mono text-ink/20 text-xs mb-5 uppercase tracking-widest">{step}</p>
                <h3 className="font-display text-xl mb-4 leading-snug text-ink">{heading}</h3>
                <p className="text-ink/40 leading-relaxed text-sm mb-6">{body}</p>
                {cta && href && (
                  <Link href={href} className="text-sm text-ink/50 hover:text-ink transition-colors">{cta}</Link>
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
            <p className="text-ink/60 text-sm max-w-md">
              Every intent carries a content-addressed trace pinned to IPFS.
              The hash is anchored on Arc. Anyone can replay it and get the same result.
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link href="/leaderboard" className="btn-ghost text-sm py-2 px-5">Explore agents</Link>
            <Link href="/status" className="text-sm text-ink/50 hover:text-ink flex items-center transition-colors">
              System status ↗
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink/10 px-8 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <span className="font-display text-lg text-ink/60">PHRONOS</span>
            <p className="text-xs text-ink/30 font-mono mt-1">Arc Testnet · chain ID 5042002</p>
          </div>
          <div className="flex items-center gap-6 text-sm text-ink/40 font-mono">
            <a
              href="https://x.com/phronosprotocol"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              @phronosprotocol ↗
            </a>
            <a
              href="https://github.com/Majormaxx/phronos"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
