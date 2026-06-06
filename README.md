# cmc-leverage-divergence

A CoinMarketCap Agent Skill that turns funding-rate-vs-price **divergence** into a
**backtestable** crypto strategy spec, shipped with a reproducible backtest that
proves it works.

Built for **BNB Hack: AI Trading Agent Edition** (CoinMarketCap × Trust Wallet ×
BNB Chain), Track 2 — Strategy Skills.

## The idea in one line

Funding is what the leveraged crowd pays to hold its position. When funding goes
abnormally negative while price refuses to fall, the shorts are offside
(capitulation). When funding goes abnormally positive into an extended rally, the
longs are offside (blow-off). Trade the **disagreement** between funding and price,
gate it by the primary trend, and you get a risk-managed allocator a price-only TA
bot cannot build.

This is the half of the design space the field skips: a survey of public Track-2
skills found everyone building price/RSI/MACD/MA-regime bots. None used funding,
open interest or the long/short ratio as a real signal. This does.

## What it does, on real data

BTC daily, 2019-09 → 2026-06 (2471 bars), spot, long-only, fees 10 bps + slippage 5 bps.

| Variant | Return | Max DD | Sharpe |
|---------|-------:|-------:|-------:|
| **leverage-divergence** | **+186.8%** | **26.2%** | **0.84** |
| buy-and-hold | +623.5% | 76.6% | 0.79 |
| Fear & Greed only | +15.3% | 39.4% | 0.21 |
| RSI mean-reversion | -1.4% | 4.8% | -0.09 |

It does **not** beat buy-and-hold's raw return over one of the biggest bull markets
on record, and we say so. It delivers a **higher Sharpe at a third of the
drawdown** (26% vs 77%) — the profile a desk that cannot sit through a 77% drawdown
actually needs. In the 2022 bear the trend gate held the loss to -17.7% while
buy-and-hold fell ~65%.

### The ablation is the proof

| Remove… | Sharpe | Return | Effect |
|---------|-------:|-------:|--------|
| nothing (headline) | 0.84 | +186.8% | — |
| the funding divergence | 0.56 | +101.9% | **the edge collapses** |
| the trend gate | 0.60 | +157.0% | **drawdown doubles to 52%** |
| Fear & Greed (i.e. add it) | 0.80 | +158.6% | it *hurts*, so it's off by default |

The funding-divergence signal carries the edge. We let the data fire Fear & Greed.

## What's in here

```
skills/cmc-leverage-divergence/   the Agent Skill (the Track-2 deliverable)
  SKILL.md                        frontmatter + the workflow that emits the spec
  references/                     signal math, data sources, spec schema, results
src/                              the reproducible backtester (TypeScript)
  signals/divergence.ts           the signal (pure, unit-tested)
  strategy/leverage-divergence.ts the allocator
  engine/                         backtest loop, fill sim, metrics, risk guard
  data/                           fetch + offline loaders (as-of alignment)
  runners/ cli.ts                 backtest / ablation / walk-forward
data/                             committed historical snapshots (reproducible)
reports/                          committed scorecard, ablation, per-year, tearsheet
tests/                            signal math + no-lookahead alignment
```

The backtest engine is adapted from a harness I built earlier; the one change to
carry exogenous signals (funding/F&G/OI) through the bar context with no lookahead
is documented in `src/types.ts` and `src/engine/backtest.ts`.

## Run it

```bash
npm install
npm test            # 14 tests: signal math + no-lookahead alignment
npm run fetch-data  # refresh data/ snapshots (optional; snapshots are committed)
npm run backtest    # headline run -> reports/full/{scorecard.json,scorecard.html,...}
npm run ablation    # full table -> reports/ablation.csv
npm run walkforward # per-year, out-of-sample -> reports/walkforward.csv
```

Every run pins a SHA-256 of the candle dataset in the manifest, so results
reproduce byte-for-byte.

## Using the Skill

Copy `skills/cmc-leverage-divergence/` into your agent's skills directory and
connect the CMC MCP server:

```json
{ "mcpServers": { "cmc-mcp": {
  "url": "https://mcp.coinmarketcap.com/mcp",
  "headers": { "X-CMC-MCP-API-KEY": "your-api-key" }
} } }
```

The Skill reads the live derivatives + sentiment surface and returns a strategy
spec (allocation + rules + the signal readings that justify it). Schema in
`references/strategy-spec-schema.md`.

## Honest limitations

- CMC MCP serves the latest snapshot, so the Skill reads CMC live while the backtest
  uses documented historical feeds (Binance klines + funding, Alternative.me Fear &
  Greed).
- Open interest and the long/short ratio have ~30 days of free history, so the
  crowding overlay is a live signal, not a multi-year backtest driver.
- One asset (BTC), daily, long-only spot. Funding is used as a signal, not a perp
  position, so no funding-cost line applies.
- Parameters are conventional and fixed a priori; no grid search.

## AI use

BNB Hack encourages AI tooling and requires no disclosure. For transparency anyway:
this was built with help from Claude (Anthropic), which drafted the engine
adaptation, the signal module and the docs. Every number here is from the committed
backtest, reproducible with the commands above; the design choices, the decision to
drop Fear & Greed after the ablation, and the honesty about not beating buy-and-hold
are deliberate and reviewed.

## License

MIT.
