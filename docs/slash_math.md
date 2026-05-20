# Slash math

Derivation of the redistribution schedule used in `SlashOracle.sol`.

---

## Inputs

- `sharpe` — 7-day rolling Sharpe ratio for a strategy, scaled to 1e18 in storage
- `threshold = 0` — negative Sharpe triggers a redistribution
- `maxSlashBps = 2500` — 25% of bond, maximum per evaluation
- `evalCooldown = 6 hours` — per-strategy cooldown between evaluations

## Formula

```
if sharpe >= 0:
    return 0 bps

bps = min(
    maxSlashBps,
    abs(sharpe) * 5000 / 1e18
)
```

### Worked examples

| Rolling Sharpe | bps redistributed | % of bond |
|---|---|---|
| +0.5 | 0 | 0% |
| 0.0 | 0 | 0% |
| -0.1 | 500 | 5% |
| -0.5 | 2500 | 25% (capped) |
| -1.0 | 2500 | 25% (capped) |

The cap at 25% prevents a single bad week from wiping a strategy's bond entirely. The linear scaling between 0 and -0.5 Sharpe gives the oracle proportional teeth without being catastrophic.

## Rolling Sharpe computation (Keeper)

The Keeper treats each signal emitted by a strategy as a hypothetical 1 USDC trade in the signaled direction against the Pyth mid-price feed at signal time. PnL is tracked over a 7-day rolling window. Sharpe = mean(daily PnL) / std(daily PnL), annualized.

The Keeper writes the result to `SlashOracle.setSharpe(agentId, sharpeWad)` every 15 minutes.
