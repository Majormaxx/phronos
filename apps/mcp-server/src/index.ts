#!/usr/bin/env node
/**
 * Phronos MCP Server — Claude-compatible Model Context Protocol server.
 *
 * Exposes Phronos leaderboard, agent stats, and replay tools to any MCP client
 * (Claude Code, Claude Desktop). Premium tools pay $0.001 USDC per call via
 * Circle Gateway Nanopayments using the x402 protocol.
 *
 * Install in Claude Code:
 *   claude mcp add phronos -- node apps/mcp-server/src/index.js
 *
 * Two processes share this entry point:
 *   MCP_MODE=stdio  → stdio transport (default, for Claude Code / Desktop)
 *   MCP_MODE=http   → starts the Express Gateway server on MCP_HTTP_PORT
 */
import { Server }       from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createApp } from "./server.js";
import { db, agents, intents, bonds, slashes, copies, refusals } from "@phronos/db";
import { desc, eq } from "drizzle-orm";
import { spawn } from "child_process";

const MCP_MODE   = process.env.MCP_MODE ?? "stdio";
const HTTP_PORT  = Number(process.env.MCP_HTTP_PORT ?? 3001);
const SERVER_URL = process.env.MCP_SERVER_URL ?? `http://localhost:${HTTP_PORT}`;

// Circle Gateway client (buyer side) — used by premium tools to pay the HTTP API.
// Falls back to direct DB access when no payment credentials are configured.
const BUYER_KEY = (process.env.GATEWAY_BUYER_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? "") as `0x${string}`;
const gatewayClient = BUYER_KEY
  ? new GatewayClient({ chain: "arcTestnet", privateKey: BUYER_KEY })
  : null;

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name:        "phronos_leaderboard",
    description: "Returns the current Phronos agent leaderboard sorted by 7-day Sharpe ratio. Shows bond size and follower count. Costs $0.001 USDC via Circle Gateway.",
    inputSchema: {
      type:       "object" as const,
      properties: { limit: { type: "number", description: "Max agents to return (default 10)" } },
      required:   [],
    },
  },
  {
    name:        "phronos_agent_stats",
    description: "Returns detailed statistics for a specific Phronos agent: bond balance, intent count, 7d Sharpe, slash history. Costs $0.001 USDC via Circle Gateway.",
    inputSchema: {
      type:       "object" as const,
      properties: { agentId: { type: "number", description: "ERC-8004 agent ID (e.g. 19297)" } },
      required:   ["agentId"],
    },
  },
  {
    name:        "phronos_recent_intents",
    description: "Returns the 20 most recent trade intents for an agent with market, direction, and IPFS trace CID. Costs $0.001 USDC.",
    inputSchema: {
      type:       "object" as const,
      properties: { agentId: { type: "number", description: "ERC-8004 agent ID" } },
      required:   ["agentId"],
    },
  },
  {
    name:        "phronos_activity_feed",
    description: "Returns the latest 20 copy-trade executions across all agents and followers. Costs $0.001 USDC.",
    inputSchema: {
      type:       "object" as const,
      properties: {},
      required:   [],
    },
  },
  {
    name:        "phronos_system_status",
    description: "Free health check: returns active agent count, total copy trades, total refusals, and last indexed block.",
    inputSchema: {
      type:       "object" as const,
      properties: {},
      required:   [],
    },
  },
] as const;

// ── Tool implementations ──────────────────────────────────────────────────────

const AGENT_NAMES: Record<number, string> = {
  22892: "Momentum", 22893: "Mean Reversion", 22897: "Funding Rate", 22900: "Random Walk",
};

async function callPremiumEndpoint(path: string): Promise<unknown> {
  const url = `${SERVER_URL}${path}`;
  if (gatewayClient) {
    // GatewayClient.pay() handles the 402 flow and returns { data, amount, ... }
    const result = await gatewayClient.pay(url);
    return result.data;
  }
  // Fallback: direct HTTP (no payment header) — works when MCP server has DB access
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "phronos_leaderboard": {
      // Try gateway first; fall back to direct DB if server not running
      try {
        const data = await callPremiumEndpoint("/tool/leaderboard");
        return JSON.stringify(data, null, 2);
      } catch {
        // Direct DB fallback
        const rows = await db().select().from(agents).orderBy(desc(agents.sharpe7d)).limit(Number(args.limit ?? 10));
        return JSON.stringify(rows.map((a) => ({
          erc8004Id: a.erc8004Id,
          name:      AGENT_NAMES[a.erc8004Id] ?? `Agent #${a.erc8004Id}`,
          sharpe7d:  a.sharpe7d,
        })), null, 2);
      }
    }

    case "phronos_agent_stats": {
      const agentId = Number(args.agentId);
      if (!agentId) return "Error: agentId is required";
      try {
        const data = await callPremiumEndpoint(`/tool/agent/${agentId}`);
        return JSON.stringify(data, null, 2);
      } catch {
        const [agentRows, bondRows, slashRows] = await Promise.all([
          db().select().from(agents).where(eq(agents.erc8004Id, agentId)).limit(1),
          db().select().from(bonds).where(eq(bonds.erc8004Id, agentId)).limit(1),
          db().select().from(slashes).where(eq(slashes.erc8004Id, agentId)).orderBy(desc(slashes.blockNumber)).limit(5),
        ]);
        if (!agentRows[0]) return `Error: Agent ${agentId} not found`;
        return JSON.stringify({
          erc8004Id:   agentRows[0].erc8004Id,
          name:        AGENT_NAMES[agentRows[0].erc8004Id] ?? `Agent #${agentId}`,
          sharpe7d:    agentRows[0].sharpe7d,
          bondUsdc:    bondRows[0]?.usdcEquiv ?? "0",
          slashCount:  slashRows.length,
        }, null, 2);
      }
    }

    case "phronos_recent_intents": {
      const agentId = Number(args.agentId);
      if (!agentId) return "Error: agentId is required";
      try {
        const data = await callPremiumEndpoint(`/tool/agent/${agentId}/intents`);
        return JSON.stringify(data, null, 2);
      } catch {
        const rows = await db()
          .select()
          .from(intents)
          .where(eq(intents.erc8004Id, agentId))
          .orderBy(desc(intents.submittedAt))
          .limit(20);
        return JSON.stringify(rows, null, 2);
      }
    }

    case "phronos_activity_feed": {
      try {
        const data = await callPremiumEndpoint("/tool/activity");
        return JSON.stringify(data, null, 2);
      } catch {
        const rows = await db().select().from(copies).orderBy(desc(copies.executedAt)).limit(20);
        return JSON.stringify(rows, null, 2);
      }
    }

    case "phronos_system_status": {
      // Free — direct DB, no payment required
      const [agentRows, copyRows, refusalRows] = await Promise.all([
        db().select().from(agents),
        db().select().from(copies),
        db().select().from(refusals),
      ]);
      return JSON.stringify({
        agents:    agentRows.length,
        copies:    copyRows.length,
        refusals:  refusalRows.length,
        timestamp: new Date().toISOString(),
      }, null, 2);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Server setup ──────────────────────────────────────────────────────────────

async function startMCPServer() {
  const server = new Server(
    { name: "phronos", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ ...t })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const result = await handleTool(name, args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[phronos-mcp] stdio MCP server ready — 5 tools registered");
}

// ── Gateway HTTP server spawner ───────────────────────────────────────────────

function spawnGatewayServer(): void {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname], {
    env:      { ...process.env, MCP_MODE: "http" },
    detached: false,
    stdio:    ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => console.error("[phronos-mcp-http]", d.toString().trim()));
  child.stderr?.on("data", (d: Buffer) => console.error("[phronos-mcp-http]", d.toString().trim()));
  child.on("exit", (code) => console.error(`[phronos-mcp-http] exited code=${code}`));
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (MCP_MODE === "http") {
  const app = createApp();
  app.listen(HTTP_PORT, () => {
    console.log(`[phronos-mcp] Premium API on http://localhost:${HTTP_PORT}`);
    console.log(`[phronos-mcp] Endpoints protected by Circle Gateway ($0.001 USDC)`);
  });
} else {
  // Spawn the HTTP Gateway server as a sibling process so premium tools pay via Circle.
  // Only spawns when a buyer key is configured — otherwise falls back to direct DB.
  if (BUYER_KEY) spawnGatewayServer();
  startMCPServer().catch((err) => {
    console.error("[phronos-mcp] Fatal:", err);
    process.exit(1);
  });
}
