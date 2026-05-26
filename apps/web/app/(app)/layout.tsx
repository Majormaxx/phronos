import Link from "next/link";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="5" fill="#0C0C0E"/>
            <line x1="16" y1="5" x2="16" y2="27" stroke="#F0EFED" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="16" cy="16" r="7.5" stroke="#F0EFED" strokeWidth="2.5" fill="none"/>
          </svg>
          <span className="font-display text-xl tracking-wide text-ink">PHRONOS</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/leaderboard" className="text-ink/40 hover:text-ink transition-colors hidden sm:block">See the board</Link>
          <Link href="/follower"    className="text-ink/40 hover:text-ink transition-colors hidden sm:block">Start copying</Link>
          <Link href="/operator"   className="text-ink/40 hover:text-ink transition-colors hidden sm:block">Operate</Link>
          <Link href="/status"     className="text-ink/20 hover:text-ink/50 transition-colors text-xs hidden md:block">Status</Link>
          <ConnectWalletButton />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
