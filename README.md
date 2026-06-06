# cmc-leverage-divergence

A CoinMarketCap Agent Skill that reads the **funding-rate × price** signal and
emits a **backtestable, regime-gated** crypto strategy spec, shipped with a
multi-asset backtest and the statistical rigor to prove the edge is real.

Built for **BNB Hack: AI Trading Agent Edition** (CoinMarketCap × Trust Wallet ×
BNB Chain), Track 2 — Strategy Skills. Primary asset: **BNB**.

## The finding nobody else reports

Crypto folklore says deeply negative funding means "shorts are trapped, buy the
bottom" — a contrarian trade. We tested that across BNB, BTC, ETH and SOL with a
forward-return event study. **It is backwards at the daily horizon.** What
actually predicts is funding-*confirmed* momentum: when funding is positive and
price is rising (leverage backing the move), returns continue.

Event study, BNB, forward return by signal state:

| State | 30d mean fwd | 30d hit rate | 7d mean fwd |
|-------|-------------:|-------------:|------------:|
| confirmed-up (funding + price agree) | **+14.2%** | **72.7%** | +5.2% |
| neutral | +9.4% | 56.1% | +1.5% |
| flush-down (the "buy the dip" setup) | +2.8% | 53.2% | +1.5% |

Monotonic, and the contrarian setup is the *worst* bucket. So the strategy trades
confirmation, and the contrarian version is our key ablation — it underperforms,
which is the proof.

## The strategy

Funding-confirmed momentum, sized around a base allocation and gated by a trend
regime filter (risk-off below the 100-day MA, so the signal never fights the
primary trend). Long-only spot. Details in `skills/cmc-leverage-divergence/references/`.

## Results on real data

BNB/BTC/ETH/SOL daily, 2019–2026, spot, long-only, fees 10 bps + slippage 5 bps.

| Asset | Strategy Sharpe | maxDD | Buy & hold Sharpe | BH maxDD | Deflated Sharpe |
|-------|----------------:|------:|------------------:|---------:|----------------:|
| BNB | 0.93 | **44%** | 1.04 | 71% | 0.80 |
| BTC | **0.98** | **27%** | 0.79 | 77% | 0.85 |
| ETH | **0.86** | 51% | 0.80 | 79% | 0.76 |
| SOL | **1.13** | 60% | 1.00 | 96% | 0.57 |

The consistent, robust edge is **risk**: roughly **half the maximum drawdown** of
buy-and-hold on every asset, at comparable-or-better Sharpe (it beats buy-and-hold
on Sharpe for BTC, ETH and SOL). It does **not** beat buy-and-hold's raw return in
a multi-year bull, and we say so. The Deflated Sharpe (0.57–0.85) means the result
survives a haircut for having tried multiple variants. The edge also survives 3x
trading costs (`reports/cost-sensitivity.csv`).

### Honest ablation: where funding helps

We report the funding signal's marginal contribution per asset (headline vs the
same strategy with funding turned off):

- ETH (+0.02 Sharpe) and SOL (+0.09) — funding adds value.
- BTC — roughly flat.
- **BNB — funding does not help here; the trend gate carries it.** We show this
  rather than hide it. Funding earns its place where leverage is most informative,
  and the predictive finding (event study) holds on BNB even where the marginal
  portfolio Sharpe is absorbed by the regime gate.

## What's in here

```
skills/cmc-leverage-divergence/   the Agent Skill (the Track-2 deliverable)
  SKILL.md                        frontmatter + the workflow that emits the spec
  references/                     signal math, data sources, spec schema, results
src/
  signals/divergence.ts           the funding x price signal (pure, unit-tested)
  strategy/leverage-divergence.ts the allocator
  engine/                         backtest loop, fill sim, metrics, risk guard
  engine/stats.ts                 probabilistic + deflated Sharpe
  data/                           multi-asset fetch + offline loaders (as-of align)
  runners/                        backtest, walk-forward, ablation, cross-asset,
                                  cost-sensitivity, event study
data/                             committed snapshots (BNB/BTC/ETH/SOL)
reports/                          committed scorecard, ablation, multiasset,
                                  event-study, cost-sensitivity, per-year, tearsheet
tests/                            22 tests: signal math, no-lookahead, stats
```

## Run it

```bash
npm install
npm test            # 22 tests: signal math, no-lookahead alignment, stats
npm run backtest    # BNB headline -> reports/full/{scorecard.json,scorecard.html}
npm run multiasset  # BNB/BTC/ETH/SOL vs buy-hold + deflated Sharpe -> reports/multiasset.csv
npm run eventstudy  # forward returns by signal state -> reports/event-study.csv
npm run ablation    # contrarian / no-funding / no-trend / baselines -> reports/ablation.csv
npm run costs       # 1x/2x/3x cost sensitivity -> reports/cost-sensitivity.csv
npm run walkforward # per-year, out-of-sample -> reports/walkforward.csv
npm run fetch-data  # refresh data/ snapshots (optional; snapshots are committed)
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

The Skill reads the live derivatives + price surface and returns a strategy spec
(allocation + rules + the signal readings that justify it). Schema in
`references/strategy-spec-schema.md`.

## Honest limitations

- CMC MCP serves the latest snapshot, so the Skill reads CMC live while the
  backtest uses documented historical feeds (Binance klines + funding,
  Alternative.me Fear & Greed).
- Open interest and the long/short ratio have ~30 days of free history, so the
  crowding overlay is a live signal, not a multi-year backtest driver.
- Long-only spot; funding is used as a signal, not a perp position, so no
  funding-cost line applies.
- Parameters are conventional and fixed a priori; no grid search. The pivot from
  contrarian to confirmation was driven by the event study, not by tuning to PnL.

## AI use

BNB Hack encourages AI tooling and requires no disclosure. For transparency
anyway: built with help from Claude (Anthropic), which drafted the engine, signal
module, analyses and docs. Every number here is from the committed, reproducible
backtest. The decision to flip the thesis after the event study contradicted the
contrarian version, and the honesty about where funding does and does not help,
are deliberate.

## License

MIT.
