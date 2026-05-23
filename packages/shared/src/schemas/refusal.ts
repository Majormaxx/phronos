import { z } from "zod";

export const RefusalReasonSchema = z.enum([
  "NONE",
  "LLM_JUDGMENT",
  "MACRO_SHIFT",
  "WHALE_CONTRADICTION",
  "POLICY_VIOLATION",
]);
export type RefusalReason = z.infer<typeof RefusalReasonSchema>;

export const RefusalSchema = z.object({
  schemaVersion: z.literal("refusal/1.0"),
  intentHash:    z.string().regex(/^0x[0-9a-f]{64}$/i),
  follower:      z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  reason:        RefusalReasonSchema,
  rationale:     z.string().max(400),
  timestamp:     z.number().int(),
  // Populated after IPFS pin
  reasonCID:     z.string().optional(),
});

export type Refusal = z.infer<typeof RefusalSchema>;
