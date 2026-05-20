import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-wide">PHRONOS</Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/dashboard" className="text-ink/60 hover:text-ink transition-colors">Dashboard</Link>
          <Link href="/bench" className="text-ink/60 hover:text-ink transition-colors">Bench</Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
