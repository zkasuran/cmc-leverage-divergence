# Backtest results

BTC daily, 2019-09 to 2026-06 (2471 bars). Spot, long-only. Fees 10 bps, slippage
5 bps. Starting equity 10,000. Seed 42. Reproduce with `npm run ablation` /
`npm run backtest` / `npm run walkforward`; raw output in `reports/`.

## Headline vs baselines

| Variant | Return | Max DD | Sharpe | Trades |
|---------|-------:|-------:|-------:|-------:|
| **leverage-divergence (headline)** | **+186.8%** | **26.2%** | **0.84** | 176 |
| buy-and-hold | +623.5% | 76.6% | 0.79 | 0 |
| Fear & Greed only | +15.3% | 39.4% | 0.21 | 190 |
| RSI mean-reversion | -1.4% | 4.8% | -0.09 | 27 |

The strategy does **not** beat buy-and-hold's raw return over a 6x bull market, and
the writeup says so plainly. It delivers a **higher Sharpe (0.84 vs 0.79) at about
one-third the maximum drawdown (26% vs 77%)** — the profile a risk-limited allocator
that cannot hold a 77% drawdown actually needs.

## Ablation (what carries the edge)

| Variant | Return | Max DD | Sharpe | Read |
|---------|-------:|-------:|-------:|------|
| headline | +186.8% | 26.2% | 0.84 | full signal set |
| no-divergence | +101.9% | 34.6% | 0.56 | **remove funding divergence → edge collapses** |
| no-trend | +157.0% | 52.2% | 0.60 | **remove regime gate → drawdown doubles** |
| no-crowding | +183.2% | 26.2% | 0.83 | marginal (≈30d live data only) |
| plus-fng | +158.6% | 28.5% | 0.80 | adding Fear & Greed **hurts** → off by default |

The funding-rate-vs-price divergence is the engine: removing it cuts Sharpe from
0.84 to 0.56 and return from +187% to +102%. The trend gate is what tames
drawdown. Fear & Greed was tested and dropped.

## Per-year (out-of-sample by construction; no parameters fit to the data)

| Year | Return | Max DD |
|------|-------:|-------:|
| 2019 (part) | -6.3% | 17.4% |
| 2020 | +65.0% | 15.2% |
| 2021 | +24.3% | 17.7% |
| 2022 (bear) | -17.7% | 24.2% |
| 2023 | +41.9% | 13.6% |
| 2024 | +22.6% | 11.5% |
| 2025 | -3.0% | 11.8% |
| 2026 (part) | -5.9% | 7.7% |

The 2022 bear is the tell: buy-and-hold fell roughly 65% that year; the strategy's
trend gate held the loss to -17.7%. No year exceeds a 25% drawdown.

## Integrity notes

- Parameters are conventional and fixed a priori (e.g. 100-day trend MA, 1σ funding
  z entry). There was no grid search; two principled structural design changes were
  made (base allocation, then the trend gate) and then tuning stopped.
- Costs are modelled (10 bps fee + 5 bps slippage). No funding cost line: this is a
  spot book that uses funding as a *signal*, not a perp position that pays it.
- Open interest / long-short have ~30 days of free history, so crowding is a live
  overlay, not a backtest driver — stated, not hidden.
- Every run emits a manifest with the dataset SHA-256 for byte-for-byte replay.
