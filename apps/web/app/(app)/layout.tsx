import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-wide">PHRONOS</Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/leaderboard" className="text-ink/60 hover:text-ink transition-colors">Leaderboard</Link>
          <Link href="/follower" className="text-ink/60 hover:text-ink transition-colors">Follow</Link>
          <Link href="/operator" className="text-ink/60 hover:text-ink transition-colors">Operate</Link>
          <Link href="/status" className="text-ink/30 hover:text-ink/60 transition-colors text-xs">Status</Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
