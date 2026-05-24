# Slash math

Derivation of the bond-slash schedule used in `SlashOracle.sol`.

---

## Inputs

| Symbol | Source | Value |
|---|---|---|
| `sharpe` | keeper → `setSharpe(agentId, wad)` | 7-day rolling Sharpe, scaled 1e18 |
| `SHARPE_THRESHOLD` | `SlashOracle.sol:25` | `0` |
| `MAX_SLASH_PER_EVAL_BPS` | `SlashOracle.sol:26` | `2500` (25% of bond) |
| `EVAL_COOLDOWN` | `SlashOracle.sol:27` | `6 hours` |
| `DECAY_COEFF_BPS_PER_UNIT` | `SlashOracle.sol:28` | `5000` bps per Sharpe unit |

---

## Formula

```
evaluateAndSlash(agentId):
  if sharpe >= 0:
    write ERC-8004 positive feedback
    return 0 bps

  bps = min(MAX_SLASH_PER_EVAL_BPS, abs(sharpe_wad) * DECAY_COEFF_BPS_PER_UNIT / 1e18)
  bond.slash(agentId, bps, reasonHash)
  write ERC-8004 negative feedback
  emit SlashEvaluated(agentId, bps, sharpe)
```

Solidity implementation (`SlashOracle.sol:78-82`):

```solidity
uint256 absSharpe = uint256(-rec.value);
uint256 computed  = absSharpe * uint256(DECAY_COEFF_BPS_PER_UNIT) / uint256(SCALE);
bpsSlashed = uint16(computed > MAX_SLASH_PER_EVAL_BPS
    ? MAX_SLASH_PER_EVAL_BPS
    : computed);
```

---

## Derivation rationale

A Sharpe of exactly `-0.5` maps to exactly `2500 bps` (the cap). This means:

- **Light underperformers** (`-0.1` Sharpe) lose 5% of bond per 6-hour evaluation window
- **Heavy underperformers** (`≤ -0.5` Sharpe) lose the maximum 25% per window

The cap prevents a single catastrophic week from draining a bond entirely —
an agent at `-1.0` Sharpe takes the same 25% cut as `-0.5`. This keeps
slash rates bounded and predictable for operators posting bonds.

The 6-hour cooldown prevents the keeper from triggering multiple slash cycles
in rapid succession during flash underperformance, giving agents time to recover.

---

## Worked examples

| 7-day Rolling Sharpe | `abs(sharpe) × 5000` | Capped at 2500? | bps slashed | % of 2 USDC bond |
|---|---|---|---|---|
| +1.2 | — | — | 0 | 0% |
| 0.0 | — | — | 0 | 0% |
| −0.1 | 500 | no | 500 | 5% → $0.10 USDC |
| −0.3 | 1500 | no | 1500 | 15% → $0.30 USDC |
| −0.5 | 2500 | no | 2500 | 25% → $0.50 USDC |
| −1.0 | 5000 | **yes** | 2500 | 25% → $0.50 USDC |
| −2.0 | 10000 | **yes** | 2500 | 25% → $0.50 USDC |

**Live slash event (May 23, 2026):**
Agent 19298 (Mean Reversion) received a forced evaluation at Sharpe = `-2.0 × 1e18`.

```
abs(-2.0e18) × 5000 / 1e18 = 10000 → capped at 2500 bps
```

Result: 2500 bps of 2 USDC bond = **$0.50 USDC** slashed.
Tx: `0xae4a03817583b037fb371a8d4df4f9b46b4042a446dc33b553b3352e288708c8`

---

## Rolling Sharpe computation (Keeper)

The keeper (`apps/workers/keeper/src/index.ts`) watches `IntentSubmitted` events
from the last 9,999 blocks (~2.8 hours). For each agent it:

1. Reads on-chain `IntentSubmitted` logs and unpacks `(erc8004Id, intentHash, notionalUsdc, marketId)`
2. Treats each intent as a hypothetical 1 USDC trade in the signed direction
3. Computes mock PnL from a price oracle (`Math.random()` seeded from marketId — a stub for the hackathon)
4. Computes `sharpe = mean(dailyPnL) / std(dailyPnL)` over the window
5. Calls `setSharpe(agentId, sharpeWad)` then waits for receipt before calling `evaluateAndSlash`

The wait-for-receipt step is critical: `evaluateAndSlash` reverts with `SharpeNotSet`
if `rec.updatedAt == 0`, which happens if the `setSharpe` tx has not yet been mined.

---

## Redistribution path

When `bond.slash(agentId, bps, reasonHash)` is called (`PhronosBond.sol`):

1. Bond balance reduced by `bps / 10000 × bondAmount`
2. Slashed USDC transferred to `slashRecipient` (the PhronosRouter escrow)
3. Follower copy-holders proportionally credited from the router's escrow
4. `Slashed(agentId, bps, amount, reasonHash)` event emitted

The DB projection is updated by the indexer when it picks up the `Slashed` event.
The chain is the source of truth — the DB entry is derived, not authoritative.
