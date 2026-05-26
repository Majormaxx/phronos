/**
 * Circle Developer Controlled Wallets helper.
 *
 * Full lifecycle:
 *  1. Create wallet set once:  createPhronosWalletSet()
 *  2. Create per-agent wallets: getAgentWallet(n)  (also registers in PhronosRegistry)
 *  3. Sign intents:             dcwSignTypedData(...)  → operatorSig
 *  4. Execute contracts:        dcwExecuteContract(...) → Circle txId
 *
 * All functions return null when CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET are unset,
 * so callers fall back to private-key signing without any code changes.
 */
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const CIRCLE_API_BASE = "https://api.circle.com";

type DCWClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let _client: DCWClient | null = null;

export function getDCWClient(): DCWClient | null {
  if (_client) return _client;
  const apiKey       = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) return null;
  _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return _client;
}

export interface DCWWallet {
  walletId: string;
  address:  `0x${string}`;
}

/**
 * Get (or lazily create) the Circle DCW wallet for trader agent N.
 *
 * Env vars:
 *   CIRCLE_WALLET_SET_ID   — must exist; create once with createPhronosWalletSet()
 *   CIRCLE_WALLET_ID_0{n}  — if set, retrieves the existing wallet; otherwise creates
 *
 * Logs the wallet ID on first creation so you can persist it in .env.
 */
export async function getAgentWallet(agentIndex: 1 | 2 | 3 | 4): Promise<DCWWallet | null> {
  const client = getDCWClient();
  if (!client) return null;

  const envKey   = `CIRCLE_WALLET_ID_0${agentIndex}`;
  const walletId = process.env[envKey];

  if (walletId) {
    try {
      const res = await client.getWallet({ id: walletId });
      const w   = (res.data as any)?.wallet;
      if (w?.address) return { walletId, address: w.address as `0x${string}` };
    } catch {
      console.warn(`[dcw] Failed to fetch wallet ${walletId} — will re-create`);
    }
  }

  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    console.warn("[dcw] CIRCLE_WALLET_SET_ID not set — cannot create agent wallet");
    return null;
  }

  try {
    // Cast needed: SDK TS types lag behind runtime — ARC-TESTNET is valid per Circle docs
    const res = await client.createWallets({
      walletSetId,
      blockchains: ["ARC-TESTNET"],
      count:        1,
      accountType: "EOA",
    } as unknown as Parameters<typeof client.createWallets>[0]);

    const w = (res.data as any)?.wallets?.[0];
    if (!w?.id || !w.address) return null;
    console.log(`[dcw] Created trader-0${agentIndex} wallet: ${w.address}`);
    console.log(`[dcw] Persist in .env: ${envKey}=${w.id}`);
    return { walletId: w.id, address: w.address as `0x${string}` };
  } catch (err) {
    console.error("[dcw] createWallets failed:", (err as Error).message);
    return null;
  }
}

/**
 * Sign EIP-712 typed data via Circle's DCW signing API.
 *
 * Uses POST /v1/w3s/developer/sign/typedData — Circle's MPC service computes the
 * secp256k1 signature over the EIP-712 hash without exposing the private key.
 * Returns the 65-byte hex signature suitable for use as operatorSig in submitIntent.
 *
 * BigInt values in `message` are automatically serialised to decimal strings as
 * required by the Circle API.
 */
export async function dcwSignTypedData(params: {
  walletId:    string;
  domain:      {
    name:              string;
    version:           string;
    chainId:           number;
    verifyingContract: `0x${string}`;
  };
  types:       Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message:     Record<string, unknown>;
}): Promise<`0x${string}` | null> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) return null;

  const { walletId, domain, types, primaryType, message } = params;

  // Serialise BigInt values as decimal strings (JSON.stringify can't handle bigint)
  const typedDataJson = JSON.stringify(
    { types, primaryType, domain, message },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );

  try {
    const res = await fetch(`${CIRCLE_API_BASE}/v1/w3s/developer/sign/typedData`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ walletId, typedData: typedDataJson }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[dcw] signTypedData HTTP ${res.status}: ${text.slice(0, 300)}`);
      return null;
    }

    const json = await res.json() as { data?: { signature?: string } };
    const sig  = json.data?.signature;
    if (!sig) {
      console.error("[dcw] signTypedData: no signature in response:", JSON.stringify(json));
      return null;
    }
    return sig as `0x${string}`;
  } catch (err) {
    console.error("[dcw] signTypedData failed:", (err as Error).message);
    return null;
  }
}

/**
 * Execute a smart-contract write through Circle's MPC signing service.
 * Returns the Circle transaction ID on success (not the on-chain hash).
 * Poll GET /v1/w3s/transactions/{id} to get the on-chain hash once confirmed.
 */
export async function dcwExecuteContract(params: {
  walletId:             string;
  contractAddress:      `0x${string}`;
  abiFunctionSignature: string;
  abiParameters:        unknown[];
}): Promise<string | null> {
  const client = getDCWClient();
  if (!client) return null;

  try {
    const res = await client.createContractExecutionTransaction({
      walletId:             params.walletId,
      contractAddress:      params.contractAddress,
      abiFunctionSignature: params.abiFunctionSignature,
      abiParameters:        params.abiParameters,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as Parameters<typeof client.createContractExecutionTransaction>[0]);

    const txId = (res.data as any)?.id ?? null;
    if (txId) console.log(`[dcw] Contract execution queued: txId=${txId}`);
    return txId;
  } catch (err) {
    console.error("[dcw] createContractExecutionTransaction failed:", (err as Error).message);
    return null;
  }
}

/**
 * One-time setup: create a wallet set for all Phronos trader agents.
 * Run once and store the returned ID as CIRCLE_WALLET_SET_ID in .env.
 */
export async function createPhronosWalletSet(): Promise<string | null> {
  const client = getDCWClient();
  if (!client) {
    console.error("[dcw] Circle credentials not set — cannot create wallet set");
    return null;
  }
  const res = await client.createWalletSet({ name: "Phronos Trader Agents" });
  const id  = (res.data as any)?.walletSet?.id;
  if (id) {
    console.log(`[dcw] Created wallet set: ${id}`);
    console.log(`[dcw] Add to .env: CIRCLE_WALLET_SET_ID=${id}`);
  }
  return id ?? null;
}
