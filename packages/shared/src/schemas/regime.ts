import { z } from "zod";

export const RegimeSchema = z.object({
  schemaVersion: z.literal("regime/1.0"),
  timestamp: z.number().int(),
  riskBand: z.number().int().min(0).max(4),
  usycTargetBps: z.number().int().min(0).max(10000),
  rationale: z.string().max(400),
  signalsConsidered: z.record(z.number()),
});

export type Regime = z.infer<typeof RegimeSchema>;
