# Signal math

All features are pure functions of series that end at the current bar, so the
signal cannot look ahead. The reference implementation is
`src/signals/divergence.ts` (`computeFeatures`), exercised by `tests/signals.test.ts`.

## Inputs (as-of the current bar)

- `closes[]` — daily close prices, oldest first.
- `funding[]` — perp funding rate aligned to each bar (most recent 8h settlement
  at or before the bar open).
- `fearGreed` — Fear & Greed Index 0–100 (optional, off by default).
- `longShortRatio` — long/short account ratio (optional, live/recent only).

## Parameters (fixed a priori, not fit to data)

| name | default | meaning |
|------|---------|---------|
| `lookback` | 7 | bars for price momentum and the funding baseline |
| `zWindow` | 30 | bars to standardise funding |
| `zEnter` | 1.0 | \|funding z\| must exceed this (≈1σ) to arm a branch |
| `zScale` | 1.5 | maps \|z\| beyond `zEnter` into [0,1] strength |
| `priceFlat` | 0 | price return at/below = "not rallying" (long gate) |
| `priceUp` | 0.05 | price return at/above = "extended" (trim gate) |
| `priceScale` | 0.15 | maps price return into [0,1] strength |
| `base` | 0.5 | base long allocation the tilt moves around |
| `tiltScale` | 0.5 | how hard divergence moves allocation |
| `trendWindow` | 100 | MA window for the regime gate |
| `riskOffFactor` | 0.2 | allocation multiplier below the trend MA |
| `crowdK` | 0.7 | crowding size-down sensitivity |
| `fngWeight` | 0.15 | Fear & Greed weight (**off by default**) |

## Formulas

```
pRet      = closes[t] / closes[t-lookback] - 1
fundingZ  = (funding[t] - mean(window)) / std(window)        # window = prior zWindow funding points

# Divergence core, in [-1, 1]:
sNeg      = clamp01((-fundingZ - zEnter) / zScale)           # arms once fundingZ <= -zEnter
sPos      = clamp01(( fundingZ - zEnter) / zScale)           # arms once fundingZ >= +zEnter
priceWeak = clamp01((priceFlat - pRet) / priceScale + 0.5)
priceHot  = clamp01((pRet - priceUp)  / priceScale + 0.5)
divergence = clamp(sNeg*priceWeak - sPos*priceHot, -1, 1)    # + capitulation, - blow-off

# Overlays:
fngTilt      = clamp((50 - fearGreed) / 50, -1, 1)           # contrarian, weight 0 by default
crowdingSize = 1 / (1 + crowdK * |ln(longShortRatio)|)       # 1 when balanced, <1 when skewed
trendFactor  = 1 if closes[t] >= mean(last trendWindow closes) else riskOffFactor

# Final long-only target allocation in [0, 1]:
combined = base + tiltScale*divergence + fngWeight*fngTilt   # fngWeight applied only if enabled
target   = clamp01(combined) * crowdingSize * trendFactor
```

## Why each piece exists

- **Divergence (core).** Funding extremes mark where the leveraged crowd is
  offside; conditioning on price (capitulation = funding negative while price
  holds; blow-off = funding positive into a rally) trades the *disagreement*, which
  sidesteps the "no universal funding threshold works" problem. Ablation: removing
  it drops Sharpe 0.84 → 0.56.
- **Trend gate.** A contrarian buyer must not catch knives in a structural
  downtrend. Below the 100-day MA the book is cut to 20%. Ablation: removing it
  roughly doubles max drawdown (26% → 52%).
- **Crowding size-down.** Long/short skew is a fragility gauge, so it scales size,
  never direction. Live/recent only (Binance serves ~30 days), so its backtest
  effect is small by construction.
- **Fear & Greed.** Tested and **rejected**: adding it lowered Sharpe (0.84 →
  0.80), so it ships off by default. The Skill still reports it for context.

## No lookahead

`fundingZ` uses the *strictly prior* window; `trendFactor` and `pRet` use only past
and current closes; signals are index-aligned with bars and capped at the current
bar by the engine (`tests/engine-signals.test.ts`). Robustness to `trendWindow`
(50/100/150) and `zWindow` is left as a parameter the reader can flip in the config.
