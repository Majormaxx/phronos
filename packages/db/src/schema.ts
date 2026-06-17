import {
  pgTable, serial, bigint, text, integer, real, boolean,
  timestamp, numeric, smallint, primaryKey,
} from "drizzle-orm/pg-core";

// Source of truth is the chain. These tables are projections of on-chain events.
// If dropped, re-run the indexer from block 0 to rebuild.

export const agents = pgTable("agents", {
  erc8004Id:        bigint("erc8004_id", { mode: "number" }).primaryKey(),
  operatorAddr:     text("operator_addr").notNull(),
  agentCardCid:     text("agent_card_cid").notNull(),
  strategyCid:      text("strategy_cid").notNull(),
  activeSince:      timestamp("active_since", { withTimezone: true }).notNull(),
  suspended:        boolean("suspended").notNull().default(false),
  lastIndexedBlock: bigint("last_indexed_block", { mode: "number" }).notNull(),
});

export const bonds = pgTable("bonds", {
  erc8004Id:   bigint("erc8004_id", { mode: "number" }).primaryKey(),
  usycShares:  numeric("usyc_shares", { precision: 78, scale: 0 }).notNull(),
  usdcEquiv:   numeric("usdc_equiv",  { precision: 78, scale: 0 }).notNull(),
  unbondedAt:  timestamp("unbonded_at", { withTimezone: true }),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull(),
});

export const followers = pgTable("followers", {
  address:    text("address").primaryKey(),
  escrowUsdc: numeric("escrow_usdc", { precision: 78, scale: 0 }).notNull(),
  firstSeen:  timestamp("first_seen", { withTimezone: true }).notNull(),
});

export const policies = pgTable("policies", {
  followerAddr: text("follower_addr").notNull(),
  erc8004Id:    bigint("erc8004_id", { mode: "number" }).notNull(),
  policyCid:    text("policy_cid").notNull(),
  policyHash:   text("policy_hash").notNull(),
  activeUntil:  timestamp("active_until", { withTimezone: true }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.followerAddr, t.erc8004Id] }) }));

export const intents = pgTable("intents", {
  intentHash:    text("intent_hash").primaryKey(),
  erc8004Id:     bigint("erc8004_id", { mode: "number" }).notNull(),
  venue:         smallint("venue").notNull(),        // 0=ARC_USDC_SWAP 1=HL_PERP 2=POLY_PRED
  marketId:      text("market_id").notNull(),
  notionalUsdc:  numeric("notional_usdc", { precision: 78, scale: 0 }).notNull(),
  validUntil:    timestamp("valid_until", { withTimezone: true }).notNull(),
  strategyHash:  text("strategy_hash").notNull(),
  traceCid:      text("trace_cid").notNull(),
  submittedAt:   timestamp("submitted_at", { withTimezone: true }).notNull(),
  blockNumber:   bigint("block_number", { mode: "number" }).notNull(),
  // HL perp fill data — null when using arc-mock venue
  hlOrderId:     text("hl_order_id"),
  entryPricePx:  numeric("entry_price_px", { precision: 30, scale: 10 }),
  fillSzBase:    numeric("fill_sz_base",   { precision: 30, scale: 10 }),
  closePricePx:  numeric("close_price_px", { precision: 30, scale: 10 }),
});

export const copies = pgTable("copies", {
  intentHash:       text("intent_hash").notNull(),
  followerAddr:     text("follower_addr").notNull(),
  followerNotional: numeric("follower_notional", { precision: 78, scale: 0 }).notNull(),
  venueReceipt:     text("venue_receipt").notNull(),
  executedAt:       timestamp("executed_at", { withTimezone: true }).notNull(),
  // Realized P&L filled in by keeper when position closes
  pnlUsdc:          numeric("pnl_usdc", { precision: 30, scale: 10 }),
}, (t) => ({ pk: primaryKey({ columns: [t.intentHash, t.followerAddr] }) }));

export const refusals = pgTable("refusals", {
  intentHash:  text("intent_hash").notNull(),
  followerAddr: text("follower_addr").notNull(),
  reason:      smallint("reason").notNull(),        // RefusalReason enum
  reasonCid:   text("reason_cid").notNull(),
  refusedAt:   timestamp("refused_at", { withTimezone: true }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.intentHash, t.followerAddr] }) }));

export const slashes = pgTable("slashes", {
  erc8004Id:    bigint("erc8004_id", { mode: "number" }).notNull(),
  bps:          integer("bps").notNull(),
  usdcReleased: numeric("usdc_released", { precision: 78, scale: 0 }).notNull(),
  sharpeAtEval: numeric("sharpe_at_eval", { precision: 78, scale: 18 }).notNull(),
  reasonHash:   text("reason_hash").notNull(),
  blockNumber:  bigint("block_number", { mode: "number" }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.erc8004Id, t.blockNumber] }) }));

export const traces = pgTable("traces", {
  traceCid:    text("trace_cid").primaryKey(),
  intentHash:  text("intent_hash").notNull(),
  agentId:     bigint("agent_id", { mode: "number" }).notNull(),
  contentHash: text("content_hash").notNull(),
  pinnedAt:    timestamp("pinned_at", { withTimezone: true }).notNull(),
});

// Stores human-readable metadata for user-created agents.
// Not derived from chain — written by the frontend after on-chain registration.
export const agentMetadata = pgTable("agent_metadata", {
  erc8004Id:    bigint("erc8004_id", { mode: "number" }).primaryKey(),
  name:         text("name").notNull(),
  description:  text("description").notNull().default(""),
  strategyType: text("strategy_type").notNull().default("Custom"),
  market:       text("market").notNull().default("BTC"),
  createdBy:    text("created_by").notNull(),
});

export const indexerCursor = pgTable("indexer_cursor", {
  chainId:   bigint("chain_id", { mode: "number" }).primaryKey(),
  lastBlock:  bigint("last_block", { mode: "number" }).notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull(),
});
