import {
  pgTable, serial, text, integer, real, timestamp, jsonb, varchar, boolean,
} from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
  id:              serial("id").primaryKey(),
  agentId:         text("agent_id").notNull().unique(),   // ERC-8004 id (uint256 as string)
  persona:         text("persona").notNull(),
  operatorAddress: text("operator_address").notNull(),
  agentCardCid:    text("agent_card_cid"),
  admitted:        boolean("admitted").default(false),
  registeredAt:    timestamp("registered_at").defaultNow(),
});

export const signals = pgTable("signals", {
  id:             serial("id").primaryKey(),
  agentId:        text("agent_id").notNull(),
  marketSymbol:   varchar("market_symbol", { length: 20 }).notNull(),
  direction:      text("direction").notNull(),            // long | short | flat
  conviction:     real("conviction").notNull(),
  horizonMinutes: integer("horizon_minutes").notNull(),
  rationale:      text("rationale"),
  evidence:       jsonb("evidence").$type<string[]>(),
  ipfsCid:        text("ipfs_cid"),
  createdAt:      timestamp("created_at").defaultNow(),
});

export const decisions = pgTable("decisions", {
  id:          serial("id").primaryKey(),
  traceHash:   text("trace_hash").notNull().unique(),
  ipfsCid:     text("ipfs_cid").notNull(),
  decisionJson: jsonb("decision_json").notNull(),
  txHash:      text("tx_hash"),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const regimes = pgTable("regimes", {
  id:            serial("id").primaryKey(),
  traceHash:     text("trace_hash").notNull().unique(),
  ipfsCid:       text("ipfs_cid").notNull(),
  riskBand:      integer("risk_band").notNull(),
  usycTargetBps: integer("usyc_target_bps").notNull(),
  rationale:     text("rationale"),
  txHash:        text("tx_hash"),
  createdAt:     timestamp("created_at").defaultNow(),
});

export const slashes = pgTable("slashes", {
  id:           serial("id").primaryKey(),
  agentId:      text("agent_id").notNull(),
  bps:          integer("bps").notNull(),
  amount:       text("amount").notNull(),                 // bigint as string
  reasonHash:   text("reason_hash"),
  txHash:       text("tx_hash"),
  sharpeAtSlash: real("sharpe_at_slash"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export const traces = pgTable("traces", {
  id:         serial("id").primaryKey(),
  traceHash:  text("trace_hash").notNull().unique(),
  ipfsCid:    text("ipfs_cid").notNull(),
  kind:       text("kind").notNull(),                     // allocation | regime | slash
  verifiedAt: timestamp("verified_at"),
  createdAt:  timestamp("created_at").defaultNow(),
});

export const goals = pgTable("goals", {
  id:          serial("id").primaryKey(),
  userAddress: text("user_address").notNull(),
  goalText:    text("goal_text").notNull(),
  ipfsCid:     text("ipfs_cid").notNull(),
  txHash:      text("tx_hash"),
  createdAt:   timestamp("created_at").defaultNow(),
});
