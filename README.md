# Phronos

**Skin in the game. On chain.**

Copy trading is a $15B+ market built on borrowed trust. Traders post signals, followers execute, and when it goes wrong — no accountability, no recourse, no record. The trader moves on. The follower loses money. The platform earns a fee either way.

Phronos changes the economics. Every trader on the leaderboard has posted a bond. If they miss targets, they lose it — automatically, on-chain, with the proceeds going straight to followers. No intermediary. No discretion. No appeals.

[▶ 3-minute demo](https://loom.com/share/placeholder)  
[Live: phronos.xyz](https://phronos.xyz)  
[Arcscan](https://testnet.arcscan.app)

---

## What it does

Four autonomous agents each post a USDC bond on-chain before emitting their first signal. Followers deposit USDC escrow and activate copy on any agent. Every trade intent is:

- **EIP-712 signed** by the agent's operator key (Circle DCW — MPC-secured)
- **Content-addressed** — a JSON reasoning trace is pinned to IPFS; its keccak256 hash is anchored in the same on-chain transaction
- **Policy-gated** — three independent refusers run before any copy executes:
  - `llm_judgment` — Claude reviews the intent against current market conditions
  - `macro_shift` — refuses if macro volatility has shifted >2σ from the strategy baseline
  - `whale_contradiction` — refuses if a top-5 Hyperliquid whale holds the opposite position

If any refuser fires, a `Refused` event lands on-chain with a content-addressed reason. If the intent clears, `Copied` links the fill receipt to the originating intent hash.

Agents that run a negative 7-day Sharpe get slashed. The bond transfers to follower escrow — not a fee fund, not a treasury. Anyone can replay every decision against the same market snapshot and get the same result. Audit is a public function.

---

## Live on Arc Testnet (chain ID 5042002)

| Contract | Address |
|---|---|
| PhronosRegistry | [`0xfD457bD24710De9102E578c1d0F8942458EEBb63`](https://testnet.arcscan.app/address/0xfD457bD24710De9102E578c1d0F8942458EEBb63) |
| PhronosBond     | [`0x7A8467130C2f9016c1748B3A4970C869Fc101775`](https://testnet.arcscan.app/address/0x7A8467130C2f9016c1748B3A4970C869Fc101775) |
| PhronosRouter   | [`0xbFE253A7f62fa7C7FB8C1a812df94Aa987Cdb8F8`](https://testnet.arcscan.app/address/0xbFE253A7f62fa7C7FB8C1a812df94Aa987Cdb8F8) |
| SlashOracle     | [`0x29193bc86265b4417499D5cB175b5222ED80CB98`](https://testnet.arcscan.app/address/0x29193bc86265b4417499D5cB175b5222ED80CB98) |

| Agent | Strategy | ERC-8004 ID | Bond |
|---|---|---|---|
| Momentum       | Buys 24h top performers          | 22892 | 2 USDC |
| Mean Reversion | Fades the 24h extremes           | 22893 | 2 USDC |
| Funding Rate   | Trades Hyperliquid funding skew  | 22897 | 2 USDC |
| Random Walk    | Stochastic baseline              | 22900 | 2 USDC |

33+ `IntentSubmitted` · 6+ `Copied` · 4 `BondPosted` — all on-chain at submission time.

---

## Six Circle products in the critical path

| # | Product | Role |
|---|---|---|
| 1 | **USDC** | Follower escrow, bond denomination, fee settlement |
| 2 | **USYC** | Yield-bearing bond collateral — earns until slashed |
| 3 | **USYC Teller** | `postBondUsyc()` — USDC → USYC conversion on bond post |
| 4 | **Developer Controlled Wallets** | MPC-secured agent signing; falls back to local key |
| 5 | **Gateway (x402 nanopayments)** | $0.001 USDC per MCP tool call |
| 6 | **CCTP V2** | Cross-chain copy execution Arc → Sepolia/Hyperliquid |

> **Note on USYC:** Arc Testnet network whitelist and USYC Teller entitlements are separate allowlists. Our address (`0x4e36ee...`) is on the network whitelist but Teller `canCall()` returns false — bonds currently use the USDC fallback path. The `postBondUsyc()` path is fully implemented and wires automatically once entitlements are granted.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                             │
│  phronos.xyz (Next.js 15)   MCP server (stdio)   Operator CLI  │
└──────────────┬──────────────────────┬──────────────────────────┘
               │                      │
       ┌───────▼──────────────────────▼──────┐
       │        Next.js API routes            │
       │  /leaderboard  /intents  /policies   │
       └─────────────────┬───────────────────┘
                         │
      ┌──────────────────┼──────────────────────┐
      ▼                  ▼                       ▼
┌──────────┐   ┌──────────────────┐   ┌──────────────────────┐
│ INDEXER  │   │  ROUTER WORKER   │   │  AGENT WORKERS ×4    │
│ watches  │   │  refusers +      │   │  EIP-712 signed      │
│ chain →  │   │  copy execution  │   │  trade intents       │
│ Postgres │   └────────┬─────────┘   └──────────────────────┘
└──────────┘            │
                        ▼
              ┌──────────────────┐
              │   ARC TESTNET    │
              │  PhronosRouter   │
              │  PhronosBond     │
              │  SlashOracle     │
              │  ERC-8004/8183   │
              └──────────────────┘
```

The database is a read projection of chain events only. Drop it, re-run the indexer from block 0, it rebuilds. No service writes money state to Postgres directly.

---

## Run locally

```bash
# Prerequisites: Node 20+, pnpm 9+, Foundry
cp .env.example .env   # fill DATABASE_URL, ANTHROPIC_API_KEY
pnpm install
pnpm --filter @phronos/db db:push
```

Start workers (each independently):

```bash
set -a && . ./.env && set +a

# Web
pnpm --filter @phronos/web dev

# Traders
pnpm --filter @phronos/trader-01 dev
pnpm --filter @phronos/trader-02 dev
pnpm --filter @phronos/trader-03 dev
pnpm --filter @phronos/trader-04 dev

# Router + keeper
pnpm --filter @phronos/router-worker dev
pnpm --filter @phronos/keeper dev
```

Contracts:

```bash
cd packages/contracts
forge build && forge test -vv
forge script script/DeployV2.s.sol \
  --rpc-url $ARC_TESTNET_RPC \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast -vvv
```

> Foundry `forge script --broadcast` fails on new contract addresses due to the Arc USDC `isBlocklisted` precompile returning `StackUnderflow` during simulation. Use `cast send` for post-deploy registration steps — it bypasses simulation and works fine on-chain.

---

## Repo structure

```
phronos/
├── apps/
│   ├── web/                        # Next.js 15 App Router — leaderboard, follower, operator
│   └── workers/
│       ├── agents/trader-{01-04}/  # emit EIP-712 signed intents every 20 min
│       ├── router/                 # policy refusers + copy execution
│       ├── keeper/                 # Sharpe decay + slash trigger
│       ├── replay-harness/         # deterministic trace replay
│       └── indexer/                # chain events → Postgres
├── packages/
│   ├── contracts/                  # Foundry: Registry, Bond, Router, Oracle
│   ├── shared/                     # viem chain, Arc addresses, DCW, IPFS, schemas
│   └── db/                         # Drizzle ORM (Neon Postgres)
```

---

## Slash math

7-day rolling Sharpe from each agent's intent history. When it goes negative, the keeper calls `SlashOracle.evaluateAndSlash()`:

```
bps = min(2500, |sharpe_wad| × 5000 / 1e18)
```

A −0.5 Sharpe yields 25% of bond slashed. Capital stays in `PhronosBond` and increases the follower NAV pool.

---

## RFB mapping

| RFB | Role |
|---|---|
| RFB 06 — Social Trading Intelligence | Primary |
| RFB 04 — Adaptive Portfolio Manager  | Secondary |

---

*Built by [Emerson Daniel (Majormaxx)](https://github.com/Majormaxx) — Jos, Nigeria. Agora Agents Hackathon, May 2026.*
