# Data sources

Two worlds: the **live Skill** reads CoinMarketCap live (the keyless data-api by
default, or the CMC MCP tools inside an agent); the **committed backtest** reads
documented historical feeds, because CMC's live surface returns the latest
snapshot, not multi-year history.

## Live (the Skill)

CMC AI Agent Hub via MCP (`https://mcp.coinmarketcap.com/mcp`, header
`X-CMC-MCP-API-KEY`), or the keyless x402 path ($0.01/request on Base).

| Tool | Provides |
|------|----------|
| `get_global_crypto_derivatives_metrics` | funding rate, open interest + change, long/short ratio, BTC liquidations |
| `get_global_metrics_latest` | Fear & Greed, Altcoin Season, BTC/ETH dominance, ETF flows |
| `get_crypto_quotes_latest` | latest price/volume for the asset |
| `get_crypto_marketcap_technical_analysis` | RSI/MACD, support/resistance for trend context |
| `trending_crypto_narratives` | qualitative sector/narrative context |

### Keyless data-api (the automated `--live` path)

`npm run spec -- --live` uses CMC's public data-api, the same keyless endpoints
the CMC website calls (browser user-agent, no key), implemented in
`src/data/cmc.ts`. This is what makes the live path runnable with zero credentials.

| Endpoint | Provides | Used for |
|----------|----------|----------|
| `data-api/v3/cryptocurrency/listing` | live price + market cap per coin | the latest close |
| `data-api/v3/cryptocurrency/market-pairs/latest?category=perpetual` | per-venue funding rate + open interest | aggregate funding (volume-weighted) + OI |
| `data-api/v3/global-metrics/quotes/latest` | BTC/ETH dominance, market context | optional context |

The aggregate funding is the volume-weighted mean of the per-venue `fundingRate`
across CMC's perpetual market pairs (19 venues for BNB at last run), the keyless
equivalent of `get_global_crypto_derivatives_metrics`. A committed example of a
real run is `references/live-spec-example.json`.

## Historical (the backtest)

All free and keyless. Fetched and committed by `src/data/fetch.ts` into `data/` so
runs are reproducible offline (the loaders never touch the network). Four assets:
BNB (primary), BTC, ETH, SOL.

| Series | Source | Coverage |
|--------|--------|----------|
| Daily price (OHLCV) | Binance `api/v3/klines` (BNB/BTC/ETH/SOL USDT) | 2019-09 → now (~2100-2471 bars) |
| Perp funding rate (8h) | Binance `fapi/v1/fundingRate` (per symbol) | back to inception (~6300-7400 points) |
| Fear & Greed | Alternative.me `/fng` (global) | since 2018 (3044 readings) |
| Open interest | Binance `futures/data/openInterestHist` (BNB) | **~30 days only** |
| Long/short ratio | Binance `futures/data/globalLongShortAccountRatio` (BNB) | **~30 days only** |

## Alignment and honesty

- Each signal is taken **as-of the bar's open** (most recent value at or before it),
  via `asOf()` in `src/data/loaders.ts`.
- Fear & Greed is shifted **+1 day** before alignment: a day's reading is only
  knowable the next morning, so this avoids same-day lookahead.
- Open interest and the long/short ratio have only ~30 days of free history, so for
  almost the whole backtest they are absent (the loader leaves them `undefined`
  rather than fabricating them). The crowding overlay is therefore validated on a
  short recent window and used live; it does not drive the multi-year result.
- The manifest records a SHA-256 of the exact candle dataset, so a judge can verify
  the run reproduces byte-for-byte.
