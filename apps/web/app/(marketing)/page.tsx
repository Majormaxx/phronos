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
          <div className="flex items-center gap-5">
            <a
              href="https://x.com/phronosprotocol"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-ink/40 hover:text-ink transition-colors group"
            >
              {/* X (Twitter) logo */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.735l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
              </svg>
              <span className="text-sm font-mono">@phronosprotocol</span>
            </a>
            <a
              href="https://github.com/Majormaxx/phronos"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-ink/40 hover:text-ink transition-colors group"
            >
              {/* GitHub mark */}
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              <span className="text-sm font-mono">GitHub</span>
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
