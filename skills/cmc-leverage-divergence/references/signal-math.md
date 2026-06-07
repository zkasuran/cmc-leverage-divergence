# Signal math

All features are pure functions of series that end at the current bar, so the
signal cannot look ahead. Reference implementation: `src/signals/divergence.ts`
(`computeFeatures`), exercised by `tests/signals.test.ts`.

## The signal: funding x price interaction

The score is positive when funding and price **agree up** (leverage-confirmed
momentum) and negative when leverage flushes into price weakness. This direction
is what the event study supports; the contrarian flip is the key ablation and it
underperforms (see `backtest-results.md`).

## Inputs (as-of the current bar)

- `closes[]`: daily close prices, oldest first.
- `funding[]`: perp funding rate aligned to each bar (most recent 8h settlement
  at or before the bar open).
- `fearGreed`, `longShortRatio`: optional overlays.

## Parameters (fixed a priori, not fit to data)

| name | default | meaning |
|------|---------|---------|
| `lookback` | 7 | bars for price momentum |
| `zWindow` | 30 | bars to standardise funding |
| `zEnter` | 1.0 | \|funding z\| must exceed this (~1σ) to arm a branch |
| `zScale` | 1.5 | maps \|z\| beyond `zEnter` into [0,1] strength |
| `priceUp` | 0.05 | price return marking "extended up" |
| `priceFlat` | 0 | price return marking "weak" |
| `priceScale` | 0.15 | maps price return into [0,1] strength |
| `base` | 0.5 | base long allocation the signal tilts around |
| `tiltScale` | 0.5 | how hard the signal moves allocation (negative = contrarian) |
| `trendWindow` | 100 | MA window for the regime gate |
| `riskOffFactor` | 0.2 | allocation multiplier below the trend MA |
| `crowdK` | 0.7 | crowding size-down sensitivity |
| `fngWeight` | 0.15 | Fear & Greed weight (**off by default**) |

## Formulas

```
pRet      = closes[t] / closes[t-lookback] - 1
fundingZ  = (funding[t] - mean(window)) / std(window)     # window = prior zWindow points

# Leverage signal in [-1, 1] (+ = confirmed momentum, - = flush):
sPos       = clamp01(( fundingZ - zEnter) / zScale)       # arms once fundingZ >= +zEnter
sNeg       = clamp01((-fundingZ - zEnter) / zScale)       # arms once fundingZ <= -zEnter
priceHot   = clamp01((pRet - priceUp)  / priceScale + 0.5)
priceWeak  = clamp01((priceFlat - pRet)/ priceScale + 0.5)
signal     = clamp(sPos*priceHot - sNeg*priceWeak, -1, 1) # + confirmed-up, - flush-down

# Overlays:
fngTilt      = clamp((50 - fearGreed) / 50, -1, 1)        # off by default
crowdingSize = 1 / (1 + crowdK * |ln(longShortRatio)|)    # 1 balanced, <1 skewed
trendFactor  = 1 if closes[t] >= mean(last trendWindow closes) else riskOffFactor

# Final long-only target allocation in [0, 1]:
combined = base + tiltScale*signal + fngWeight*fngTilt    # fngWeight only if enabled
target   = clamp01(combined) * crowdingSize * trendFactor
```

(The code calls the signal field `divergence` for historical reasons; its sign
follows the confirmation convention above.)

## Why each piece exists

- **Leverage signal (core).** Funding + price together time the leveraged crowd.
  The event study shows confirmation predicts and contrarian does not. Ablation:
  flipping the tilt (`contrarian`) underperforms; the marginal benefit is
  asset-dependent (helps ETH/SOL, flat BTC, neutral on BNB).
- **Trend gate.** Below the 100-day MA the book is cut to 20%, so the signal never
  fights a structural downtrend. This is the workhorse for drawdown control.
- **Crowding size-down.** Long/short skew scales size, never direction. Live/recent
  only (~30 days), so small backtest effect by construction.
- **Fear & Greed.** Tested and **off by default**; the ablation shows it does not
  improve the result. Reported for context.

## No lookahead

`fundingZ` uses the strictly-prior window; `trendFactor` and `pRet` use only past
and current closes; signals are index-aligned with bars and capped at the current
bar by the engine (`tests/engine-signals.test.ts`). `trendWindow`/`zWindow` are
exposed so a reader can check robustness.
