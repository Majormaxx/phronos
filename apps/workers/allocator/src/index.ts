import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseAbi } from "viem";
import { db, decisions, signals, agents } from "@phronos/db";
import {
  AllocationDecisionSchema,
  type AllocationDecision,
  pinJson,
  getPublicClient,
  getWalletClient,
  getDeployedAddresses,
} from "@phronos/shared";
import { desc, gte, eq } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN !== "false";
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const __dir = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(join(__dir, "prompt.md"), "utf-8");

const client = new Anthropic();

const VAULT_ABI = parseAbi([
  "function setWeightsAndAnchor(uint256[] agentIds, uint16[] weightsBps, bytes32 traceHash, string ipfsCid) external",
  "function getActiveAgents() external view returns (uint256[])",
  "function traderBond(uint256 agentId) external view returns (uint256)",
  "function traderWeightBps(uint256 agentId) external view returns (uint16)",
]);

const BENCH_ABI = parseAbi([
  "function admittedAgents() external view returns (uint256[])",
]);

async function buildContext(latestRiskBand: number): Promise<string> {
  const store = db();
  const admittedAgents = await store.select().from(agents).where(eq(agents.admitted, true));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const benches = await Promise.all(
    admittedAgents.map(async (a) => {
      const recentSignals = await store
        .select()
        .from(signals)
        .where(eq(signals.agentId, a.agentId))
        .where(gte(signals.createdAt, since))
        .orderBy(desc(signals.createdAt))
        .limit(20);

      return {
        agentId: Number(a.agentId),
        persona: a.persona,
        recentSignals: recentSignals.map((s) => ({
          market: s.marketSymbol,
          direction: s.direction,
          conviction: s.conviction,
          rationale: s.rationale,
        })),
      };
    })
  );

  const context = {
    currentTimestamp: Math.floor(Date.now() / 1000),
    sentinelRiskBand: latestRiskBand,
    bench: benches,
    note: "Produce an AllocationDecision. Weights must sum to 10000 bps.",
  };

  return JSON.stringify(context, null, 2);
}

async function runAllocator(): Promise<void> {
  console.log(`[allocator] running — dry_run=${DRY_RUN}`);

  // Get latest risk band from most recent regime (default 0 = risk-on)
  const { regimes } = await import("@phronos/db");
  const latestRegime = await db()
    .select()
    .from(regimes)
    .orderBy(desc(regimes.createdAt))
    .limit(1);
  const riskBand = latestRegime[0]?.riskBand ?? 0;

  const userContext = await buildContext(riskBand);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContext }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text ?? "";

  let decision: AllocationDecision;
  try {
    const parsed = JSON.parse(rawText);
    decision = AllocationDecisionSchema.parse(parsed);
  } catch (err) {
    console.error("[allocator] invalid LLM output:", rawText, err);
    return;
  }

  const json = JSON.stringify(decision);
  console.log("[allocator] decision:", json.slice(0, 200));

  if (DRY_RUN) {
    console.log("[allocator] DRY_RUN — skipping IPFS pin and chain write");
    return;
  }

  // Pin to IPFS
  const { cid, traceHash } = await pinJson(json);
  console.log(`[allocator] pinned cid=${cid} hash=${traceHash}`);

  // Persist to DB
  await db().insert(decisions).values({
    traceHash,
    ipfsCid: cid,
    decisionJson: decision as object,
  });

  // Write to chain
  const pk = process.env.ALLOCATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) { console.warn("[allocator] ALLOCATOR_PRIVATE_KEY not set — skipping tx"); return; }

  const walletClient = getWalletClient(pk);
  const { vault } = getDeployedAddresses();

  const agentIds = decision.bench.map((b) => BigInt(b.agentId));
  const weightsBps = decision.bench.map((b) => b.weightBps);

  const hash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "setWeightsAndAnchor",
    args: [agentIds, weightsBps, traceHash, cid],
  });

  console.log(`[allocator] tx submitted: ${hash}`);
  await db().update(decisions).set({ txHash: hash }).where(eq(decisions.traceHash, traceHash));
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await runAllocator();
    } catch (err) {
      console.error("[allocator] run failed:", err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
