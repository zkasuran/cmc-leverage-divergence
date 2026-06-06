# Strategy spec schema

The Skill emits one JSON object: a self-contained, backtestable description of the
strategy as-of now. "Backtestable" means every field needed to replay the rule is
present and unambiguous.

```jsonc
{
  "asset": "BNB",                       // string, the traded symbol's base
  "as_of": "2026-06-06T12:00:00Z",      // ISO-8601, when the readings were taken
  "regime": "risk-on",                  // "risk-on" | "risk-off" (trend gate)
  "signal": {
    "state": "confirmed-up",            // "confirmed-up" | "flush-down" | "neutral"
    "score": 0.42                        // number in [-1, 1]; + add, - trim
  },
  "readings": {                         // the values that justify the spec
    "funding_rate": 0.00021,            // current perp funding (fraction / 8h)
    "funding_z": 1.6,                   // z vs trailing 30 funding points
    "price_return_lookback": 0.08,      // return over `lookback` bars
    "fear_greed": 64,                   // 0-100, null if unavailable
    "long_short_ratio": 1.3,            // null if unavailable
    "open_interest": 512000.0           // base units, null if unavailable
  },
  "target_allocation": 0.78,            // number in [0, 1], long-only equity fraction
  "rules": {                            // the fixed, a-priori decision rules
    "lookback": 7,
    "z_window": 30,
    "z_enter": 1.0,
    "add_when": "funding_z >= +1 and price extended up (leverage-confirmed momentum)",
    "trim_when": "funding_z <= -1 and price weak (leverage flush)",
    "trend_gate": "if close < SMA(100): allocation *= 0.2",
    "crowding": "allocation *= 1 / (1 + 0.7*|ln(long_short_ratio)|)",
    "base": 0.5,
    "tilt_scale": 0.5,
    "rebalance_deadband": 0.1           // skip rebalances smaller than 10% of equity
  },
  "risk": {
    "max_drawdown_kill": 0.6,           // halt if equity falls 60% below peak
    "long_only": true,
    "fees_bps": 10,                     // assumed in the backtest
    "slippage_bps": 5
  },
  "backtest_ref": "reports/multiasset.csv"
}
```

## Field rules

- `target_allocation` is the single actionable output. An execution layer (e.g. a
  Trust Wallet automation) rebalances the spot book toward it, respecting
  `rebalance_deadband`.
- `readings.*` may be `null` when a venue does not expose that series for the period
  (notably `open_interest` / `long_short_ratio` outside the recent window). A null
  drops that overlay; the core signal still computes from funding + price.
- `rules` and `risk` are constants, not fit to data, and match the committed
  backtest config so the spec and the evidence are the same strategy.
