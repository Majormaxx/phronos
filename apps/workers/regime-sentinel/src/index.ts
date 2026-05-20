import OpenAI from "openai";
import { parseAbi } from "viem";
import { db, regimes } from "@phronos/db";
import {
  RegimeSchema,
  type Regime,
  pinJson,
  getPublicClient,
  getWalletClient,
  getDeployedAddresses,
} from "@phronos/shared";
import { desc, eq } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN !== "false";
const INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const USYC_FLIP_THRESHOLD_BPS = 500; // only flip if target differs by ≥500 bps

const openai = new OpenAI();

const VAULT_ABI = parseAbi([
  "function flipToUSYC(uint256 amount, bytes32 traceHash, string ipfsCid) external",
  "function redeemFromUSYC(uint256 usycAmount, bytes32 traceHash, string ipfsCid) external",
  "function totalAssetsUSDC() external view returns (uint256)",
  "function usycPosition() external view returns (uint256)",
  "function nav() external view returns (uint256)",
]);

async function fetchVolData(): Promise<Record<string, number>> {
  const data: Record<string, number> = {};

  try {
    // Hyperliquid funding rates (public API)
    const hlRes = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    if (hlRes.ok) {
      const hlData = (await hlRes.json()) as [unknown, Array<{ funding: string }>];
      const btcFunding = parseFloat(hlData[1]?.[0]?.funding ?? "0");
      const ethFunding = parseFloat(hlData[1]?.[1]?.funding ?? "0");
      data["btc_funding"] = btcFunding;
      data["eth_funding"] = ethFunding;
    }
  } catch { /* non-fatal */ }

  // Fallback signals
  data["timestamp"] = Math.floor(Date.now() / 1000);
  return data;
}

async function getCurrentUsycBps(): Promise<number> {
  const { vault } = getDeployedAddresses();
  if (!vault) return 0;

  const publicClient = getPublicClient();
  try {
    const [totalNav, usycPos] = await Promise.all([
      publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: "nav" }),
      publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: "usycPosition" }),
    ]);
    if (totalNav === 0n) return 0;
    return Number((usycPos * 10000n) / totalNav);
  } catch {
    return 0;
  }
}

async function runSentinel(): Promise<void> {
  console.log(`[sentinel] running — dry_run=${DRY_RUN}`);

  const volData = await fetchVolData();
  const currentUsycBps = await getCurrentUsycBps();

  const prompt = `You are the Phronos Regime Sentinel. Assess current market conditions and return a JSON object.

Market data:
${JSON.stringify(volData, null, 2)}

Current USYC allocation: ${currentUsycBps} bps of vault NAV.

Return ONLY valid JSON matching this schema:
{
  "schemaVersion": "regime/1.0",
  "timestamp": <unix seconds>,
  "riskBand": <0-4, 0=full risk-on, 4=full risk-off>,
  "usycTargetBps": <0-10000>,
  "rationale": <max 400 chars>,
  "signalsConsidered": { <key>: <numeric value> }
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 512,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let regime: Regime;
  try {
    regime = RegimeSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error("[sentinel] invalid output:", raw, err);
    return;
  }

  console.log(`[sentinel] riskBand=${regime.riskBand} usycTarget=${regime.usycTargetBps} bps`);

  const json = JSON.stringify(regime);

  if (DRY_RUN) {
    console.log("[sentinel] DRY_RUN — skipping IPFS pin and chain write");
    return;
  }

  const { cid, traceHash } = await pinJson(json);

  await db().insert(regimes).values({
    traceHash,
    ipfsCid: cid,
    riskBand: regime.riskBand,
    usycTargetBps: regime.usycTargetBps,
    rationale: regime.rationale,
  });

  // Flip capital if target differs by ≥500 bps from current
  const diff = regime.usycTargetBps - currentUsycBps;
  if (Math.abs(diff) < USYC_FLIP_THRESHOLD_BPS) {
    console.log("[sentinel] diff below threshold — no flip needed");
    return;
  }

  const pk = process.env.SENTINEL_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) { console.warn("[sentinel] SENTINEL_PRIVATE_KEY not set — skipping tx"); return; }

  const walletClient = getWalletClient(pk);
  const publicClient = getPublicClient();
  const { vault } = getDeployedAddresses();

  const totalNav = await publicClient.readContract({
    address: vault, abi: VAULT_ABI, functionName: "nav",
  });

  if (diff > 0) {
    // Need to buy more USYC — check if USYC allowlist landed
    if (!process.env.USYC_ALLOWLIST_GRANTED) {
      console.warn("[sentinel] USYC allowlist not yet confirmed — skipping flipToUSYC");
      console.warn(`[sentinel] INTENDED: flipToUSYC ${(BigInt(diff) * totalNav) / 10000n} USDC`);
      return;
    }
    const usdcToFlip = (BigInt(diff) * totalNav) / 10000n;
    const hash = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: "flipToUSYC",
      args: [usdcToFlip, traceHash, cid],
    });
    console.log(`[sentinel] flipToUSYC tx: ${hash}`);
    await db().update(regimes).set({ txHash: hash }).where(eq(regimes.traceHash, traceHash));
  } else {
    // Redeem USYC back to USDC
    const usycPos = await publicClient.readContract({
      address: vault, abi: VAULT_ABI, functionName: "usycPosition",
    });
    const usycToRedeem = (BigInt(-diff) * usycPos) / BigInt(currentUsycBps || 1);
    const hash = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: "redeemFromUSYC",
      args: [usycToRedeem, traceHash, cid],
    });
    console.log(`[sentinel] redeemFromUSYC tx: ${hash}`);
    await db().update(regimes).set({ txHash: hash }).where(eq(regimes.traceHash, traceHash));
  }
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await runSentinel();
    } catch (err) {
      console.error("[sentinel] run failed:", err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
