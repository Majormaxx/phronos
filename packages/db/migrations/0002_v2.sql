-- Phronos v2 schema — projection of on-chain events.
-- Drop v1 tables first (they are projections; no data loss from chain perspective).

DROP TABLE IF EXISTS "goals" CASCADE;
DROP TABLE IF EXISTS "decisions" CASCADE;
DROP TABLE IF EXISTS "regimes" CASCADE;
DROP TABLE IF EXISTS "signals" CASCADE;
DROP TABLE IF EXISTS "traces" CASCADE;
DROP TABLE IF EXISTS "slashes" CASCADE;
DROP TABLE IF EXISTS "agents" CASCADE;

-- v2 tables

CREATE TABLE IF NOT EXISTS "agents" (
  "erc8004_id"          BIGINT PRIMARY KEY,
  "operator_addr"       TEXT NOT NULL,
  "agent_card_cid"      TEXT NOT NULL,
  "strategy_cid"        TEXT NOT NULL,
  "active_since"        TIMESTAMPTZ NOT NULL,
  "suspended"           BOOLEAN NOT NULL DEFAULT FALSE,
  "last_indexed_block"  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "bonds" (
  "erc8004_id"   BIGINT PRIMARY KEY,
  "usyc_shares"  NUMERIC(78, 0) NOT NULL,
  "usdc_equiv"   NUMERIC(78, 0) NOT NULL,
  "unbonded_at"  TIMESTAMPTZ,
  "last_updated" TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS "followers" (
  "address"     TEXT PRIMARY KEY,
  "escrow_usdc" NUMERIC(78, 0) NOT NULL,
  "first_seen"  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS "policies" (
  "follower_addr" TEXT NOT NULL,
  "erc8004_id"    BIGINT NOT NULL,
  "policy_cid"    TEXT NOT NULL,
  "policy_hash"   TEXT NOT NULL,
  "active_until"  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("follower_addr", "erc8004_id")
);

CREATE TABLE IF NOT EXISTS "intents" (
  "intent_hash"   TEXT PRIMARY KEY,
  "erc8004_id"    BIGINT NOT NULL,
  "venue"         SMALLINT NOT NULL,
  "market_id"     TEXT NOT NULL,
  "notional_usdc" NUMERIC(78, 0) NOT NULL,
  "valid_until"   TIMESTAMPTZ NOT NULL,
  "strategy_hash" TEXT NOT NULL,
  "trace_cid"     TEXT NOT NULL,
  "submitted_at"  TIMESTAMPTZ NOT NULL,
  "block_number"  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "copies" (
  "intent_hash"       TEXT NOT NULL,
  "follower_addr"     TEXT NOT NULL,
  "follower_notional" NUMERIC(78, 0) NOT NULL,
  "venue_receipt"     TEXT NOT NULL,
  "executed_at"       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("intent_hash", "follower_addr")
);

CREATE TABLE IF NOT EXISTS "refusals" (
  "intent_hash"  TEXT NOT NULL,
  "follower_addr" TEXT NOT NULL,
  "reason"       SMALLINT NOT NULL,
  "reason_cid"   TEXT NOT NULL,
  "refused_at"   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("intent_hash", "follower_addr")
);

CREATE TABLE IF NOT EXISTS "slashes" (
  "erc8004_id"    BIGINT NOT NULL,
  "bps"           INTEGER NOT NULL,
  "usdc_released" NUMERIC(78, 0) NOT NULL,
  "sharpe_at_eval" NUMERIC(78, 18) NOT NULL,
  "reason_hash"   TEXT NOT NULL,
  "block_number"  BIGINT NOT NULL,
  PRIMARY KEY ("erc8004_id", "block_number")
);

CREATE TABLE IF NOT EXISTS "traces" (
  "trace_cid"    TEXT PRIMARY KEY,
  "intent_hash"  TEXT NOT NULL,
  "agent_id"     BIGINT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "pinned_at"    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS "indexer_cursor" (
  "chain_id"   BIGINT PRIMARY KEY,
  "last_block" BIGINT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_intents_agent"    ON "intents"("erc8004_id", "submitted_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_copies_follower"  ON "copies"("follower_addr", "executed_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_refusals_intent"  ON "refusals"("intent_hash");
CREATE INDEX IF NOT EXISTS "idx_slashes_agent"    ON "slashes"("erc8004_id");
