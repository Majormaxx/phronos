import Anthropic from "@anthropic-ai/sdk";
import { keccak256, toHex } from "viem";

export interface IntentContext {
  erc8004Id: string;
  marketId: string;
  notionalUSDC: string;
  venue: number;
  rationale?: string;
}

export interface RefuserResult {
  allow: boolean;
  reason: string;    // human-readable
  reasonCode: number; // 1 = LLM_JUDGMENT
  reasonCID: `0x${string}`;
}

const client = new Anthropic();
const cache = new Map<string, RefuserResult>();

export async function llmJudgment(intent: IntentContext, marketSummary: string): Promise<RefuserResult> {
  const cacheKey = keccak256(toHex(JSON.stringify({ intent, marketSummary })));
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const prompt = `You are a risk reviewer for a crypto copy-trading system. Given this trade intent and market summary, decide if the intent is reasonable.

Intent:
- Agent: ${intent.erc8004Id}
- Market: ${intent.marketId}
- Notional: ${intent.notionalUSDC} USDC (positive=long, negative=short)
- Rationale: ${intent.rationale ?? "none provided"}

Market summary: ${marketSummary}

Return ONLY valid JSON: { "allow": boolean, "reason": "one sentence" }

Refuse only if there are obvious problems: sizing wildly inappropriate, strategy-spec mismatch, or the trade contradicts basic market logic.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = message.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(raw) as { allow: boolean; reason: string };

    const blob  = JSON.stringify({ refuser: "llm_judgment", ...parsed, timestamp: Date.now() });
    const result: RefuserResult = {
      allow:     parsed.allow,
      reason:    parsed.reason,
      reasonCode: 1,
      reasonCID: keccak256(toHex(blob)),
    };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return { allow: true, reason: "llm_judgment unavailable — defaulting to allow", reasonCode: 1, reasonCID: "0x0000000000000000000000000000000000000000000000000000000000000000" };
  }
}
