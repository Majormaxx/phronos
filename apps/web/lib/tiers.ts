export type Tier = "scout" | "proven" | "sentinel" | "alpha";

export function computeTier(agent: {
  intentCount:   number;
  sharpe7d:      number;
  slashCount:    number;
  followerCount: number;
}): Tier {
  const { intentCount, sharpe7d, slashCount, followerCount } = agent;
  // Alpha: elite. Top performance, large following, zero slashes.
  if (intentCount >= 100 && sharpe7d >= 2.0 && followerCount >= 10 && slashCount === 0)
    return "alpha";
  // Sentinel: consistent. Positive track record, real followers, clean history.
  if (intentCount >= 50 && sharpe7d >= 1.0 && followerCount >= 3 && slashCount === 0)
    return "sentinel";
  // Proven: performing. Active with positive Sharpe — earned trust.
  if (intentCount >= 20 && sharpe7d > 0)
    return "proven";
  // Scout: just started.
  return "scout";
}

export const TIER_META: Record<Tier, {
  label:       string;
  color:       string;
  bg:          string;
  border:      string;
  description: string;
  requires:    string;
}> = {
  scout: {
    label:       "Scout",
    color:       "text-ink/30",
    bg:          "bg-ink/5",
    border:      "border-ink/10",
    description: "Default — just getting started.",
    requires:    "Register and post a bond.",
  },
  proven: {
    label:       "Proven",
    color:       "text-olive",
    bg:          "bg-olive/8",
    border:      "border-olive/20",
    description: "Active agent with positive Sharpe.",
    requires:    "20+ intents, Sharpe > 0.",
  },
  sentinel: {
    label:       "Sentinel",
    color:       "text-ink/80",
    bg:          "bg-ink/8",
    border:      "border-ink/30",
    description: "Trusted signal with a following. Zero slashes.",
    requires:    "50+ intents, Sharpe ≥ 1.0, 3+ followers, no slashes.",
  },
  alpha: {
    label:       "Alpha",
    color:       "text-ink",
    bg:          "bg-ink/[0.12]",
    border:      "border-ink/50",
    description: "Elite. Top-decile Sharpe, real following, untouched bond.",
    requires:    "100+ intents, Sharpe ≥ 2.0, 10+ followers, no slashes.",
  },
};

export function TierChip({ tier }: { tier: Tier }) {
  const m = TIER_META[tier];
  if (tier === "scout") return null; // no chip for default state
  return (
    <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border ${m.color} ${m.bg} ${m.border}`}>
      {m.label}
    </span>
  );
}
