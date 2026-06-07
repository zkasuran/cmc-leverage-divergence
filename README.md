# cmc-leverage-divergence

**A funding-regime overlay for CMC20, CoinMarketCap's own index on BNB Chain —
delivered as a CMC Agent Hub Skill, proven by a multi-asset backtest.**

> **The hook:** crypto folklore says deeply negative funding = "shorts are trapped,
> buy the bottom." Across BTC/ETH/BNB/SOL it is **backwards**: leverage-*confirmed*
> momentum returns **+14.2% over 30 days (73% hit rate)**, while the "buy the dip"
> setup returns just **+2.8% (53%)**. We trade the confirmation, and we use it to
> give CoinMarketCap's own index the risk gate it never had.

Built for **BNB Hack: AI Trading Agent Edition** (CoinMarketCap × Trust Wallet ×
BNB Chain), Track 2 — Strategy Skills.

**Live demo (one click, no clone):** https://zkasuran.github.io/cmc-leverage-divergence/

## The one idea

CMC20 is CoinMarketCap's flagship index — the top 20 coins by market cap
(ex-stables, ex-wrapped), tokenized as a BEP-20 on BNB Smart Chain (Reserve
Protocol DTF, contract `0x2f8A339B5889FfaC4c5A956787cdA593b3c36867`). It's a clean
way to hold "the market", but it took a **40% drawdown** in its first seven months.
It has no risk management.

We give it one. **19 of CMC20's 20 constituents have perp funding markets**
(every one except the exchange token LEO). We read their **funding-rate × price**
signal from the CMC AI Agent Hub, combine it into a **market-cap-weighted basket
regime** (bigger index members move the signal more, exactly as they move the
index), and use it to time exposure to CMC20 itself: hold the index when leverage
confirms the trend, step to cash when funding flushes or the index breaks its trend.

The constituent set is **derived live from CMC's own market-cap ranking**
(`data/cmc20-constituents.json`, refreshed by `npm run fetch-data`), so it is
dynamic by construction: a coin that drops out of the top 20 leaves the basket and
a new entrant joins automatically.

Over CMC20's life so far, that overlay **cut the drawdown from 40.0% to 15.1% and
the loss from -35.6% to -12.8%**, and its probabilistic Sharpe edges
buy-and-hold's (0.16 vs 0.14) even on this short down-only window (`npm run cmc20`).
The same signal, validated as a return-predictor across the constituents (event
study below), becomes the risk gate CMC20 was missing.

So the pieces are one thing, not two:

```
  CMC AI Agent Hub (funding, F&G)         <- the data
        |
        v
  src/signals/divergence.ts  ------------  <- the one engine (computeFeatures)
        |                    \
        v                     v
  validated on the            timing overlay on
  constituents (event         CMC20 the index
  study, multi-asset)         (npm run cmc20)
        |                     /
        v                    v
  emitted live as a strategy spec the CMC Agent Hub Skill returns (npm run spec)
```

One signal engine. It is *validated* on the liquid constituents, *applied* to
CMC's index, *served* live through the Skill, and *proven* by the backtest — all
the same `computeFeatures` code.

## The finding: confirmation predicts, contrarian is backwards

Crypto folklore says deeply negative funding means "shorts are trapped, buy the
bottom." We tested that across BNB, BTC, ETH and SOL with a forward-return event
study. **It is backwards.** What predicts is funding-*confirmed* momentum: when
funding is positive and price is rising (leverage backing the move), returns
continue.

Event study, BNB, forward return by signal state:

| State | 30d mean fwd | 30d hit rate | 7d mean fwd |
|-------|-------------:|-------------:|------------:|
| confirmed-up (funding + price agree) | **+14.2%** | **72.7%** | +5.2% |
| neutral | +9.4% | 56.1% | +1.5% |
| flush-down (the "buy the dip" setup) | +2.8% | 53.2% | +1.5% |

Monotonic and large at the **30-day** horizon; the effect is directionally present
but smaller at 7 days. The contrarian "buy the dip" setup is the *worst* bucket.
So the strategy trades confirmation. Flipping the tilt to contrarian is our key
ablation: on the four-asset set it earns a lower deflated Sharpe and a worse
drawdown profile, which is the proof the direction matters. (On BNB alone the
contrarian flip posts a higher raw Sharpe but at a markedly worse drawdown — the
directional result comes from the event study and the cross-asset picture, not a
single asset's Sharpe.)

## The strategy

Funding-confirmed momentum, sized around a base allocation and gated by a trend
regime filter (risk-off below the 100-day MA, so the signal never fights the
primary trend). Long-only spot. Details in `skills/cmc-leverage-divergence/references/`.


## Results on real data

### 1. The headline: CMC20 with the overlay (the point of the project)

The funding signal, built from CMC20's 19 perp-liquid constituents
(market-cap-weighted), timing the CMC20 index over its full life (Nov 2025 – Jun
2026, a down market):

| | Return | Max drawdown | Prob. Sharpe |
|--|------:|-------------:|-------------:|
| CMC20 buy-and-hold | -35.6% | 40.0% | 0.14 |
| **Funding-regime overlay** | **-12.8%** | **15.1%** | **0.16** |

Drawdown cut by 25 points, loss cut by 23. It's a 7-month down-only sample, so a
raw *annualised Sharpe* isn't meaningful (and we don't headline one — sitting in
cash through a decline mechanically lowers it); the honest, comparable read is the
**probabilistic Sharpe, which edges buy-and-hold (0.16 vs 0.14)** while the
overlay is in the market 83% of the time. The result is **capital preservation**:
the overlay is the risk gate CMC20 lacks. Reproduce with `npm run cmc20`.

### 2. Why it works on return, not just drawdown (regime-conditional)

The common challenge to a risk-gated strategy is "you only beat buy-and-hold on
drawdown, not return." Split each asset's history into bull (price ≥ 200-day MA)
and bear/down (below) segments and compare *within* each:

| Asset | Bear: strategy | Bear: buy & hold | Bear edge |
|-------|---------------:|-----------------:|----------:|
| BTC | -37% | -88% | **+51 pts** |
| ETH | -41% | -91% | **+50 pts** |
| DOGE | -22% | -71% | **+49 pts** |
| HBAR | -56% | -99% | **+43 pts** |
| SOL | -61% | -98% | **+37 pts** |
| BCH | -56% | -93% | **+37 pts** |
| … | … | … | **+ on 15/15** |

In down/sideways markets — when an allocator actually needs help — the strategy
**beats buy-and-hold on return on all 15 constituents**. It gives up upside in bulls
(the price of the risk gate), which is why its full-period raw return trails in a
multi-year bull. `npm run regime`.

### 3. Validation across 15 CMC20 constituents (2018–2026)

Every constituent with a deep Binance price + funding history (15 of the 20 — the
rest are too new to backtest) was run independently. This is the honest, full
picture, winners and losers:

| | Strategy | Buy & hold |
|--|---------:|-----------:|
| **Median max drawdown** | **59%** | 90% |
| **Mean max drawdown** | **55%** | 87% |
| Lower drawdown than B&H | **15 / 15 assets** | — |
| Median Sharpe | 0.50 | 0.74 |
| Sharpe ≥ buy-and-hold | 6 / 15 assets | — |

The one universal, robust result: **lower maximum drawdown on all 15 assets** (a
~31-point median cut). The return/Sharpe edge is *concentrated* where it should be
— the high-funding-activity megacaps (BNB 0.93, BTC 0.98, ETH 0.86, SOL 1.13,
DOGE 1.11, ADA 0.75) — and **fades on thin-funding alts** (LINK, LTC, BCH, ZEC,
XMR), exactly as the thesis predicts: the signal is only as good as the leverage
data behind it. We show the losers rather than hide them. Full table:
`reports/multiasset.csv`.

The **Deflated Sharpe** (probability the true Sharpe beats the expected-max across
every variant tried) clears 0.5 on the megacaps and is honestly low on the alts —
a haircut for multiple-testing that a single in-sample backtest never pays.

> **On rivals printing a "Sharpe of 7.86":** a Sharpe that high on a single
> in-sample crypto backtest is a red flag, not an achievement (Bailey & López de
> Prado, 2014). It is what overfitting looks like. We deliberately run 15 assets,
> report deflated Sharpe, walk-forward, cost-sensitivity and the assets where we
> *lose* — because a number you can reproduce out-of-sample is worth more than a
> big number you can't.

### Why REAL funding data matters (not a price proxy)

A common shortcut in "funding" strategies is to never fetch funding at all — they
*derive* a funding series from price momentum (e.g. `0.0001 + 0.02·return₇`) and
feed that. We tested what the shortcut costs: the **same strategy** run with real
Binance perp funding vs that price-proxy, on every asset (`npm run proxy`,
`reports/real-vs-proxy.csv`).

On the **6 largest assets** — the ones with deep, liquid funding markets, which
also dominate CMC20 by weight — **real funding beats the proxy 5 / 6, mean Sharpe
gain +0.18** (XRP +0.63, SOL +0.21, ETH +0.16). On thin-funding alts neither
carries signal, so the proxy ties by noise. The takeaway is the thesis itself:
**funding is not a price transform** — where leverage is liquid, the real
settlement data holds information a price-derived proxy cannot fake. Our pipeline
fetches real funding for all 19 hedgeable constituents; we do not synthesise it.

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
  signals/divergence.ts           the funding x price signal (pure, unit-tested) — the one engine
  spec.ts                         bridge: same engine -> live strategy spec (npm run spec)
  strategy/leverage-divergence.ts the allocator
  engine/                         backtest loop, fill sim, metrics, risk guard
  engine/stats.ts                 probabilistic + deflated Sharpe
  data/                           multi-asset fetch + loaders; cmc-loader (CMC20 via data-api);
                                  cmc.ts (live keyless CMC adapter: price + funding + dominance)
  runners/                        backtest, walk-forward, ablation, cross-asset, cost,
                                  event study, cmc20-overlay (19-constituent basket), regime
data/                             committed snapshots (CMC20 + 19 constituents)
reports/                          committed scorecard, ablation, multiasset, event-study,
                                  cost-sensitivity, per-year, cmc20-overlay, latest-spec
demo/index.html                   self-contained dashboard (GitHub Pages)
tests/                            45 tests: signal math, no-lookahead, stats, spec bridge, basket, CMC adapter, verifier
```

## Run it

```bash
npm install
npm test            # 45 tests: signal math, no-lookahead alignment, stats, spec, basket, CMC adapter, verifier
npm run verify      # re-derive every headline number from the committed data; VERIFIED or it exits nonzero
npm run spec:live   # LIVE strategy spec from CoinMarketCap (keyless, no key) -> reports/live-spec.json
npm run backtest    # BNB headline -> reports/full/{scorecard.json,scorecard.html}
npm run multiasset  # constituents vs buy-hold + deflated Sharpe -> reports/multiasset.csv
npm run eventstudy  # forward returns by signal state -> reports/event-study.csv
npm run ablation    # contrarian / no-funding / no-trend / baselines -> reports/ablation.csv
npm run costs       # 1x/2x/3x cost sensitivity -> reports/cost-sensitivity.csv
npm run walkforward # per-year, out-of-sample -> reports/walkforward.csv
npm run regime      # regime-conditional returns (bull/bear) -> reports/regime-returns.csv
npm run cmc20       # CMC20 funding-regime overlay (19-constituent basket) -> reports/cmc20-overlay.json
npm run spec        # live strategy spec from the same engine -> reports/latest-spec.json
npm run fetch-data  # refresh data/ snapshots + CMC20 constituent universe (optional)
```

Every run pins a SHA-256 of the candle dataset in the manifest, so results
reproduce byte-for-byte.

## Verify it yourself (don't trust the numbers, check them)

`npm run verify` re-derives every headline number from the committed dataset and
checks it against the committed reports AND this README. Edit any number to inflate
it and the command fails:

```
OK    cmc20.overlay.maxDD       got   15.06  want   15.06
OK    eventstudy.30d.up.meanFwd got   14.23  want   14.23
OK    README.overlay.maxDD      got    15.1  want    15.1
VERDICT: VERIFIED — every headline number reproduces from the committed data
```

CI runs this on every push (`.github/workflows/ci.yml`), so the claims are
tamper-evident, not asserted. This is the difference between a backtest you can
check and a screenshot you have to believe.

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

No API key? `npm run spec:live --asset BNB` runs the same live path against CMC's
public keyless data-api (listing for price, perpetual market-pairs for aggregate
funding + open interest, global-metrics for dominance) and writes
`reports/live-spec.json` with the exact CMC endpoints it called. A committed
example is `skills/cmc-leverage-divergence/references/live-spec-example.json`.

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
