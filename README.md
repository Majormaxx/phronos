# PHRONOS

A council of trader-agents allocates your USDC on Arc.

> *"All things that are exchanged must be somehow comparable."* — Aristotle, Nicomachean Ethics

---

## Demo

<!-- Add Loom embed link after Day 7 recording -->
[3-minute demo →](#) &nbsp;·&nbsp; [phronos.xyz](https://phronos.xyz) &nbsp;·&nbsp; [Arcscan: Vault](#)

---

## What it does

You deposit USDC and state a goal in plain English — "grow $200 over 30 days, low risk." A council of six certified strategies takes it from there. An Allocator Agent (Claude Sonnet 4.5) assigns weights across the bench every 30 minutes. A Regime Sentinel (GPT-4o-mini) watches market conditions and shifts a portion of the vault into a protected, yield-bearing position when things get choppy. Strategies that underperform have their stake redistributed to depositors.

Every decision is JSON-typed, pinned to IPFS, and anchored on Arc. Every redistribution is on-chain. Nothing happens in secret.

---

## Hackathon

**Agora Agents Hackathon** · Submission deadline: Sun May 25, 2026, 05:00 GMT+1

- **Primary:** RFB 04 — Agent-Driven On-Chain Execution
- **Secondary:** RFB 06 — Cross-Chain Capital Flows (CCTP V2)

---

## 8 Circle Products

| # | Product | Where it's used | File |
|---|---|---|---|
| 1 | USDC | Vault accounting + native gas on Arc | [lib/arc.ts](apps/web/lib/arc.ts) |
| 2 | Circle Wallets (Dev-Controlled) | SCA per user + per worker service | [lib/circle/wallets.ts](apps/web/lib/circle/wallets.ts) |
| 3 | Smart Contract Platform | Deploy + verify vault, registry, oracle | [script/Deploy.s.sol](packages/contracts/script/Deploy.s.sol) |
| 4 | CCTP V2 | Base Sepolia → Arc cross-chain rebalance | [workers/keeper](apps/workers/keeper/src/index.ts) |
| 5 | Gateway (Unified Balance) | Single USDC balance across all networks | [components/UnifiedBalance](apps/web/components/) |
| 6 | Nanopayments | Allocator pays each strategy per signal consumed | [workers/allocator](apps/workers/allocator/src/index.ts) |
| 7 | App Kit | Entire wallet UX — sign in, send, balance | [app/layout.tsx](apps/web/app/layout.tsx) |
| 8 | USYC | Risk-off yield sleeve via Teller | [workers/regime-sentinel](apps/workers/regime-sentinel/src/index.ts) |

---

## On-chain addresses (Arc Testnet)

| Contract | Address |
|---|---|
| PhronosBondVault | *(after Day 2 deploy)* |
| BenchRegistry | *(after Day 2 deploy)* |
| SlashOracle | *(after Day 2 deploy)* |
| Trader-01 (Momentum) agentId | *(after Day 2 registration)* |
| Trader-02 (Mean Revert) agentId | *(after Day 2 registration)* |
| Trader-03 (News) agentId | *(after Day 2 registration)* |
| Trader-04 (Funding) agentId | *(after Day 2 registration)* |
| Trader-05 (Random Walk) agentId | *(after Day 2 registration)* |
| Trader-06 (Copy HL) agentId | *(after Day 2 registration)* |
| Example trace anchor #1 | *(after Day 3)* |
| Example trace anchor #2 | *(after Day 3)* |
| Example trace anchor #3 | *(after Day 3)* |

---

## Architecture

```
        ┌──────────────────────────────────────────┐
        │  USER (goal + USDC deposit)               │
        │  via Circle App Kit / Wallets             │
        └──────────────────────┬───────────────────┘
                               ▼
        ┌──────────────────────────────────────────┐
        │  PhronosBondVault.sol  (Arc Testnet)      │
        │  - follower deposits (USDC)               │
        │  - strategy bonds (USDC)                  │
        │  - USYC position (via Teller)             │
        │  - weights, redistributions, traces       │
        └──────────┬───────────────┬───────────────┘
                   ▼               ▼
   ┌──────────────────────┐ ┌─────────────────────────┐
   │ ALLOCATOR AGENT      │ │ REGIME SENTINEL          │
   │ (Claude Sonnet 4.5)  │ │ (GPT-4o-mini)            │
   │ assigns weights      │ │ flips % → USYC           │
   └──────────┬───────────┘ └─────────────────────────┘
              ▼
   ┌──────────────────────────────────────────────────┐
   │  BENCH REGISTRY (ERC-8004 IdentityRegistry)      │
   │  + ReputationRegistry feedback                   │
   └──────────────────────────────────────────────────┘
              ▲
              │ signals (off-chain JSON, IPFS-pinned)
   ┌──────────────────────────────────────────────────┐
   │  6 STRATEGIES (Node bots)                        │
   │  Momentum · Mean Revert · News · Funding         │
   │  Random Walk · Copy HL                           │
   └──────────────────────────────────────────────────┘
              ▲
              │ performance score (rolling Sharpe)
   ┌──────────────────────────────────────────────────┐
   │  KEEPER SERVICE (Node, cron every 15 min)        │
   │  computes Sharpe → calls SlashOracle             │
   └──────────────────────────────────────────────────┘
```

Off-chain: Postgres (Neon), IPFS (Web3.Storage), three Node services, one Next.js app, six strategy stubs.

---

## Traction

<!-- Update daily from Day 5 onward -->

| Metric | Count |
|---|---|
| Unique depositors | — |
| Total volume (USDC) | — |
| Allocator rebalances | — |
| Redistributions | — |
| USYC flips | — |

[Twitter slash-watch thread →](#)

---

## Product feedback

Eight Circle products integrated. Five concrete pain points documented.

[PRODUCT_FEEDBACK.md →](docs/PRODUCT_FEEDBACK.md)

---

## Build instructions

### Prerequisites

- Node 20, pnpm 9
- Foundry (latest stable)
- A funded Arc Testnet wallet

### Environment

```bash
cp .env.example .env
# Fill in the values — see comments in .env.example
```

### Install and run

```bash
pnpm install
pnpm dev          # starts the Next.js app
```

### Contracts

```bash
cd packages/contracts
forge build
forge test
forge script script/Deploy.s.sol --rpc-url $ARC_TESTNET_RPC --broadcast
```

### Workers

```bash
# Each worker runs independently
pnpm --filter allocator dev
pnpm --filter regime-sentinel dev
pnpm --filter keeper dev
pnpm --filter trader-01 dev
```

---

## Repo structure

```
phronos/
├── apps/
│   ├── web/                  # Next.js 14 App Router
│   └── workers/
│       ├── allocator/        # Claude Sonnet 4.5 — weight allocation
│       ├── regime-sentinel/  # GPT-4o-mini — vol regime detection
│       ├── keeper/           # Sharpe decay + redistribution trigger
│       └── traders/          # 6 strategy stubs
├── packages/
│   ├── contracts/            # Foundry — PhronosBondVault, BenchRegistry, SlashOracle
│   ├── shared/               # Zod schemas shared across apps
│   └── db/                   # Drizzle schema (Neon Postgres)
└── docs/
    ├── architecture.md
    ├── slash_math.md
    ├── DEMO_SCRIPT.md
    └── PRODUCT_FEEDBACK.md
```

---

*Built for the Agora Agents Hackathon by [Emerson Daniel (Majormaxx)](https://github.com/Majormaxx) — Jos, Nigeria.*
