import { keccak256, toHex } from "viem";

const PINATA_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const GATEWAY    = "https://gateway.pinata.cloud/ipfs";

/**
 * Pins a JSON string to IPFS via Pinata.
 * Returns { cid, traceHash } where:
 *   cid        = IPFS CIDv1 (bafkrei...) for off-chain retrieval
 *   traceHash  = keccak256(json) — the bytes32 anchored on-chain as traceCID
 *
 * If PINATA_JWT is not set, skips pinning and returns only the keccak256 hash
 * so agents can still function without IPFS configured.
 */
export async function pinJson(json: string): Promise<{ cid: string | null; traceHash: `0x${string}` }> {
  const traceHash = keccak256(toHex(json));
  const token = process.env.PINATA_JWT;
  if (!token) {
    console.warn("[ipfs] PINATA_JWT not set — skipping IPFS pin, using keccak256 only");
    return { cid: null, traceHash };
  }

  const res = await fetch(PINATA_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      pinataContent:  JSON.parse(json),
      pinataMetadata: { name: `phronos-trace-${Date.now()}` },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IPFS pin failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { IpfsHash: string };
  return { cid: data.IpfsHash, traceHash };
}

export function resolveUrl(cid: string): string {
  return `${GATEWAY}/${cid}`;
}
