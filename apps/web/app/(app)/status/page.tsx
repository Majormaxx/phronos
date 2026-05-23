import { arcscanAddress } from "@phronos/shared";

const CONTRACT_ADDRESSES = {
  PhronosRegistry: process.env.PHRONOS_REGISTRY_ADDR ?? "",
  PhronosBond:     process.env.PHRONOS_BOND_ADDR ?? "",
  PhronosRouter:   process.env.PHRONOS_ROUTER_ADDR ?? "",
  SlashOracle:     process.env.SLASH_ORACLE_ADDR ?? "",
};

async function getStats() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${base}/api/stats`, { cache: "no-store" });
    return res.ok ? res.json() : {};
  } catch { return {}; }
}

export default async function StatusPage() {
  const stats = await getStats() as Record<string, number | string | null>;

  const lagMs = stats.indexerUpdatedAt
    ? Date.now() - new Date(stats.indexerUpdatedAt as string).getTime()
    : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="font-display text-4xl mb-2">System status</h1>
      <p className="text-ink/40 text-sm mb-8">Arc Testnet (chain ID 5042002) · auto-refreshes every 30s</p>

      <div className="space-y-6">
        {/* Indexer */}
        <div className="card">
          <h2 className="font-medium mb-3">Indexer</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-ink/40 text-xs mb-1">Last block</p>
              <p className="font-mono">{stats.indexerBlock ?? "—"}</p>
            </div>
            <div>
              <p className="text-ink/40 text-xs mb-1">Lag</p>
              <p className={`font-mono ${lagMs !== null && lagMs > 30000 ? "text-terracotta" : "text-olive"}`}>
                {lagMs !== null ? `${Math.round(lagMs / 1000)}s` : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Counters */}
        <div className="card">
          <h2 className="font-medium mb-3">Activity</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {[
              ["Agents", stats.agents],
              ["Followers", stats.followers],
              ["Intents", stats.intents],
              ["Copies", stats.copies],
              ["Refusals", stats.refusals],
              ["Slashes", stats.slashes],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-ink/40 text-xs mb-1">{label}</p>
                <p className="font-mono">{value ?? 0}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Contracts */}
        <div className="card">
          <h2 className="font-medium mb-3">Contracts</h2>
          <div className="space-y-2">
            {Object.entries(CONTRACT_ADDRESSES).filter(([, addr]) => addr).map(([name, addr]) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="text-ink/60">{name}</span>
                <a
                  href={arcscanAddress(addr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-terracotta hover:underline"
                >
                  {addr.slice(0, 12)}…{addr.slice(-4)} ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{
        __html: "setTimeout(() => window.location.reload(), 30000)"
      }} />
    </div>
  );
}
