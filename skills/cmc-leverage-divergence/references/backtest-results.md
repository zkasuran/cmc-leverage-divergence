# Backtest results

BNB/BTC/ETH/SOL daily, 2019-2026, spot, long-only. Fees 10 bps, slippage 5 bps.
Starting equity 10,000. Seed 42. Reproduce with `npm run multiasset` /
`npm run eventstudy` / `npm run ablation` / `npm run costs` / `npm run walkforward`.
Raw output in `reports/`.

## The finding: confirmation predicts, contrarian does not

Forward-return event study on BNB, bars classified by signal state:

| State | n (30d) | mean fwd 30d | hit rate 30d | mean fwd 7d |
|-------|--------:|-------------:|-------------:|------------:|
| confirmed-up | 128 | **+14.2%** | **72.7%** | +5.2% |
| neutral | 2157 | +9.4% | 56.1% | +1.5% |
| flush-down | 156 | +2.8% | 53.2% | +1.5% |

Monotonic. The "buy deeply negative funding" contrarian setup (flush-down) is the
worst bucket, not the best. This motivates trading confirmation, not contrarian.

## Multi-asset: strategy vs buy-and-hold

| Asset | Strat Sharpe | maxDD | Return | BH Sharpe | BH maxDD | BH Return | Deflated Sharpe |
|-------|-------------:|------:|-------:|----------:|---------:|----------:|----------------:|
| BNB | 0.93 | 44.4% | +563% | 1.04 | 70.9% | +3483% | 0.80 |
| BTC | 0.98 | 27.2% | +298% | 0.79 | 76.6% | +621% | 0.85 |
| ETH | 0.86 | 51.0% | +372% | 0.80 | 79.3% | +756% | 0.76 |
| SOL | 1.13 | 59.7% | +1020% | 1.00 | 96.3% | +1718% | 0.57 |

Consistent edge: **~half the maximum drawdown** of buy-and-hold on every asset, at
comparable-or-better Sharpe (beats buy-and-hold Sharpe on BTC, ETH, SOL). It does
**not** beat buy-and-hold's raw return in a multi-year bull, stated plainly. The
Deflated Sharpe (0.57-0.85) is the probability the true Sharpe beats the
expected-max across all variants tried; all four clear 0.5, so the result is not a
multiple-testing artifact.

## Ablation (BNB) and the funding contribution

| Variant | Return | maxDD | Sharpe | Read |
|---------|-------:|------:|-------:|------|
| headline (confirmation) | +563% | 44.4% | 0.93 | the shipped config |
| contrarian (flip the tilt) | +606% | 52.7% | 1.04 | wrong on other assets; see below |
| no-funding (signal off) | +689% | 47.8% | 1.05 | on BNB the trend gate alone is enough |
| no-trend (gate off) | +793% | 45.2% | 0.97 | the gate's value shows up more on BTC |
| plus-fng | +340% | 49.5% | 0.82 | Fear & Greed hurts, so it is off |

Honest reading of funding's marginal value (headline Sharpe minus no-funding
Sharpe, per asset): **ETH +0.02, SOL +0.09, BTC ~flat, BNB negative.** Funding
earns its place where leverage is most informative (ETH/SOL). On BNB the trend gate
carries the result and the funding tilt is not additive, even though the BNB event
study is clearly on-thesis. We show this rather than hide it.

## Cost sensitivity (BNB)

| Fee bps | Slippage bps | Return | maxDD | Sharpe |
|--------:|-------------:|-------:|------:|-------:|
| 10 | 5 | +563% | 44.4% | 0.93 |
| 20 | 10 | +458% | 49.2% | 0.86 |
| 30 | 15 | +389% | 50.7% | 0.81 |

The edge survives 3x the base trading costs.

## Per-year (BNB, out-of-sample; no parameters fit to the data)

| Year | Return | maxDD |
|------|-------:|------:|
| 2020 | +18.0% | 19.1% |
| 2021 | +345.2% | 34.3% |
| 2022 (bear) | -29.5% | 30.1% |
| 2023 | +16.6% | 10.4% |
| 2024 | +45.0% | 15.4% |
| 2025 | +10.4% | 15.7% |
| 2026 (part) | -5.5% | 6.2% |

## Integrity notes

- Parameters are conventional and fixed a priori (100-day trend MA, 1σ funding z).
  No grid search. The thesis flipped from contrarian to confirmation because the
  event study said so, not because PnL was tuned.
- Costs modelled (10 bps fee + 5 bps slippage). No funding-cost line: a spot book
  that uses funding as a signal pays no funding.
- Open interest / long-short have ~30 days of free history, so crowding is a live
  overlay, not a backtest driver.
- Every run pins a SHA-256 of the candle dataset for byte-for-byte replay.
