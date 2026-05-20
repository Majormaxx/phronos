# Architecture decisions

Running log of non-trivial decisions and the reasoning behind them. Updated whenever a meaningful tradeoff is made.

---

## Verified addresses — Arc Testnet (chain ID 5042002)

Verified on Day 1 against docs.arc.network.

| Contract / Asset | Address |
|---|---|
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| USYC Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| USYC Entitlements | `0xcc205224862c7641930c87679e98999d23c26113` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| CCTP V2 TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Arc Testnet CCTP domain | `26` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |

---

## Decisions

### Day 1

- **Monorepo with pnpm workspaces** — one repo for contracts, workers, web, and shared types. Reduces cross-package type drift. All imports go through `packages/shared`.
- **Hono on Next.js route handlers** — avoids running a separate API server during the hackathon window. Vercel handles the routing.
- **All addresses imported from `lib/arc.ts`** — never inline an address in application code. Single source of truth, easy to verify against this document.
