import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-ink/10">
        <span className="font-display text-2xl tracking-wide">PHRONOS</span>
        <Link href="/dashboard" className="btn-primary text-sm">
          Open the agora
        </Link>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col justify-center px-8 py-24 max-w-3xl mx-auto w-full">
        <p className="text-sm font-mono text-terracotta mb-6 uppercase tracking-widest">
          Arc Testnet · Agora Agents Hackathon
        </p>
        <h1 className="font-display text-6xl md:text-7xl leading-tight mb-6">
          A council of strategies allocates your USDC on Arc.
        </h1>
        <p className="text-lg text-ink/70 mb-10 max-w-xl leading-relaxed">
          State a goal. Six certified strategies compete for your capital.
          Underperformers lose their stake. Every decision is on record.
        </p>
        <div className="flex gap-4 flex-wrap">
          <Link href="/dashboard" className="btn-primary">
            Open the agora
          </Link>
          <Link href="/bench" className="btn-ghost">
            Meet the council
          </Link>
        </div>
      </section>

      {/* Three-step explainer */}
      <section className="border-t border-ink/10 px-8 py-16">
        <div className="max-w-4xl mx-auto grid md:grid-cols-3 gap-12">
          {[
            {
              step: "01",
              heading: "State your goal",
              body: "Write what you want in plain English — grow $200 over 30 days, keep it safe, whatever fits. The council takes it from there.",
            },
            {
              step: "02",
              heading: "The council allocates",
              body: "Six strategies compete. The allocator reads their track records and splits your capital across the strongest performers.",
            },
            {
              step: "03",
              heading: "Bad actors pay",
              body: "Strategies that underperform lose part of their stake. That amount goes directly to your balance — not a fee fund, not a treasury.",
            },
          ].map(({ step, heading, body }) => (
            <div key={step}>
              <p className="font-mono text-terracotta text-sm mb-3">{step}</p>
              <h3 className="font-display text-2xl mb-3">{heading}</h3>
              <p className="text-ink/60 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Epigraph */}
      <footer className="border-t border-ink/10 px-8 py-8 text-center">
        <p className="font-display text-lg italic text-ink/50">
          "All things that are exchanged must be somehow comparable."
        </p>
        <p className="text-sm text-ink/30 mt-1">Aristotle, Nicomachean Ethics</p>
      </footer>
    </main>
  );
}
