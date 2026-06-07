---
name: cmc-leverage-divergence
description: |
  Turns CoinMarketCap AI Agent Hub data into a backtestable crypto strategy spec
  built on the funding-rate x price signal. Use when a user wants a
  derivatives-aware strategy (not a price-only TA bot), asks about funding rates,
  leverage-confirmed momentum, when to risk-off, or wants a concrete, testable
  allocation rule for BNB or other majors with a trend regime gate.
  Trigger: "funding rate strategy", "leverage signal", "is this leverage-confirmed",
  "should I risk off", "funding momentum", "backtestable BNB strategy",
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

# Leverage Signal Strategy Skill

Produce a **backtestable strategy spec** from CoinMarketCap AI Agent Hub data. The
signal is the interaction of perp **funding** and **price**, gated by a trend
regime. This is deliberately a strategy a price-only bot cannot build: it needs the
derivatives surface CMC exposes.

The Skill does not place trades. It reads the live market through CMC MCP tools,
computes the signal exactly as the committed backtester does and emits a
structured spec (allocation + rules + the readings that justify it). A reproducible
multi-asset backtest ships in the repo as evidence.

## The core principle (and the finding behind it)

Funding is what the leveraged crowd pays to hold its position. The popular reading
is contrarian: deeply negative funding means "buy the bottom." A forward-return
event study across BNB/BTC/ETH/SOL says that is **backwards** at the daily horizon
(see `references/backtest-results.md`). What predicts is **confirmation**: funding
positive and price rising (leverage backing the move) continues; funding negative
into price weakness (leverage flushing) does not bounce.

So the signal is positive when funding and price **agree up**, negative when
leverage flushes into weakness. Then never fight the primary trend: below the long
moving average, cut the book. All thresholds are fixed a priori.

## Prerequisites

Verify the CMC MCP tools are reachable. If they error, ask the user to configure:

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

Key at https://pro.coinmarketcap.com/login; the x402 keyless path also works.

## Workflow

### Step 1: Derivatives structure
Call `get_global_crypto_derivatives_metrics`: funding rate (the core input), open
interest, long/short ratio (crowding), liquidations.

### Step 2: Context
Call `get_global_metrics_latest`: Fear & Greed, Altcoin Season, dominance, ETF
flows. (Fear & Greed is reported but off by default; the ablation shows it does not
help.)

### Step 3: Price and trend
Call `get_crypto_quotes_latest` and `get_crypto_marketcap_technical_analysis` for
the asset (default BNB) to get the recent price path and place it against its
100-day moving average. Optionally `trending_crypto_narratives` for context.

### Step 4: Compute the signal
Assemble the readings into a snapshot (recent `closes[]`, aligned `funding[]`,
latest `fearGreed`/`longShortRatio`) and run the project's spec generator. This is
the key point: the Skill does NOT re-derive the math in prose. It calls the SAME
`computeFeatures` the backtester replays over history, so the live spec and the
backtest are one engine. Three ways:
- **Automated, keyless (recommended):** `npm run spec -- --live --asset BNB`
  fetches the live reading straight from CoinMarketCap's public data-api (price
  from the listing, aggregate perp funding + open interest from the perpetual
  market pairs), assembles the snapshot and prices it with the same engine. No API
  key. The written `reports/live-spec.json` records the exact CMC endpoints it
  called (a committed example is `references/live-spec-example.json`).
- **In an agent with the CMC MCP tools:** write the snapshot the step 1-3 MCP
  calls produce to `snapshot.json` and run `npm run spec -- --file snapshot.json`.
- **Programmatically:** `import { specFromSnapshot } from "cmc-leverage-divergence"`
  and call it on the snapshot.

The formula it runs (per `references/signal-math.md`):
1. `pRet` = price return over the lookback (7 bars).
2. `fundingZ` = z-score of current funding vs its trailing 30-point window.
3. `signal` in [-1, 1]: confirmed-up (+) when `fundingZ ≥ +1` and price extended;
   flush-down (-) when `fundingZ ≤ -1` and price weak.
4. `trendFactor` = 1 if price ≥ 100-day MA, else 0.2 (risk-off).
5. `target` = clamp01(`base` + `tiltScale`·`signal`) · `crowdingSize` · `trendFactor`.

### Step 5: Return the spec
`specFromSnapshot` returns the exact spec in `references/strategy-spec-schema.md`
(asset, regime, signal state + score, the readings, target allocation, rules, risk
gates). That object IS the deliverable. Hand it back to the user.

### Step 6: Point to the proof
The same engine, replayed over history, produces the multi-asset backtest
(`reports/multiasset.csv`), the event study (`reports/event-study.csv`), the
ablation and the deflated Sharpe across 15 CMC20 constituents. `npm run spec:live`
(live) and `npm run backtest` (proof) are two views of one signal. And `npm run
verify` re-derives every headline number from the committed data and fails if any
report or README figure was edited, so the claims are tamper-evident, not asserted
(CI runs it on every push).

## Report structure (the spec the Skill returns)

```json
{
  "asset": "BNB",
  "as_of": "<ISO-8601>",
  "regime": "risk-on | risk-off",
  "signal": { "state": "confirmed-up | flush-down | neutral", "score": 0.0 },
  "readings": {
    "funding_rate": 0.0, "funding_z": 0.0, "price_return_lookback": 0.0,
    "fear_greed": 0, "long_short_ratio": 0.0, "open_interest": 0.0
  },
  "target_allocation": 0.0,
  "rules": {
    "add_when": "funding_z >= +1 and price extended up (leverage-confirmed)",
    "trim_when": "funding_z <= -1 and price weak (leverage flush)",
    "trend_gate": "if close < SMA(100): multiply allocation by 0.2",
    "size_down_when": "long/short ratio skewed (crowding)"
  },
  "risk": { "max_drawdown_kill": 0.6, "rebalance_deadband": 0.1 },
  "backtest_ref": "reports/multiasset.csv",
  "trust_wallet": {
    "token": "CMC20", "holdPct": 10, "cashPct": 90,
    "instruction": "Hold 10% in CMC20 (BEP-20 on BNB Chain) and 90% in cash/stables.",
    "trustWalletLink": "https://link.trustwallet.com/open_coin?asset=c20000714_t0x2f8A339B5889FfaC4c5A956787cdA593b3c36867"
  }
}
```

The `trust_wallet` block turns the allocation into an action: CMC20 is CoinMarketCap's
own index as a real BEP-20 on BNB Chain, holdable in Trust Wallet, so the link opens
that exact token. The Skill emits the target, it does not place trades. This is the
honest BNB Chain + Trust Wallet tie alongside the CoinMarketCap data (all three sponsors).

## Honesty

- The live spec reads the latest point from CMC (the keyless data-api in the
  automated `--live` path or the CMC MCP tools inside an agent); the z-score and
  trend windows use the committed historical feeds in `references/data-sources.md`.
  The signal math is identical in both paths.
- Open interest / long-short have ~30 days of free history, so crowding is a live
  overlay, not a backtest driver.
- Funding's marginal value is asset-dependent: it helps ETH/SOL, is flat on BTC
  and does not help on BNB, where the trend gate carries the result. We report
  this. The strategy is long-only spot and does not beat buy-and-hold's raw return
  in a bull; it targets far lower drawdown at comparable risk-adjusted return.
