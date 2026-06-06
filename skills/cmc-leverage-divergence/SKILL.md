---
name: cmc-leverage-divergence
description: |
  Turns CoinMarketCap AI Agent Hub market-structure data into a backtestable crypto
  trading strategy spec built on funding-rate-vs-price divergence. Use when a user
  wants a derivatives-aware strategy (not a price-only TA bot), asks about funding
  rates, crowded leverage, capitulation or blow-off timing, or wants a concrete,
  testable allocation rule for BTC with a risk-on/off regime gate.
  Trigger: "funding divergence", "leverage strategy", "is this a capitulation",
  "crowded longs", "funding rate strategy", "risk-managed BTC allocation",
  "/leverage-divergence"
license: MIT
compatibility: ">=1.0.0"
user-invocable: true
allowed-tools:
  - mcp__cmc-mcp__get_global_crypto_derivatives_metrics
  - mcp__cmc-mcp__get_global_metrics_latest
  - mcp__cmc-mcp__get_crypto_quotes_latest
  - mcp__cmc-mcp__get_crypto_marketcap_technical_analysis
  - mcp__cmc-mcp__trending_crypto_narratives
---

# Leverage-Divergence Strategy Skill

Produce a **backtestable strategy spec** from CoinMarketCap AI Agent Hub data. The
edge is the divergence between perp **funding** and **price** momentum, gated by a
trend regime. This is deliberately a strategy a price-only bot cannot build: it
needs the derivatives surface CMC exposes.

The Skill's job is not to place trades. It reads the live market through CMC MCP
tools, computes the divergence signal exactly as the committed backtester does, and
emits a structured spec (allocation + rules + the signal readings that justify it).
A reproducible backtest of the same rules ships in the repo as evidence.

## Prerequisites

Verify the CMC MCP tools are reachable. If they error, ask the user to configure
the connection:

```json
{
  "mcpServers": {
    "cmc-mcp": {
      "url": "https://mcp.coinmarketcap.com/mcp",
      "headers": { "X-CMC-MCP-API-KEY": "your-api-key" }
    }
  }
}
```

Get a key at https://pro.coinmarketcap.com/login. The x402 keyless path
(`$0.01`/request on Base) also works if the user has no key.

## Core principle

Funding is what the leveraged crowd pays to hold its position. When funding goes
**abnormally negative** (shorts paying longs) while price refuses to fall, the
short side is offside: capitulation. When funding goes **abnormally positive**
(longs paying) into an extended rally, the long side is offside: blow-off. Trade
the *disagreement* between funding and price, not a fixed funding level. Then never
fight the primary trend: below the long moving average, cut the book.

All thresholds are fixed a priori (see `references/signal-math.md`); nothing is fit
to history.

## Workflow

### Step 1: Derivatives structure

Call `get_global_crypto_derivatives_metrics`. Read:
- **funding rate** (the core input; positive = longs pay shorts),
- open interest and its change,
- long/short account ratio (crowding),
- BTC long-vs-short liquidations (capitulation confirmation).

### Step 2: Sentiment and regime context

Call `get_global_metrics_latest`. Read the Fear & Greed Index, Altcoin Season
Index, BTC dominance and ETF flows. (Fear & Greed is reported but down-weighted to
zero by default; see Step 4 and the ablation in `references/backtest-results.md`.)

### Step 3: Price and trend

Call `get_crypto_quotes_latest` and `get_crypto_marketcap_technical_analysis` for
the asset (default BTC). Read the recent price path (for the lookback return) and
enough history to place price against its long moving average (the trend gate).
Optionally call `trending_crypto_narratives` for qualitative context.

### Step 4: Compute the signal

Follow `references/signal-math.md` exactly:
1. `pRet` = price return over the lookback (default 7 bars).
2. `fundingZ` = z-score of current funding vs its trailing window (default 30).
3. `divergence` in [-1, 1]: capitulation (+) when `fundingZ ≤ -1` and price weak;
   blow-off (-) when `fundingZ ≥ +1` and price extended.
4. `trendFactor` = 1 if price ≥ trend MA (default 100), else `riskOffFactor` (0.2).
5. `target` = clamp01(`base` + `tiltScale`·`divergence`) · `crowdingSize` · `trendFactor`.

### Step 5: Emit the strategy spec

Emit the spec in the schema from `references/strategy-spec-schema.md`: the asset,
the as-of signal readings, the divergence state, the target allocation, the
explicit entry/exit/sizing rules, and the risk gates. This is the deliverable.

### Step 6: Point to the proof

State that the same rules are backtested in the repo (`reports/full/scorecard.json`,
`reports/ablation.csv`, `reports/walkforward.csv`) and summarise the headline:
Sharpe 0.84 at 26% max drawdown over 2019–2026 vs buy-and-hold's 0.79 at 77%, with
an ablation showing the funding-divergence signal carries the edge.

## Report structure (the spec the Skill returns)

```json
{
  "asset": "BTC",
  "as_of": "<ISO-8601>",
  "regime": "risk-on | risk-off",
  "divergence": { "state": "capitulation | blowoff | neutral", "score": -1.0 },
  "signals": {
    "funding_rate": 0.0,
    "funding_z": 0.0,
    "price_return_lookback": 0.0,
    "fear_greed": 0,
    "long_short_ratio": 0.0,
    "open_interest": 0.0
  },
  "target_allocation": 0.0,
  "rules": {
    "add_when": "funding_z <= -1 and price not rallying (capitulation)",
    "trim_when": "funding_z >= +1 and price extended (blow-off)",
    "trend_gate": "if close < SMA(100): multiply allocation by 0.2",
    "size_down_when": "long/short ratio skewed (crowding)"
  },
  "risk": { "max_drawdown_kill": 0.6, "rebalance_deadband": 0.1 },
  "backtest_ref": "reports/full/scorecard.json"
}
```

## Notes and honesty

- CMC MCP serves the **latest** derivatives/F&G snapshot, so the live Skill reads
  CMC in real time while the committed backtest uses documented historical feeds
  (Binance klines + funding, Alternative.me Fear & Greed). See
  `references/data-sources.md`.
- Open interest and the long/short ratio have only ~30 days of free history, so the
  crowding overlay is validated on a short window and used live; it does not drive
  the multi-year backtest.
- The strategy is risk-managed and long-only. It does **not** beat buy-and-hold's
  raw return over a 6x bull market; it targets better risk-adjusted return at far
  lower drawdown. That trade-off is the point.
