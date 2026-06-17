/**
 * Hyperliquid testnet perp trading adapter.
 *
 * Signs actions using HL's EIP-712 + msgpack phantom-agent scheme.
 * All orders are IOC (fill-or-cancel) at an aggressively-priced limit
 * so they act as market orders without incurring the 0.1% market-order fee.
 */
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { keccak256, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

export const HL_TESTNET_URL = "https://api.hyperliquid-testnet.xyz";
export const HL_IS_TESTNET  = true;

// Market → asset index on HL testnet
const ASSET_INDEX: Record<string, number> = {
  BTC: 3,
  ETH: 4,
  SOL: 0,
};

// Decimal places for size on each market
const SZ_DECIMALS: Record<string, number> = {
  BTC: 5,
  ETH: 4,
  SOL: 2,
};

export interface HLFill {
  orderId:  number;
  avgPx:    number;
  totalSz:  number;
  isBuy:    boolean;
  market:   string;
}

export interface HLPosition {
  market:     string;
  isBuy:      boolean;
  sizeBase:   number;
  entryPx:    number;
  unrealPnl:  number;
}

// ---------- internal signing ----------

function hashAction(action: unknown, nonce: number): `0x${string}` {
  const packed  = msgpackEncode(action);
  // nonce: 8 bytes big-endian + 0x00 (no vault)
  const buf     = new Uint8Array(packed.length + 9);
  buf.set(packed);
  const v = new DataView(buf.buffer, packed.length, 8);
  v.setBigUint64(0, BigInt(nonce), false);
  buf[packed.length + 8] = 0;
  return keccak256(buf);
}

async function signPhantomAgent(pk: `0x${string}`, connectionId: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  const client  = createWalletClient({ account, transport: http() });
  const sig = await client.signTypedData({
    domain: {
      name:              "Exchange",
      version:           "1",
      chainId:           1337n,                                               // always 1337
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      Agent: [
        { name: "source",       type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: {
      source:       "b",   // "b" = testnet, "a" = mainnet
      connectionId,
    },
  });
  return {
    r: `0x${sig.slice(2,  66)}` as `0x${string}`,
    s: `0x${sig.slice(66, 130)}` as `0x${string}`,
    v: parseInt(sig.slice(130, 132), 16),
  };
}

async function hlPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${HL_TESTNET_URL}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HL HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- public API ----------

/** Fetch current mid-price for a market symbol. */
export async function hlMidPrice(market: string): Promise<number> {
  const data = await hlPost("/info", { type: "allMids" }) as Record<string, string>;
  const mid = data[market];
  if (!mid) throw new Error(`HL: no mid price for ${market}`);
  return parseFloat(mid);
}

/** Fetch account margin summary for a given address. */
export async function hlAccountValue(address: `0x${string}`): Promise<number> {
  const data = await hlPost("/info", { type: "clearinghouseState", user: address }) as {
    marginSummary: { accountValue: string };
  };
  return parseFloat(data.marginSummary.accountValue);
}

/** Fetch open perpetual positions for an address. */
export async function hlPositions(address: `0x${string}`): Promise<HLPosition[]> {
  const data = await hlPost("/info", { type: "clearinghouseState", user: address }) as {
    assetPositions: Array<{
      position: {
        coin:       string;
        szi:        string;   // signed size (negative = short)
        entryPx:    string;
        unrealizedPnl: string;
      };
    }>;
  };
  return data.assetPositions
    .filter(p => parseFloat(p.position.szi) !== 0)
    .map(p => ({
      market:    p.position.coin,
      isBuy:     parseFloat(p.position.szi) > 0,
      sizeBase:  Math.abs(parseFloat(p.position.szi)),
      entryPx:   parseFloat(p.position.entryPx ?? "0"),
      unrealPnl: parseFloat(p.position.unrealizedPnl ?? "0"),
    }));
}

/**
 * Place an IOC order (market-equivalent) on HL testnet.
 * Returns fill details if filled, throws if unfilled or error.
 */
export async function hlPlaceOrder(params: {
  pk:            `0x${string}`;
  market:        string;       // "BTC" | "ETH" | "SOL"
  isBuy:         boolean;
  notionalUsdc:  number;       // in USD (not micro-USDC)
  reduceOnly?:   boolean;
  overrideSize?: number;       // base units — skips notional→size conversion
}): Promise<HLFill> {
  const { pk, market, isBuy, notionalUsdc, reduceOnly = false } = params;

  const assetIdx  = ASSET_INDEX[market];
  const szDec     = SZ_DECIMALS[market];
  if (assetIdx === undefined || szDec === undefined) {
    throw new Error(`HL: unknown market ${market}`);
  }

  const mid      = await hlMidPrice(market);
  const minSize  = Math.pow(10, -szDec);

  let size: number;
  if (params.overrideSize !== undefined) {
    size = params.overrideSize;
  } else {
    const rawSize = notionalUsdc / mid;
    size = Math.max(rawSize, minSize);
  }
  const sizeStr  = size.toFixed(szDec);

  // IOC at 5% slippage — ensures fill against any reasonable orderbook depth
  const slippage  = 0.05;
  const limitPx   = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
  const priceStr  = limitPx.toFixed(1);

  const action = {
    type:   "order",
    orders: [{
      a: assetIdx,
      b: isBuy,
      p: priceStr,
      s: sizeStr,
      r: reduceOnly,
      t: { limit: { tif: "Ioc" } },
    }],
    grouping: "na",
  };

  const nonce        = Date.now();
  const connectionId = hashAction(action, nonce);
  const signature    = await signPhantomAgent(pk, connectionId);

  const body = { action, nonce, signature, vaultAddress: null };
  const data  = await hlPost("/exchange", body) as {
    status:   string;
    response: { type: string; data: { statuses: Array<Record<string, unknown>> } };
  };

  if (data.status !== "ok") {
    throw new Error(`HL order rejected: ${JSON.stringify(data)}`);
  }

  const status = data.response?.data?.statuses?.[0];
  if (!status) throw new Error("HL: empty statuses array");

  if ("filled" in status) {
    const f = status.filled as { totalSz: string; avgPx: string; oid: number };
    return {
      orderId: f.oid,
      avgPx:   parseFloat(f.avgPx),
      totalSz: parseFloat(f.totalSz),
      isBuy,
      market,
    };
  }

  if ("resting" in status) {
    throw new Error(`HL: order resting (not filled) — market may be illiquid. oid=${(status.resting as { oid: number }).oid}`);
  }

  if ("error" in status) {
    throw new Error(`HL order error: ${status.error}`);
  }

  throw new Error(`HL: unexpected status ${JSON.stringify(status)}`);
}

/**
 * Close an open position by placing a reduce-only IOC at opposite side.
 * Returns the close fill, or null if no position existed.
 */
export async function hlClosePosition(params: {
  pk:         `0x${string}`;
  address:    `0x${string}`;
  market:     string;
  openIsBuy:  boolean;
  openSz:     number;
}): Promise<HLFill | null> {
  const { pk, address, market, openIsBuy, openSz } = params;

  // Confirm position still open before placing close order
  const positions = await hlPositions(address);
  const pos = positions.find(p => p.market === market && p.isBuy === openIsBuy);
  if (!pos) return null;

  return hlPlaceOrder({
    pk,
    market,
    isBuy:         !openIsBuy,
    notionalUsdc:  0,                 // ignored when overrideSize provided
    reduceOnly:    true,
    overrideSize:  pos.sizeBase,
  });
}
