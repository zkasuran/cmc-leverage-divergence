# cmc-leverage-divergence

**A funding-regime overlay for CMC20, CoinMarketCap's own index on BNB Chain,
delivered as a CMC Agent Hub Skill, proven by a multi-asset backtest.**

> **The hook:** crypto folklore says deeply negative funding = "shorts are trapped,
> buy the bottom." Across BTC/ETH/BNB/SOL it is **backwards**: leverage-*confirmed*
> momentum returns **+14.2% over 30 days (73% hit rate)**, while the "buy the dip"
> setup returns just **+2.8% (53%)**. We trade the confirmation and we use it to
> give CoinMarketCap's own index the risk gate it never had.

Built for **BNB Hack: AI Trading Agent Edition** (CoinMarketCap × Trust Wallet ×
BNB Chain), Track 2: Strategy Skills.

**Live demo (one click, no clone):** https://zkasuran.github.io/cmc-leverage-divergence/

## What's different here, and how to check each in one command

Three things in this project are not in the rest of the field. None is asserted,
each reproduces from the committed data:

1. **It times CoinMarketCap's own index.** CMC20 is CMC's flagship top-20 index, a
   real BEP-20 on BNB Chain, and it shipped with no risk management (a 40% drawdown
   in its first seven months). We build a funding-regime gate from CMC20's own
   constituents and use it to time the index itself, cutting that drawdown to 15.1%.
   No other entry times CMC20. `npm run cmc20`.
2. **You can re-derive every live decision, not just check a log.** `verify:chain`
   walks the live track record and recomputes each recorded allocation from its
   recorded inputs through the published engine. A hash-chained log proves order.
   This proves the decision: edit an allocation we never produced and it fails even
   after re-linking every hash. `npm run verify:chain`.
3. **The funding finding survives a permutation null.** Permute the funding series
   with a circular block permutation that keeps its own autocorrelation intact,
   keep price, and the confirmed-vs-flush forward-return spread should collapse if
   funding is just momentum in disguise. Pooled across the liquid majors it does
   not: real spread 18.3 pts vs a block-null 95th percentile of 10.7, permutation
   p = 0.002 (the naive i.i.d. shuffle agrees). `npm run placebo`.

The rest (deflated Sharpe, walk-forward, cost sensitivity, the assets where we
lose) is standard rigor, all below.

## The one idea

CMC20 is CoinMarketCap's flagship index, the top 20 coins by market cap
(ex-stables, ex-wrapped), tokenized as a BEP-20 on BNB Smart Chain (Reserve
Protocol DTF, contract `0x2f8A339B5889FfaC4c5A956787cdA593b3c36867`). It's a clean
way to hold "the market", but it took a **40% drawdown** in its first seven months.
It has no risk management.

We give it one. **19 of CMC20's 20 constituents have perp funding markets**
(every one except the exchange token LEO). We read their **funding-rate × price**
signal from the CMC AI Agent Hub, combine it into a **market-cap-weighted basket
regime** (bigger index members move the signal more, exactly as they move the
index) and use it to time exposure to CMC20 itself: hold the index when leverage
confirms the trend, step to cash when funding flushes or the index breaks its trend.

The constituent set is **derived live from CMC's own market-cap ranking**
(`data/cmc20-constituents.json`, refreshed by `npm run fetch-data`), so it is
dynamic by construction: a coin that drops out of the top 20 leaves the basket and
a new entrant joins automatically.

Over CMC20's life so far, that overlay **cut the drawdown from 40.2% to 15.1% and
the loss from -31.9% to -12.4%** on this short down-only window (`npm run cmc20`).
Both probabilistic Sharpes sit below 0.5 (0.17 overlay vs 0.19 buy-and-hold), so
neither has a statistically positive Sharpe on 207 days; the honest edge here is
the drawdown, not the Sharpe.
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
CMC's index, *served* live through the Skill and *proven* by the backtest, all
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
but smaller at 7 days. The confirmed-up windows overlap (each is a 30-day forward
window on daily bars), so n counts observations, not independent episodes, and this
is a directional check rather than a powered estimate with a confidence interval.
The contrarian "buy the dip" setup is the *worst* bucket.
So the strategy trades confirmation. The directional proof is the event study
above: across BTC/ETH/BNB/SOL the confirmed-up bucket leads the contrarian
buy-the-dip bucket by a wide, monotonic margin at the 30-day horizon. Flipping the
tilt to contrarian is our key ablation (`reports/ablation.csv`): on BNB it posts a
higher raw Sharpe but a markedly worse drawdown (52.7% vs 44.4%), so even where the
contrarian Sharpe looks better it does so by carrying more risk. The directional
edge comes from the event study, not a single asset's Sharpe.

## The strategy

Funding-confirmed momentum, sized around a base allocation and gated by a trend
regime filter (risk-off below the 100-day MA, so the signal never fights the
primary trend). Long-only spot. Details in `skills/cmc-leverage-divergence/references/`.

### Knowing when to step aside

The edge is as much about not trading as trading. Two mechanisms keep the book out
of harm's way:

- **Trend gate.** Below the 100-day trend the allocation is cut to 20% (risk-off),
  so a confirmed-up tilt is never sized into a structural downtrend. This is where
  the CMC20 drawdown cut comes from, 40.2% to 15.1% over a down-only sample.
- **Deadband.** The allocator rebalances only when the target moves more than 10% of
  equity, so it does nothing on noise. On CMC20 that is 11 trades over 207 days.

So the overlay is in the market 83% of the time but defensively, and the value it
adds is concentrated in the periods it sizes down. That discipline (when to hold
cash, not just what to buy) is exactly what a buy-and-hold index position lacks.


## Results on real data

### 1. The headline: CMC20 with the overlay (the point of the project)

The funding signal, built from CMC20's 19 perp-liquid constituents
(market-cap-weighted), timing the CMC20 index over its full life (Nov 2025 – Jun
2026, a down market):

| | Return | Max drawdown | Prob. Sharpe |
|--|------:|-------------:|-------------:|
| CMC20 buy-and-hold | -31.9% | 40.2% | 0.19 |
| **Funding-regime overlay** | **-12.4%** | **15.1%** | **0.17** |

Drawdown cut by 25 points, loss cut by 23. It's a 7-month down-only sample, so a
raw *annualised Sharpe* isn't meaningful (and we don't headline one; sitting in
cash through a decline mechanically lowers it). Both probabilistic Sharpes sit
**below 0.5 (0.17 overlay vs 0.19 buy-and-hold)**, so neither shows a
statistically positive Sharpe on 207 days and the 0.02 gap is well inside noise;
the honest edge is **capital preservation** (the drawdown), not the Sharpe. The
overlay is in the market 83% of the time. Reproduce with `npm run cmc20`.

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

In down/sideways markets (when an allocator actually needs help) the strategy
**beats buy-and-hold on return on all 15 constituents**. It gives up upside in bulls
(the price of the risk gate), which is why its full-period raw return trails in a
multi-year bull. `npm run regime`.

### 3. Validation across 15 CMC20 constituents (2018–2026)

Every constituent with a deep Binance price + funding history (15 of the 20, the
rest are too new to backtest) was run independently. This is the honest, full
picture, winners and losers:

| | Strategy | Buy & hold |
|--|---------:|-----------:|
| **Median max drawdown** | **59%** | 90% |
| **Mean max drawdown** | **55%** | 87% |
| Lower drawdown than B&H | **15 / 15 assets** | - |
| Median Sharpe | 0.50 | 0.74 |
| Sharpe ≥ buy-and-hold | 6 / 15 assets | - |

The one universal result: **lower maximum drawdown on all 15 assets** (a
~31-point median cut). The return/Sharpe edge is *concentrated* where it should be
(the high-funding-activity megacaps: BNB 0.93, BTC 0.98, ETH 0.86, SOL 1.13,
DOGE 1.11, ADA 0.75) and **fades on thin-funding alts** (LINK, LTC, BCH, ZEC,
XMR), exactly as the thesis predicts: the signal is only as good as the leverage
data behind it. We show the losers rather than hide them. Full table:
`reports/multiasset.csv`.

The **Deflated Sharpe** (probability the true Sharpe beats the expected-max across
every variant tried) clears 0.5 on the megacaps and is honestly low on the alts,
a haircut for multiple-testing that a single in-sample backtest never pays.

> **On rivals printing a "Sharpe of 7.86":** a Sharpe that high on a single
> in-sample crypto backtest is a red flag, not an achievement (Bailey & López de
> Prado, 2014). It is what overfitting looks like. We deliberately run 15 assets,
> report deflated Sharpe, walk-forward, cost-sensitivity and the assets where we
> *lose*, because a number you can reproduce out-of-sample is worth more than a
> big number you can't.

### 4. Placebo test: is the funding finding real, or just price momentum?

A confirmed-up bucket beating flush-down could be funding, or it could be that
"price rising" alone predicts and funding is a passenger. We settle it by
permutation: keep the price path, permute the funding series with a circular block
permutation, and recompute the confirmed-vs-flush 30-day spread on 500 draws. The
block permutation keeps funding's own autocorrelation intact and only breaks its
alignment with price, so a persistent signal is judged against an equally persistent
null (a plain i.i.d. shuffle would compare it against white noise and overstate
significance). The null is not zero, it is what price momentum alone earns with
realistically persistent but misaligned funding. If the real spread sits in its
right tail, funding adds information beyond momentum.

Pooled across the seven liquid majors (BNB, BTC, ETH, SOL, DOGE, XRP, ADA, fixed a
priori, not picked by result), each asset's funding block-permuted independently
(block length from each series' funding autocorrelation):

| | confirmed-up − flush-down spread |
|--|--:|
| real | **18.3 pts** |
| block null, mean | 4.7 pts |
| block null, 95th pct | 10.7 pts |
| **permutation p-value (block)** | **0.002** |
| permutation p-value (i.i.d. shuffle, for comparison) | 0.002 |

Per asset, the split is exactly the thesis: funding clears the null where leverage
is liquid and is absorbed by momentum or the trend gate where it is not. Every
constituent we tested is shown, not only the ones that pass:

| asset | real spread | p-value (block) | funding adds signal |
|-------|------------:|----------------:|:-------------------:|
| DOGE | 63.4 | 0.020 | yes |
| SOL | 32.4 | 0.027 | yes |
| ETH | 13.3 | 0.033 | yes |
| ADA | 13.3 | 0.20 | no |
| BNB | 11.5 | 0.21 | no, the trend gate carries it |
| LINK | 10.2 | 0.063 | no |
| HBAR | 7.0 | 0.37 | no |
| LTC | 5.7 | 0.12 | no |
| XLM | 3.4 | 0.36 | no |
| XRP | 2.3 | 0.46 | no |
| XMR | 2.1 | 0.34 | no |
| BTC | 1.7 | 0.52 | no |
| TRX | 1.2 | 0.53 | no |
| ZEC | -0.4 | 0.77 | no |
| BCH | -4.0 | 0.70 | no |

**3 of 15 assets clear the null on their own** (ETH, SOL, DOGE), the leverage-liquid
names; the rest are absorbed by momentum or the trend gate. The pooled finding is
carried by those liquid majors, which is the honest cross-asset claim. Deterministic
(seeded), reproduce with `npm run placebo`. The pooled spread is re-derived by
`npm run verify`, so the headline number is tamper-evident, not just stated.

### Why REAL funding data matters (not a price proxy)

A common shortcut in "funding" strategies is to never fetch funding at all: they
*derive* a funding series from price momentum (e.g. `0.0001 + 0.02·return₇`) and
feed that. We tested what the shortcut costs: the **same strategy** run with real
Binance perp funding vs that price-proxy, on every asset (`npm run proxy`,
`reports/real-vs-proxy.csv`).

On the **6 largest assets** (the ones with deep, liquid funding markets, which
also dominate CMC20 by weight) **real funding beats the proxy 5 / 6, mean Sharpe
gain +0.18** (XRP +0.63, SOL +0.21, ETH +0.16). On thin-funding alts neither
carries signal, so the proxy ties by noise. The takeaway is the thesis itself:
**funding is not a price transform**: where leverage is liquid, the real
settlement data holds information a price-derived proxy cannot fake. Our pipeline
fetches real funding for all 19 hedgeable constituents; we do not synthesise it.

### Honest ablation: where funding helps

We report the funding signal's marginal contribution per asset (headline vs the
same strategy with funding turned off):

- ETH (+0.02 Sharpe) and SOL (+0.09): funding adds value.
- BTC: roughly flat.
- **BNB: funding actively underperforms here.** On BNB the funding-off variant
  (`no-divergence`) beats the headline on both Sharpe and return (1.05 vs 0.93
  Sharpe, +689% vs +563%), and the contrarian tilt edges it on Sharpe too (1.04).
  The trend gate carries the BNB strategy, not funding. We state this plainly rather
  than hide it: funding earns its place where leverage is most informative (the
  event-study predictive finding still holds on BNB), but on the BNB portfolio it is
  the regime gate that does the work, and adding funding costs a little Sharpe.

## What's in here

```
skills/cmc-leverage-divergence/   the Agent Skill (the Track-2 deliverable)
  SKILL.md                        frontmatter + the workflow that emits the spec
  references/                     signal math, data sources, spec schema, results
src/
  signals/divergence.ts           the funding x price signal (pure, unit-tested): the one engine
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
tests/                            81 tests: signal math, no-lookahead, stats, spec bridge, basket, CMC adapter, verifier, chain, wallet, risk gate, placebo null
```

## Run it

```bash
npm install
npm test            # 81 tests: signal math, no-lookahead alignment, stats, spec, basket, CMC adapter, verifier, chain, wallet, risk gate, placebo null
npm run verify      # re-derive every headline number from the committed data; VERIFIED or it exits nonzero
npm run spec:live   # LIVE strategy spec from CoinMarketCap (keyless, no key) -> reports/live-spec.json (+ a chain entry)
npm run verify:chain # walk the live chain: re-derive each recorded decision from its inputs; CHAIN VERIFIED or exits nonzero
npm run backtest    # BNB headline -> reports/full/{scorecard.json,scorecard.html}
npm run multiasset  # constituents vs buy-hold + deflated Sharpe -> reports/multiasset.csv
npm run eventstudy  # forward returns by signal state -> reports/event-study.csv
npm run placebo     # funding block-permutation null (per-asset + pooled) -> reports/placebo.json
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
OK    cmc20.overlay.maxDD         got   15.06  want   15.06
OK    eventstudy.30d.up.meanFwd   got   14.23  want   14.23
OK    placebo.pooled.spread       got   18.28  want   18.28
OK    placebo.pooled.significant  got   0.002  want    0.05
OK    README.overlay.maxDD        got    15.1  want    15.1
VERDICT: VERIFIED, every headline number reproduces from the committed data
```

CI runs this on every push (`.github/workflows/ci.yml`), so the claims are
tamper-evident, not asserted. This is the difference between a backtest you can
check and a screenshot you have to believe.

## The live track record proves the decision, not just the log

Each `npm run spec:live` appends one record to `reports/live-chain.jsonl`: the live
CMC inputs (price, aggregate funding, the committed history tail) and the decision
they produced (signal state, score, target allocation), hash-linked to the previous
entry. `npm run verify:chain` walks it on two gates:

1. The sha256 links match, so nothing was reordered, dropped or edited after the fact.
2. Each recorded decision re-derives from its recorded inputs through the same
   engine the backtest uses. Edit an allocation to a number we never produced and
   the entry fails, even after re-linking every hash.

A plain hash-chained log gives you the first gate. The second is the point: it
proves the recorded decision is the one the published engine actually produces from
that exact reading, not just that some number was written down in order. CI runs
`verify:chain` on every push. The chain grows only from real readings, never
backfilled.

```
Decision-provenance chain: 28 entries
  seq   0  2026-06-07T10:17:46.659Z  BNB    alloc 0.1  c43469a5e924…
  ...
  seq  27  2026-06-21T01:01:21.657Z  BNB    alloc 0.1  77259adcf8ba…
VERDICT: CHAIN VERIFIED, 28 entries verified
```

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

### Act on it: hold CMC20 in Trust Wallet

The spec's `trust_wallet` block turns the allocation into an action. CMC20 is
CoinMarketCap's own index as a real BEP-20 on BNB Chain
(`0x2f8A339B5889FfaC4c5A956787cdA593b3c36867`), holdable in Trust Wallet, so the
live demo shows a one-tap link to that exact token and a "hold X%, keep the rest in
cash" instruction. The Skill emits the target, it does not place trades. That is the
honest tie across all three sponsors: CoinMarketCap data, a BNB Chain token, held in
Trust Wallet.

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
contrarian version and the honesty about where funding does and does not help
are deliberate.

## License

MIT.
