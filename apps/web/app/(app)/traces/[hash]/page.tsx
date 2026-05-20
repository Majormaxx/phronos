import Link from "next/link";
import { keccak256, toHex } from "viem";

async function resolveTrace(hash: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${base}/api/trace/${hash}`, { next: { revalidate: 300 } });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function TracePage({ params }: { params: { hash: string } }) {
  const { hash } = params;
  const trace = await resolveTrace(hash) as {
    cid: string;
    kind: string;
    content: Record<string, unknown>;
    verified: boolean;
  } | null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/dashboard" className="text-sm text-ink/40 hover:text-ink/70 mb-6 inline-block">
        ← Dashboard
      </Link>

      <h1 className="font-display text-4xl mb-2">Decision record</h1>
      <p className="font-mono text-xs text-ink/30 mb-8 break-all">{hash}</p>

      {!trace && (
        <div className="card text-center py-12">
          <p className="text-ink/40">Trace not found or still indexing.</p>
          <p className="text-xs text-ink/30 mt-2">IPFS pins can take a few minutes to propagate.</p>
        </div>
      )}

      {trace && (
        <>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-xs font-mono px-2 py-1 bg-ink/5 text-ink/60 uppercase">
              {trace.kind}
            </span>
            {trace.verified ? (
              <span className="text-xs text-olive flex items-center gap-1">
                ✓ Hash verified on-chain
              </span>
            ) : (
              <span className="text-xs text-terracotta">Hash mismatch — verify manually</span>
            )}
          </div>

          <div className="mb-6">
            <a
              href={`https://w3s.link/ipfs/${trace.cid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-terracotta hover:underline font-mono"
            >
              {trace.cid} ↗
            </a>
          </div>

          <pre className="bg-ink/5 p-5 overflow-x-auto text-xs font-mono leading-relaxed text-ink/70 whitespace-pre-wrap">
            {JSON.stringify(trace.content, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
