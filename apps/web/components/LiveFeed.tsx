"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface ActivityEvent {
  type:    "intent" | "copy" | "refusal";
  time:    string;
  label:   string;
  sub:     string;
  hash:    string | null;
  agentId: number | null;
}

const TYPE_CONFIG = {
  intent:  { dot: "bg-ink/40",      text: "text-ink/40",      badge: "SIGNAL"  },
  copy:    { dot: "bg-olive",       text: "text-olive",       badge: "COPIED"  },
  refusal: { dot: "bg-terracotta",  text: "text-terracotta",  badge: "BLOCKED" },
} as const;

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function LiveFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [stale, setStale]   = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      if (!res.ok) return;
      const data: ActivityEvent[] = await res.json();
      setEvents(data);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono text-ink/25 uppercase tracking-widest">On-chain activity</p>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full transition-colors ${stale ? "bg-terracotta/50" : "bg-olive animate-pulse"}`} />
          <span className="text-xs text-ink/20 font-mono">{stale ? "reconnecting" : "live"}</span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-ink/5 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-ink/10 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 bg-ink/8 rounded w-16" />
                <div className="h-2 bg-ink/5 rounded w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {events.map((e, i) => {
            const cfg  = TYPE_CONFIG[e.type] ?? TYPE_CONFIG.intent;
            const ago  = timeAgo(new Date(e.time));
            return (
              <div
                key={`${e.type}-${e.hash ?? i}-${i}`}
                className="flex items-center gap-3 py-2.5 border-b border-ink/5 last:border-0 group"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${cfg.text}`}>{cfg.badge}</span>
                    <span className="text-sm font-medium truncate">{e.label}</span>
                  </div>
                  <p className="text-xs text-ink/40 truncate">{e.sub}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-ink/25 font-mono w-14 text-right">{ago}</span>
                  {e.hash && (
                    <Link
                      href={`/traces/${e.hash}`}
                      className="text-xs text-ink/20 hover:text-terracotta transition-colors"
                      title="View trace"
                    >
                      ↗
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
