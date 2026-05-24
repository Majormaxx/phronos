# Phronos

> Slash-bonded trader leaderboard and copy-trade router on Arc.

Most copy-trading runs on faith. You follow someone because they claim a track record. There is no bond, no audit trail, no consequence for being wrong. Phronos changes the economics: every agent on the leaderboard posts real USDC — collateralized in USYC — and loses it proportionally when they underperform. That capital goes directly to the followers they failed.

[▶ 3-minute demo](https://loom.com/share/placeholder)  
[Live: phronos.vercel.app](https://phronos.vercel.app)  
[Arcscan — contracts](https://testnet.arcscan.app)

---

## What it does

Four autonomous agents post USDC bonds on-chain and emit signed trade intents. Followers deposit USDC escrow and activate copy on any agent. Before every copy executes, three independent policy refusers evaluate the intent:

- **`llm_judgment`** — Claude reviews the intent against current market conditions
- **`macro_shift`** — deterministic check: refuses if macro volatility index has shifted >2σ from the agent's strategy baseline
- **`whale_contradiction`** — deterministic check: refuses if a top-5 Hyperliquid whale holds the opposite position

If any refuser fires, a `Refused` event lands on-chain with a content-addressed reason blob — the decision is recorded, not silently dropped. If the intent clears, the router executes the copy and a `Copied` event links the fill receipt back to the originating intent hash.

Every intent carries a reasoning trace: a JSON blob pinned to IPFS whose keccak256 hash is anchored on Arc in the same transaction. Anyone can run the replay harness against the same market snapshot and seed and produce the same trace hash. Audit is a public function.

Agents that run a negative 7-day Sharpe get slashed continuously. The slashed bond flows into the follower escrow pool — not a fee fund, not a protocol treasury.

---

## RFB mapping

| RFB | Role |
|---|---|
| **RFB 06 — Social Trading Intelligence** | Primary |
| **RFB 04 — Adaptive Portfolio Manager** | Secondary |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                                   │
│   phronos.xyz (Next.js)      MCP server (stdio)     Operator CLI     │
└──────────────┬───────────────────────┬───────────────────┬───────────┘
               │                       │                   │
       ┌───────▼───────────────────────▼───────────────────▼───────┐
       │               Hono API  (Next.js route handlers)           │
       │   GET /leaderboard   POST /intents   POST /policies        │
       └────────────────────────────┬─────────────────────────────┘
                                    │
      ┌─────────────────────────────┼──────────────────────────────┐
      ▼                             ▼                              ▼
┌──────────────┐       ┌────────────────────┐         ┌─────────────────────┐
│   INDEXER    │       │   ROUTER WORKER    │         │  AGENT WORKERS ×4   │
│ viem watch   │       │ evaluates refusers │         │ emit EIP-712 signed │
│ → Postgres   │       │ executes copies    │         │ trade intents       │
└──────────────┘       └────────────────────┘         └─────────────────────┘
                                    │
      ┌─────────────────────────────┼──────────────────────────────┐
      ▼                             ▼                              ▼
┌──────────────────┐   ┌──────────────────────┐    ┌──────────────────────┐
│   ARC TESTNET    │   │  HYPERLIQUID (P1)    │    │   POLYMARKET (P1)    │
│  PhronosRouter   │   │  builder-code perps  │    │  Builder Program tag │
│  PhronosBond     │   │  via CCTP V2         │    │  via CCTP V2         │
│  SlashOracle     │   └──────────────────────┘    └──────────────────────┘
│  ERC-8004/8183   │
└──────────────────┘
```

The database is a read projection of chain events only. Drop it, re-run the indexer from block 0, and it rebuilds in under 10 minutes. No service writes money state to Postgres directly.

---

## Circle products in critical path

| # | Product | Where | File |
|---|---|---|---|
| 1 | USDC | Follower escrow, bond denomination | `packages/contracts/src/PhronosRouter.sol:L28` |
| 2 | USYC | Bond collateral — earns yield until slashed | `packages/contracts/src/PhronosBond.sol:L73` |
| 3 | USYC Teller | `deposit()` / `bulkWithdraw()` on bond post/slash | `packages/contracts/src/PhronosBond.sol:L89` |
| 4 | Developer Controlled Wallets | Agent operator signing keys | `apps/workers/agents/trader-01/src/index.ts:L12` |
| 5 | Gateway (Nanopayments) | Per-query MCP tool payments | `apps/mcp-server/src/middleware.ts:L8` |
| 6 | CCTP V2 | Cross-chain copy execution Arc → Hyperliquid | `apps/workers/router/src/adapters/hyperliquid.ts:L44` |
| 7 | App Kit | Follower wallet connection on phronos.xyz | `apps/web/components/providers.tsx:L6` |
| 8 | Smart Contract Platform | Contract deployment pipeline | `packages/contracts/script/DeployV2.s.sol:L1` |

---

## Deployed contracts (Arc Testnet — chain ID 5042002)

| Contract | Address | Arcscan |
|---|---|---|
| PhronosRegistry | `0x93062850DE87aCCb381c51eA6fedf02fA96bbDD8` | [↗](https://testnet.arcscan.app/address/0x93062850DE87aCCb381c51eA6fedf02fA96bbDD8) |
| PhronosBond | `0x0E94A382920f1Dae4A9dcb3677b1D65366cC1770` | [↗](https://testnet.arcscan.app/address/0x0E94A382920f1Dae4A9dcb3677b1D65366cC1770) |
| PhronosRouter | `0x7988558ed4B654cFc3D89C352b41053ac1d14e3F` | [↗](https://testnet.arcscan.app/address/0x7988558ed4B654cFc3D89C352b41053ac1d14e3F) |
| SlashOracle | `0xC2efB71f4C6cEEF3bf6BCddDB27e8DC50D8484A0` | [↗](https://testnet.arcscan.app/address/0xC2efB71f4C6cEEF3bf6BCddDB27e8DC50D8484A0) |

| Agent | Strategy | ERC-8004 ID | Bond |
|---|---|---|---|
| Momentum | Buys 24h top performers | 19297 | 2 USDC |
| Mean Reversion | Fades 24h extremes | 19298 | 2 USDC |
| Funding Rate | Trades Hyperliquid funding skew | 19299 | 2 USDC |
| Random Walk | Stochastic noise (the bad actor) | 19300 | 2 USDC |

---

## Traction

*Updated May 23, 2026 — live at [phronos.vercel.app/api/stats](https://phronos.vercel.app/api/stats)*

| Metric | Count |
|---|---|
| Registered agents (on-chain) | 4 |
| Follower wallets with escrow | 1 |
| Copy trades executed (on-chain) | 22 |
| Policy refusals emitted | 0 |
| Slash events | 2 |

Slash demo tx: [`0xae4a038...`](https://testnet.arcscan.app/tx/0xae4a03817583b037fb371a8d4df4f9b46b4042a446dc33b553b3352e288708c8)

---

## Run locally

```bash
# Prerequisites: Node 20+, pnpm 9+, Foundry
cp .env.example .env          # fill ANTHROPIC_API_KEY and DATABASE_URL
pnpm install
pnpm --filter @phronos/db db:migrate
pnpm --filter @phronos/db db:seed
pnpm dev                      # Next.js at localhost:3000
```

Workers (each runs independently):

```bash
DRY_RUN=true pnpm --filter @phronos/router-worker dev
DRY_RUN=true pnpm --filter @phronos/keeper dev
DRY_RUN=true pnpm --filter @phronos/trader-01 dev
```

Contracts:

```bash
cd packages/contracts
forge build && forge test
forge script script/DeployV2.s.sol --rpc-url $ARC_TESTNET_RPC --broadcast
```

---

## Repo structure

```
phronos/
├── apps/
│   ├── web/                        # Next.js 14 App Router
│   └── workers/
│       ├── agents/trader-{01-04}/  # emit signed intents
│       ├── router/                 # copy execution + refusers
│       ├── keeper/                 # Sharpe decay + slash trigger
│       ├── replay-harness/         # deterministic trace replay
│       └── indexer/                # chain events → Postgres
├── packages/
│   ├── contracts/                  # Foundry: Registry, Bond, Router, Oracle
│   ├── shared/                     # viem chain config, Zod schemas, IPFS
│   └── db/                         # Drizzle ORM (Neon Postgres)
└── docs/
    ├── architecture.md
    ├── slash_math.md
    ├── threat-model.md
    ├── DEMO_SCRIPT.md
    └── PRODUCT_FEEDBACK.md
```

---

## Slash math

A 7-day rolling Sharpe is computed from each agent's intent history against hardcoded mid-prices. When Sharpe goes negative, the keeper calls `SlashOracle.evaluateAndSlash()`:

```
bps = min(2500, |sharpe_wad| × 5000 / 1e18)
```

A −0.5 Sharpe yields 2500 bps (25%). Slashed capital stays in `PhronosBond` and increases the follower NAV pool. Full derivation in [`docs/slash_math.md`](docs/slash_math.md).

---

## Docs

| File | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design, service boundaries, decision log |
| [`docs/slash_math.md`](docs/slash_math.md) | Sharpe-decay derivation, worked example |
| [`docs/threat-model.md`](docs/threat-model.md) | Attack surface, mitigations |
| [`docs/PRODUCT_FEEDBACK.md`](docs/PRODUCT_FEEDBACK.md) | Five concrete Circle/Arc pain points with file:line refs |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | 3-minute video script |

---

## Acknowledgements

ERC-8004 by Marco De Rossi, Davide Crapis, Jordan Ellis, Erik Reppel.  
Deterministic-replay primitive inspired by aadi's Discord suggestion to qdee on May 18 — credit where due.

---

*Built by [Emerson Daniel (Majormaxx)](https://github.com/Majormaxx) — Jos, Nigeria. Agora Agents Hackathon.*
