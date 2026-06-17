"use client";
import { useEffect, useState, useCallback } from "react";
import { arcscanAddress } from "@phronos/shared";

type Stats = {
  agents?:           number;
  followers?:        number;
  intents?:          number;
  copies?:           number;
  refusals?:         number;
  slashes?:          number;
  indexerBlock?:     string | number;
  indexerUpdatedAt?: string | null;
};

type Contract = { name: string; address: string };

const POLL_MS = 10_000;

export function LiveStatus({ contracts }: { contracts: Contract[] }) {
  const [stats,  setStats]  = useState<Stats>({});
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/stats").catch(() => null);
    if (res?.ok) setStats(await res.json());
    setSeenAt(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const poll   = setInterval(refresh, POLL_MS);
    const ticker = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(ticker); };
  }, [refresh]);

  const lagMs = stats.indexerUpdatedAt
    ? Date.now() - new Date(stats.indexerUpdatedAt).getTime()
    : null;

  const lagS = lagMs !== null ? Math.round(lagMs / 1000) : null;
  const lastPollS = seenAt ? Math.round((Date.now() - seenAt) / 1000) : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between mb-2">
        <h1 className="font-display text-4xl">System status</h1>
        <span className="flex items-center gap-1.5 mt-2">
          <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse" />
          <span className="text-xs text-ink/30 font-mono">
            {lastPollS === null ? "…" : lastPollS < 2 ? "live" : `${lastPollS}s ago`}
          </span>
        </span>
      </div>
      <p className="text-ink/40 text-sm mb-8">Arc Testnet · chain ID 5042002</p>

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
              <p className={`font-mono ${lagS !== null && lagS > 30 ? "text-terracotta" : "text-olive"}`}>
                {lagS !== null ? `${lagS}s` : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Counters */}
        <div className="card">
          <h2 className="font-medium mb-3">Activity</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {(["agents", "followers", "intents", "copies", "refusals", "slashes"] as const).map(key => (
              <div key={key}>
                <p className="text-ink/40 text-xs mb-1 capitalize">{key}</p>
                <p className="font-mono">{stats[key] ?? (seenAt ? 0 : "—")}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Contracts */}
        {contracts.length > 0 && (
          <div className="card">
            <h2 className="font-medium mb-3">Contracts</h2>
            <div className="space-y-2">
              {contracts.map(({ name, address }) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="text-ink/60">{name}</span>
                  <a
                    href={arcscanAddress(address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-terracotta hover:underline"
                  >
                    {address.slice(0, 12)}…{address.slice(-4)} ↗
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
