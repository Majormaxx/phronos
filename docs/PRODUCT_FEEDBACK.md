# Product Feedback — Phronos v2

Concrete developer pain points encountered while building on Arc Testnet and
Circle developer products during the Phronos hackathon. Each entry includes the
exact file and line where the issue surfaced and a concrete fix suggestion.

---

## 1. Arc RPC — `eth_sendRawTransaction` blocked on canteen-personalized endpoint

**Where:** `.env` line `ARC_TESTNET_RPC`, surfaced in `apps/workers/agents/trader-01/src/index.ts:57`

**What happened:** The personalized canteen RPC key (`rpc.testnet.arc-node.thecanteenapp.com/v1/swrm_...`) returns HTTP 403 on `eth_sendRawTransaction` calls even with a freshly rotated key. Read-only methods (`eth_call`, `eth_getLogs`, `eth_blockNumber`) work fine on the same endpoint. There is no documentation of this restriction. The public endpoint `https://rpc.testnet.arc.network` works for both reads and writes. Developers using the canteen key will silently fail to submit any on-chain transactions — the error (`HTTP 403`) gives no indication that the fix is switching endpoints.

**Suggested fix:** Document write-transaction support clearly in the canteen RPC key description, or remove the write restriction on personalized keys. If the restriction is intentional (rate-limiting), include a `WWW-Authenticate` or error body that explains the limitation so developers can self-diagnose.

---

## 2. Arc RPC — `eth_getLogs` capped at 10,000 blocks with no error message

**Where:** `apps/workers/keeper/src/index.ts:38`

**What happened:** The Arc Testnet RPC silently truncates `getLogs` results when the requested block range exceeds 10,000 blocks. No error is returned — the call succeeds with a partial result set. The keeper initially queried 7 days of history (~604,800 blocks) and received only the most recent 10,000 blocks without warning. This caused missed `IntentSubmitted` events and incorrect Sharpe calculations until the range was explicitly clamped.

**Suggested fix:** Return a standard EIP-1898 or JSON-RPC error (e.g., `{code: -32602, message: "block range exceeds limit of 10000"}`) rather than silently truncating. Alternatively, document the limit prominently in the Arc Testnet RPC reference page.

---

## 3. ERC-8004 Registry — `submitFeedback` ABI not published on Arcscan

**Where:** `packages/contracts/src/SlashOracle.sol:76`, `apps/workers/keeper/src/index.ts:95`

**What happened:** The ERC-8004 Reputation Registry contract is deployed at a known address on Arc Testnet but its ABI is not verified or published on Arcscan. Calling `submitFeedback` requires manually constructing the ABI from the ERC-8004 spec document. The spec uses `submitFeedback(uint256 agentId, bool positive, string reason)` but the deployed contract's selector hash doesn't match — confirmed by the keeper receiving `execution reverted: (empty reason)` on every call. The `try/catch` in `SlashOracle.evaluateAndSlash` silently swallows this, masking the failure.

**Suggested fix:** Verify the ERC-8004 registry contract on Arcscan so the ABI is canonical and discoverable. Publish the exact Solidity interface in the ERC-8004 reference docs with a note on breaking changes between testnet versions.

---

## 4. Circle Developer Controlled Wallets — wallet blocked after raw private key use

**Where:** `apps/workers/agents/trader-01/src/index.ts:12`

**What happened:** The Developer Wallets SDK is designed for server-side custody via API. For the hackathon we bypass the SDK (latency and key management overhead) and use the raw private key with viem's `privateKeyToAccount`. The wallet remains in `LIVE` status in the Circle dashboard but any SDK call to `createTransaction` for the same wallet subsequently fails with `wallet_already_externally_managed`. This is undocumented — the SDK doesn't detect that the key is in active external use and provides no warning.

**Suggested fix:** Add a wallet flag or API response field `externallyManaged: boolean` that developers can set explicitly when they intend to use the raw key outside the SDK. This prevents confusion and avoids silent API failures for teams that mix usage patterns.

---

## 5. pnpm workspace isolation — transitive dependencies missing in Vercel builds

**Where:** `apps/web/package.json`, surfaced during Vercel build for `apps/web/app/(app)/leaderboard/page.tsx:1`

**What happened:** pnpm's strict isolation means a workspace package can only import from its own `dependencies` list. `apps/web` depends on `@phronos/db` which internally uses `drizzle-orm` and `@neondatabase/serverless`, but those are not direct deps of `apps/web`. In local dev, hoisting makes them resolvable. In Vercel's isolated build (`pnpm install --frozen-lockfile`, no hoisting), both modules are missing and the build fails with `Module not found: drizzle-orm`. The fix is to add them as direct deps in `apps/web/package.json`, but this failure mode is completely invisible in local development.

**Suggested fix:** The Arc canteen's one-click Vercel integration templates should set `shamefully-hoist=true` or pre-populate direct deps for workspace packages in the generated scaffold. Alternatively, a build-time check in the template's CI should catch missing direct deps before the first Vercel deployment.
