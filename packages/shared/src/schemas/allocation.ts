import { z } from "zod";

export const AllocationDecisionSchema = z
  .object({
    schemaVersion: z.literal("allocation/1.0"),
    timestamp: z.number().int(),
    bench: z.array(
      z.object({
        agentId: z.number().int(),
        weightBps: z.number().int().min(0).max(10000),
        rationale: z.string().max(280),
        keyEvidence: z.array(z.string().url()).max(3),
      })
    ),
    regimeAcknowledgement: z.object({
      sentinelRiskBand: z.number().int().min(0).max(4),
      usycTargetBps: z.number().int().min(0).max(10000),
    }),
    exploration: z.object({
      explorationBps: z.number().int().min(0).max(2000),
      note: z.string().max(140),
    }),
  })
  .refine((d) => d.bench.reduce((s, b) => s + b.weightBps, 0) === 10000, {
    message: "weights must sum to 10000 bps",
  });

export type AllocationDecision = z.infer<typeof AllocationDecisionSchema>;
