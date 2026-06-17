/**
 * Router worker: watches PhronosRouter for IntentSubmitted events,
 * runs three policy refusers in series, and records Copied / Refused on chain.
 *
 * HYPERLIQUID_MODE=live  — places real IOC orders on HL testnet perp markets.
 * HYPERLIQUID_MODE=mock  — records arc-mock-swap-v0 receipt (default).
 */
import { parseAbi, keccak256, toHex, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPublicClient, getDeployedAddresses, arcTestnet } from "@phronos/shared";
import {
  hlPlaceOrder, hlMidPrice, hlAccountValue,
  HL_TESTNET_URL,
} from "@phronos/shared";
import { db, rawSql, followers, refusals, copies, eq } from "@phronos/db";
import { llmJudgment }       from "../../refusers/src/llm_judgment.js";
import { macroShift }        from "../../refusers/src/macro_shift.js";
import { whaleContradiction } from "../../refusers/src/whale_contradiction.js";

const HYPERLIQUID_MODE = process.env.HYPERLIQUID_MODE ?? "mock";   // "live" | "mock"
const DRY_RUN          = process.env.DRY_RUN !== "false";
const PK               = (process.env.ROUTER_PRIVATE_KEY ?? "") as `0x${string}`;

const ROUTER_ABI = parseAbi([
  "event IntentSubmitted(uint256 indexed erc8004Id, bytes32 indexed intentHash, uint8 venue, int256 notionalUSDC, bytes32 traceCID)",
  "function recordCopy(bytes32 intentHash, uint256 erc8004Id, address follower, int256 followerNotional, bytes32 venueReceiptHash, uint256 feeUSDC, uint8 venue) external",
  "function recordRefusal(bytes32 intentHash, uint256 erc8004Id, address follower, uint8 reason, bytes32 reasonCID) external",
]);

const AGENT_MARKET: Record<string, string> = {
  "22892": "BTC",
  "22893": "BTC",
  "22897": "ETH",
  "22900": "BTC",
};

async function getActiveFollowers(): Promise<string[]> {
  try {
    const rows = await db().select().from(followers);
    return rows.map(r => r.address);
  } catch {
    return [];
  }
}

function mockReceiptHash(
  intentHash: `0x${string}`,
  followerAddr: string,
  followerNotional: bigint,
): `0x${string}` {
  return keccak256(toHex(JSON.stringify({
    venue: "arc-mock-swap-v0", chainId: 5042002, intentHash, followerAddr,
    followerNotional: followerNotional.toString(), ts: Date.now(),
  })));
}

async function processIntent(log: {
  args: {
    erc8004Id?:   bigint;
    intentHash?:  `0x${string}`;
    venue?:       number;
    notionalUSDC?: bigint;
    traceCID?:    `0x${string}`;
  };
}): Promise<void> {
  const { erc8004Id, intentHash, venue, notionalUSDC, traceCID } = log.args;
  if (!erc8004Id || !intentHash || notionalUSDC === undefined) return;

  const activeFollowers = await getActiveFollowers();
  if (activeFollowers.length === 0) {
    console.log(`[router] intent=${intentHash.slice(0,10)} — no followers`);
    return;
  }

  const marketSymbol  = AGENT_MARKET[erc8004Id.toString()] ?? "BTC";
  const direction     = notionalUSDC >= 0n ? "LONG" : "SHORT";
  const isBuy         = notionalUSDC >= 0n;
  const marketSummary = `${direction} ${marketSymbol} notional=${notionalUSDC} venue=${venue ?? 0} agent=${erc8004Id}`;

  const intentCtx = {
    erc8004Id:    erc8004Id.toString(),
    marketId:     marketSymbol,
    notionalUSDC: notionalUSDC.toString(),
    venue:        venue ?? 0,
  };

  if (DRY_RUN) {
    console.log(`[router] DRY_RUN — intent=${intentHash.slice(0,10)} followers=${activeFollowers.length}`);
    return;
  }

  if (!PK) { console.warn("[router] ROUTER_PRIVATE_KEY not set — skipping"); return; }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(PK),
    chain:   arcTestnet,
    transport: http(),
  });
  const client = getPublicClient();
  const { router } = getDeployedAddresses();

  // ── Step 1: run all policy checks in parallel ──────────────────────────────
  const policyResults = await Promise.all(
    activeFollowers.slice(0, 20).map(async addr => {
      const [llm, macro, whale] = await Promise.all([
        llmJudgment(intentCtx, marketSummary),
        macroShift(intentCtx),
        whaleContradiction(intentCtx),
      ]);
      const refuser = [llm, macro, whale].find(r => !r.allow) ?? null;
      return { addr, refuser };
    })
  );

  const approved = policyResults.filter(r => !r.refuser).map(r => r.addr);
  const refused  = policyResults.filter(r =>  r.refuser);

  // ── Step 2: if any followers approved, place ONE HL order for total notional ─
  // follower_notional = agentNotional / 10 (per current scaling)
  const followerNotional = notionalUSDC / 10n;
  const totalNotionalUsd = Number(followerNotional) / 1_000_000 * approved.length;

  let venueReceiptHash: `0x${string}`;
  let entryPricePx:  number | null = null;
  let hlOrderIdStr:  string  | null = null;
  let fillSzBase:    number  | null = null;

  if (approved.length > 0 && HYPERLIQUID_MODE === "live") {
    try {
      const fill = await hlPlaceOrder({
        pk:           PK,
        market:       marketSymbol,
        isBuy,
        notionalUsdc: totalNotionalUsd,
      });
      entryPricePx  = fill.avgPx;
      hlOrderIdStr  = fill.orderId.toString();
      fillSzBase    = fill.totalSz;
      venueReceiptHash = keccak256(toHex(JSON.stringify({
        venue: "hl-testnet-perp", intentHash,
        orderId: fill.orderId, avgPx: fill.avgPx, totalSz: fill.totalSz,
        market: marketSymbol, isBuy,
      })));
      console.log(`[router] HL FILLED orderId=${fill.orderId} avgPx=${fill.avgPx} sz=${fill.totalSz} ${direction} ${marketSymbol}`);

      // Persist HL fill into intents row so keeper can close it later
      const nsql = rawSql();
      await nsql`
        UPDATE intents
        SET hl_order_id   = ${hlOrderIdStr},
            entry_price_px = ${entryPricePx.toString()},
            fill_sz_base   = ${fillSzBase.toString()}
        WHERE intent_hash = ${intentHash}
      `;
    } catch (err) {
      console.warn(`[router] HL order failed — using mock: ${(err as Error).message?.slice(0,200)}`);
      venueReceiptHash = mockReceiptHash(intentHash, "aggregate", followerNotional * BigInt(approved.length));
    }
  } else {
    if (approved.length > 0 && HYPERLIQUID_MODE !== "live") {
      // Fetch current mid for entry_price tracking even in mock mode
      try {
        const mid = await hlMidPrice(marketSymbol);
        entryPricePx = mid;
        const nsql = rawSql();
        await nsql`
          UPDATE intents SET entry_price_px = ${mid.toString()} WHERE intent_hash = ${intentHash}
        `;
      } catch { /* non-fatal */ }
    }
    venueReceiptHash = mockReceiptHash(intentHash, "aggregate", followerNotional * BigInt(Math.max(approved.length, 1)));
  }

  // ── Step 3: record all refusals on-chain ──────────────────────────────────
  for (const { addr, refuser } of refused) {
    console.log(`[router] REFUSED follower=${addr.slice(0,8)} reason=${refuser!.reasonCode} — ${refuser!.reason}`);
    try {
      const { request } = await client.simulateContract({
        address: router, abi: ROUTER_ABI, functionName: "recordRefusal",
        args:    [intentHash, erc8004Id, addr as `0x${string}`, refuser!.reasonCode, refuser!.reasonCID],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      await db().insert(refusals).values({
        intentHash, followerAddr: addr,
        reason: refuser!.reasonCode, reasonCid: refuser!.reasonCID, refusedAt: new Date(),
      }).onConflictDoNothing();
    } catch (e) { console.error("[router] recordRefusal:", (e as Error).message?.slice(0,100)); }
  }

  // ── Step 4: record all approved copies on-chain ───────────────────────────
  for (const addr of approved) {
    console.log(`[router] COPY follower=${addr.slice(0,8)} notional=${followerNotional} ${HYPERLIQUID_MODE === "live" ? "HL-LIVE" : "mock"}`);
    try {
      const { request } = await client.simulateContract({
        address: router, abi: ROUTER_ABI, functionName: "recordCopy",
        args:    [intentHash, erc8004Id, addr as `0x${string}`, followerNotional, venueReceiptHash, 0n, venue ?? 0],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      await db().insert(copies).values({
        intentHash, followerAddr: addr,
        followerNotional: followerNotional.toString(),
        venueReceipt: venueReceiptHash, executedAt: new Date(),
      }).onConflictDoNothing();
    } catch (e) { console.error("[router] recordCopy:", (e as Error).message?.slice(0,100)); }
  }
}

async function start(): Promise<void> {
  const { router } = getDeployedAddresses();
  if (!router) { console.error("[router] PHRONOS_ROUTER_ADDR not set"); process.exit(1); }
  if (!PK)     { console.warn("[router] ROUTER_PRIVATE_KEY not set — running read-only"); }

  // Log HL mode and account balance on startup
  if (HYPERLIQUID_MODE === "live" && PK) {
    const account = privateKeyToAccount(PK);
    try {
      const bal = await hlAccountValue(account.address);
      if (bal < 5) {
        console.warn(
          `[router] HL testnet account ${account.address} has $${bal.toFixed(2)} USDC.\n` +
          `[router] To enable live trading, go to app.hyperliquid-testnet.xyz,\n` +
          `[router] connect this wallet, and use the testnet USDC faucet (gives $10,000).\n` +
          `[router] Falling back to mock receipts until funded.`
        );
      } else {
        console.log(`[router] HL testnet account ${account.address} balance: $${bal.toFixed(2)} USDC — LIVE trading enabled`);
      }
    } catch (e) {
      console.warn(`[router] Could not check HL balance: ${(e as Error).message}`);
    }
  } else {
    console.log(`[router] HYPERLIQUID_MODE=${HYPERLIQUID_MODE} — using mock receipts`);
    console.log(`[router] To enable live HL trading: set HYPERLIQUID_MODE=live in .env and fund the router wallet on app.hyperliquid-testnet.xyz`);
  }

  const client = getPublicClient();
  console.log(`[router] watching PhronosRouter at ${router}`);

  client.watchContractEvent({
    address: router,
    abi:     ROUTER_ABI,
    eventName: "IntentSubmitted",
    onLogs: async (logs) => {
      for (const log of logs) {
        await processIntent(log).catch(err => console.error("[router] processIntent:", err));
      }
    },
  });

  await new Promise(() => {});
}

start();
