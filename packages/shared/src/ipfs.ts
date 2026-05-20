import { keccak256, toHex } from "viem";

const W3S_URL = "https://api.web3.storage/upload";

/**
 * Pins a JSON string to IPFS via web3.storage.
 * Returns { cid, traceHash } where traceHash is keccak256(json) — the on-chain anchor key.
 */
export async function pinJson(json: string): Promise<{ cid: string; traceHash: `0x${string}` }> {
  const token = process.env.WEB3_STORAGE_TOKEN;
  if (!token) throw new Error("WEB3_STORAGE_TOKEN not set");

  const res = await fetch(W3S_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: json,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IPFS pin failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { cid: string };
  const traceHash = keccak256(toHex(json));
  return { cid: data.cid, traceHash };
}

export function resolveUrl(cid: string): string {
  return `https://w3s.link/ipfs/${cid}`;
}
