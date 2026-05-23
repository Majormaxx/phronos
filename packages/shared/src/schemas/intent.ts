import { z } from "zod";

// Venue enum matching PhronosRouter.Venue
export const VenueSchema = z.enum(["ARC_USDC_SWAP", "HYPERLIQUID_PERP", "POLYMARKET_PRED"]);
export type Venue = z.infer<typeof VenueSchema>;

// EIP-712 typed Intent struct — mirrors PhronosRouter.Intent exactly.
export const IntentSchema = z.object({
  schemaVersion: z.literal("intent/1.0"),
  erc8004Id:     z.number().int().positive(),
  venue:         VenueSchema,
  marketId:      z.string(),                  // venue-specific market identifier
  notionalUSDC:  z.string(),                  // signed bigint as decimal string (+ = long, - = short)
  validUntil:    z.number().int(),             // unix seconds
  nonce:         z.number().int().nonnegative(),
  strategyHash:  z.string().regex(/^0x[0-9a-f]{64}$/i),
  traceCID:      z.string(),                  // IPFS CID of the reasoning trace
  rationale:     z.string().max(400),
  timestamp:     z.number().int(),
});

export type Intent = z.infer<typeof IntentSchema>;

// EIP-712 type hash components for on-chain verification
export const INTENT_TYPE = [
  { name: "erc8004Id",    type: "uint256" },
  { name: "venue",        type: "uint8"   },
  { name: "marketId",     type: "bytes32" },
  { name: "notionalUSDC", type: "int256"  },
  { name: "validUntil",   type: "uint64"  },
  { name: "nonce",        type: "uint256" },
  { name: "strategyHash", type: "bytes32" },
  { name: "traceCID",     type: "bytes32" },
] as const;
