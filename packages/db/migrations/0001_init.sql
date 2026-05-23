CREATE TABLE IF NOT EXISTS "agents" (
  "id"               SERIAL PRIMARY KEY,
  "agent_id"         TEXT NOT NULL UNIQUE,
  "persona"          TEXT NOT NULL,
  "operator_address" TEXT NOT NULL,
  "agent_card_cid"   TEXT,
  "admitted"         BOOLEAN DEFAULT false,
  "registered_at"    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "signals" (
  "id"              SERIAL PRIMARY KEY,
  "agent_id"        TEXT NOT NULL,
  "market_symbol"   VARCHAR(20) NOT NULL,
  "direction"       TEXT NOT NULL,
  "conviction"      REAL NOT NULL,
  "horizon_minutes" INTEGER NOT NULL,
  "rationale"       TEXT,
  "evidence"        JSONB,
  "ipfs_cid"        TEXT,
  "created_at"      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "decisions" (
  "id"            SERIAL PRIMARY KEY,
  "trace_hash"    TEXT NOT NULL UNIQUE,
  "ipfs_cid"      TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "tx_hash"       TEXT,
  "created_at"    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "regimes" (
  "id"              SERIAL PRIMARY KEY,
  "trace_hash"      TEXT NOT NULL UNIQUE,
  "ipfs_cid"        TEXT NOT NULL,
  "risk_band"       INTEGER NOT NULL,
  "usyc_target_bps" INTEGER NOT NULL,
  "rationale"       TEXT,
  "tx_hash"         TEXT,
  "created_at"      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "slashes" (
  "id"              SERIAL PRIMARY KEY,
  "agent_id"        TEXT NOT NULL,
  "bps"             INTEGER NOT NULL,
  "amount"          TEXT NOT NULL,
  "reason_hash"     TEXT,
  "tx_hash"         TEXT,
  "sharpe_at_slash" REAL,
  "created_at"      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "traces" (
  "id"          SERIAL PRIMARY KEY,
  "trace_hash"  TEXT NOT NULL UNIQUE,
  "ipfs_cid"    TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "verified_at" TIMESTAMP,
  "created_at"  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "goals" (
  "id"           SERIAL PRIMARY KEY,
  "user_address" TEXT NOT NULL,
  "goal_text"    TEXT NOT NULL,
  "ipfs_cid"     TEXT NOT NULL,
  "tx_hash"      TEXT,
  "created_at"   TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "signals_agent_id_idx" ON "signals" ("agent_id");
CREATE INDEX IF NOT EXISTS "signals_created_at_idx" ON "signals" ("created_at");
CREATE INDEX IF NOT EXISTS "slashes_agent_id_idx" ON "slashes" ("agent_id");
