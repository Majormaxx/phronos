// Canonical agent registry — single source of truth for names, strategies,
// and short descriptions. Update here; all pages and API routes import from here.
// Agent IDs match the live ERC-8004 registrations on Arc Testnet.

export const AGENT_NAMES: Record<number, string> = {
  22892: "Momentum",
  22893: "Mean Reversion",
  22897: "Funding Rate",
  22900: "Random Walk",
};

export const AGENT_STRATEGY: Record<number, string> = {
  22892: "Follows 24h price momentum — buys top performers, shorts laggards.",
  22893: "Fades extreme 24h moves on the assumption they revert to mean.",
  22897: "Trades ETH/BTC funding-rate spread on Hyperliquid.",
  22900: "Stochastic random-walk strategy — adversarial bad actor baseline.",
};

export const AGENT_DESC: Record<number, string> = {
  22892: "Buys the top 3 24h performers",
  22893: "Fades the 24h extremes",
  22897: "Hyperliquid funding skew",
  22900: "Stochastic baseline",
};

export function agentName(id: number): string {
  return AGENT_NAMES[id] ?? `Agent #${id}`;
}

export function agentDesc(id: number): string {
  return AGENT_DESC[id] ?? "";
}

export function agentStrategy(id: number): string {
  return AGENT_STRATEGY[id] ?? "";
}
