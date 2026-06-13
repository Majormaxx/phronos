/**
 * Phronos Premium Data API — HTTP server (seller side).
 *
 * Endpoints protected by Circle Gateway Nanopayments ($0.001 per call).
 * Clients call GatewayClient.pay() to attach the x402 payment header.
 *
 * Start independently: ts-node src/server.ts
 * Or imported by index.ts to run alongside the MCP stdio server.
 */
import express from "express";
import { requirePayment } from "./middleware.js";
import { db, agents, intents, bonds, slashes, copies } from "@phronos/db";
import { desc, eq } from "drizzle-orm";

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3001);

const AGENT_NAMES: Record<number, string> = {
  19297: "Momentum", 19298: "Mean Reversion", 19299: "Funding Rate", 19300: "Random Walk",
};

export function createApp() {
  const app = express();
  app.use(express.json());

  // Health — free
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "phronos-mcp", ts: new Date().toISOString() });
  });

  // ── Premium endpoints (require $0.001 USDC payment each) ──────────────────

  // Leaderboard: top agents by 7d Sharpe with bond info
  app.get("/tool/leaderboard", requirePayment("$0.001"), async (_req, res) => {
    try {
      const rows = await db()
        .select()
        .from(agents)
        .leftJoin(bonds, eq(bonds.erc8004Id, agents.erc8004Id))
        .orderBy(desc(agents.sharpe7d))
        .limit(10);

      res.json(rows.map((r) => ({
        erc8004Id: r.agents.erc8004Id,
        name:      AGENT_NAMES[r.agents.erc8004Id] ?? `Agent #${r.agents.erc8004Id}`,
        sharpe7d:  r.agents.sharpe7d,
        bondUsdc:  r.bonds?.usdcEquiv ?? "0",
        followers: r.agents.followerCount,
      })));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Agent stats: bond, intent count, slash history
  app.get("/tool/agent/:id", requirePayment("$0.001"), async (req, res) => {
    const agentId = Number(req.params.id);
    try {
      const [agentRows, bondRows, slashRows, intentCount] = await Promise.all([
        db().select().from(agents).where(eq(agents.erc8004Id, agentId)).limit(1),
        db().select().from(bonds).where(eq(bonds.erc8004Id, agentId)).limit(1),
        db().select().from(slashes).where(eq(slashes.erc8004Id, agentId)).orderBy(desc(slashes.blockNumber)).limit(5),
        db().select().from(intents).where(eq(intents.erc8004Id, agentId)),
      ]);
      const agent = agentRows[0];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      res.json({
        erc8004Id:    agent.erc8004Id,
        name:         AGENT_NAMES[agent.erc8004Id] ?? `Agent #${agent.erc8004Id}`,
        sharpe7d:     agent.sharpe7d,
        bondUsdc:     bondRows[0]?.usdcEquiv ?? "0",
        intentCount:  intentCount.length,
        slashHistory: slashRows.map((s) => ({
          bps:          s.bps,
          usdcReleased: s.usdcReleased,
          block:        s.blockNumber,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Recent intents for an agent — useful for LLM context
  app.get("/tool/agent/:id/intents", requirePayment("$0.001"), async (req, res) => {
    const agentId = Number(req.params.id);
    try {
      const rows = await db()
        .select()
        .from(intents)
        .where(eq(intents.erc8004Id, agentId))
        .orderBy(desc(intents.submittedAt))
        .limit(20);

      res.json(rows.map((r) => ({
        hash:         r.intentHash,
        market:       r.marketId,
        notional:     r.notionalUsdc,
        submittedAt:  r.submittedAt,
        traceCid:     r.traceCid,
      })));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Copy activity — follower execution history
  app.get("/tool/activity", requirePayment("$0.001"), async (_req, res) => {
    try {
      const rows = await db()
        .select()
        .from(copies)
        .orderBy(desc(copies.executedAt))
        .limit(20);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}

// Start standalone when invoked directly
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[mcp-server] Premium data API listening on http://localhost:${PORT}`);
    console.log(`[mcp-server] Routes require $0.001 USDC via Circle Gateway`);
  });
}
