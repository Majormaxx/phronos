# Threat model — Phronos v2

Security analysis of the slash-bonded leaderboard and copy-trade router.
Covers the on-chain contracts, off-chain workers, and the API surface.

---

## Trust boundaries

```
[Agent workers] -- EIP-712 signed intent --> [PhronosRouter on-chain]
[Follower wallet] -- escrow deposit -------> [PhronosRouter on-chain]
[Keeper worker] -- setSharpe ------------> [SlashOracle on-chain]
[Keeper worker] -- evaluateAndSlash ------> [SlashOracle → PhronosBond]
[Indexer worker] -- read-only getLogs ----> [Arc Testnet RPC]
[Web API] -- read DB ----------------------> [Postgres (projection only)]
[Web API] -- read chain ------------------> [Arc Testnet RPC]
```

The chain is the source of truth for all money state. The DB is a derived
projection of chain events and can be rebuilt from scratch by replaying logs.

---

## Threat catalogue

### T1 — Keeper key compromise (HIGH)

**Asset at risk:** `KEEPER_ROLE` on SlashOracle. Attacker can call `setSharpe` to set any
agent's Sharpe to `type(int256).min` and then call `evaluateAndSlash` to drain the full
`MAX_SLASH_PER_EVAL_BPS = 2500 bps` every 6 hours.

**Mitigations in place:**
- `KEEPER_ROLE` is separate from `DEFAULT_ADMIN_ROLE` — compromise of the keeper key does not grant contract ownership.
- SlashOracle is `Pausable` — admin can pause in response to anomalous slash activity.
- Per-evaluation cap of 25% limits the blast radius per cycle; draining a full bond requires 4+ successful evaluations over 24+ hours.

**Residual risk:** The keeper private key is stored in `.env`. In production this should be a Circle Developer Controlled Wallet with HSM-backed key material, not a raw `.env` secret.

---

### T2 — Intent replay attack (MEDIUM)

**Asset at risk:** `IntentSubmitted` events could be replayed if the nonce or deadline
is not enforced, allowing an attacker to re-execute old intents and trigger stale copy trades.

**Mitigations in place:**
- `PhronosRouter.submitIntent` enforces `intent.deadline` — intents expire at the block timestamp.
- EIP-712 domain includes `chainId: 5042002` and `verifyingContract` — cross-chain and cross-contract replays are impossible.
- `intentHash` is stored in the `intents` mapping; the same hash cannot be submitted twice (reverts with `IntentAlreadySubmitted`).

**Residual risk:** Clock skew between agent worker and chain timestamp. Agents set `deadline = now + 5 minutes`; if the block is mined significantly later, the intent may be rejected. Mitigation: agents fetch current block timestamp before constructing intent.

---

### T3 — Sybil bond manipulation (MEDIUM)

**Asset at risk:** Leaderboard Sharpe ranking. An attacker registers many agents, posts minimal bonds, and fabricates good Sharpe data by submitting coordinated long/short intents that offset each other.

**Mitigations in place:**
- `PhronosRegistry.register` requires a minimum bond (`MIN_BOND_USDC`) to be posted via `PhronosBond.postBond` before an agent appears on the leaderboard.
- The keeper computes Sharpe from *on-chain* `IntentSubmitted` events, not from self-reported data.
- The slasher can slash any agent independently of the keeper via direct `evaluateAndSlash` calls.

**Residual risk:** For the hackathon the minimum bond is 2 USDC — low enough that Sybil attacks are economically feasible. In production the bond floor should be calibrated to real follower TVL.

---

### T4 — Keeper Sharpe manipulation (MEDIUM)

**Asset at risk:** Agents could be unfairly slashed if the keeper is compromised
or its price data feed is manipulated.

**Mitigations in place:**
- The keeper uses public market data (Pyth price feed stubs for the hackathon). Real Pyth integration will use signed price attestations.
- The `KEEPER_ROLE` holder can be rotated by `DEFAULT_ADMIN_ROLE` without redeploying.
- `SlashEvaluated` event includes `sharpeAtEval` — any evaluation with an implausible Sharpe value is visible on-chain and can be challenged.

**Residual risk:** Keeper Sharpe computation uses `Math.random()` seeded from `marketId` as a price stub (`apps/workers/keeper/src/index.ts`). This must be replaced with real Pyth attestations before mainnet.

---

### T5 — Refuser bypass (LOW)

**Asset at risk:** Follower funds. A malicious router operator skips refusers and executes all copies regardless of `llm_judgment`, `macro_shift`, or `whale_contradiction` policy.

**Mitigations in place:**
- `Refused` events are emitted on-chain when a refuser rejects an intent. Absence of expected `Refused` events for a high-volatility period is a detectable signal.
- Refusers run server-side in the router worker — they are off-chain policy gates. They are not enforced by the smart contract, which is an acknowledged limitation.

**Residual risk:** In v2 the refusers are advisory (off-chain). A future v3 could require a ZK proof of refuser evaluation or a multisig threshold before copying, but this is out of scope for the hackathon (`§26: ZK proofs — out of scope`).

---

### T6 — API route injection (LOW)

**Where:** `apps/web/app/api/*/route.ts`

**Asset at risk:** Database integrity. The API routes accept `erc8004Id` as a URL path
parameter and pass it to Drizzle ORM queries.

**Mitigations in place:**
- All route parameters are parsed as integers (`parseInt`) before use. Non-numeric values produce a 400 before touching the DB.
- Drizzle ORM uses parameterised queries — no raw string interpolation into SQL.
- The DB is read-only from the API layer; no API route writes money state to the DB directly.

---

### T7 — Vercel environment variable exfiltration (LOW)

**Asset at risk:** `OPERATOR_PRIVATE_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`

**Mitigations in place:**
- Vercel environment variables are not embedded in the client bundle — they are only available server-side.
- `NEXT_PUBLIC_*` prefix is not used for any secret. All secrets are plain env vars, accessible only in server-side route handlers.
- `.env` is `.gitignore`d; the GitHub repository contains no secrets.

---

## Out of scope (hackathon)

- Formal verification of `PhronosBond` slash arithmetic
- MEV / sandwich attacks on copy trade execution (Arc Testnet has no searchers)
- Cross-chain bridge security (CCTP V2 venues are P1, not deployed for hackathon)
- Denial-of-service on the indexer worker (no rate limiting implemented)
