import { z } from "zod";

export const SignalSchema = z.object({
  schemaVersion: z.literal("signal/1.0"),
  agentId: z.number().int(),
  marketSymbol: z.string(),
  direction: z.enum(["long", "short", "flat"]),
  conviction: z.number().min(0).max(1),
  horizonMinutes: z.number().int().min(15),
  rationale: z.string().max(280),
  evidence: z.array(z.string().url()).max(3),
  timestamp: z.number().int(),
});

export type Signal = z.infer<typeof SignalSchema>;
