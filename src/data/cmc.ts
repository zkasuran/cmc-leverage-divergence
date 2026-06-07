/**
 * CoinMarketCap keyless data-api adapter.
 *
 * The Skill reads the live market through CoinMarketCap. This module turns the
 * raw responses of CMC's public data-api (the same keyless endpoints the CMC
 * website calls, browser user-agent, no key) into the `CmcSnapshot` the signal
 * engine prices. Three CMC surfaces are used:
 *
 *   - cryptocurrency/listing            -> live price + market cap (the quote)
 *   - cryptocurrency/market-pairs/latest?category=perpetual
 *                                       -> per-venue funding rate + open interest
 *   - global-metrics/quotes/latest      -> dominance / market context (optional)
 *
 * The parsers are pure and unit-tested against captured fixtures; the network
 * fetch is a thin wrapper verified by a real run (`npm run spec -- --live`).
 */

import type { CmcSnapshot } from "../spec.js";

// ---------------------------------------------------------------------------
// Pure parsers (unit-tested against tests/fixtures/*)
// ---------------------------------------------------------------------------

export interface CmcQuote {
  id: number;
  symbol: string;
  name: string;
  /** Latest USD price. */
  price: number;
  /** Latest USD market cap. */
  marketCap: number;
}

/** Pull one coin's live quote out of a CMC `cryptocurrency/listing` response. */
export function quoteFromListing(listing: any, symbol: string): CmcQuote | null {
  const list: any[] = listing?.data?.cryptoCurrencyList ?? [];
  const want = symbol.toUpperCase();
  const c = list.find((x) => String(x?.symbol).toUpperCase() === want);
  if (!c) return null;
  const q = c.quotes?.[0] ?? {};
  return {
    id: Number(c.id),
    symbol: String(c.symbol),
    name: String(c.name ?? c.symbol),
    price: Number(q.price),
    marketCap: Number(q.marketCap),
  };
}

export interface PerpAggregate {
  /** Volume-weighted funding rate across the venues (fraction per 8h). */
  fundingRate: number;
  /** Summed open interest in USD across the venues. */
  openInterestUsd: number;
  /** Number of venues that reported a finite funding rate. */
  venues: number;
  /** Lowest and highest venue funding rate blended (for sanity bounds). */
  minVenueFunding: number;
  maxVenueFunding: number;
}

/**
 * Aggregate per-venue perp readings from a CMC `market-pairs/latest` response
 * into one funding rate (volume-weighted) and a summed open interest. This is
 * the keyless equivalent of CMC's `get_global_crypto_derivatives_metrics`.
 */
export function aggregatePerpFunding(perp: any): PerpAggregate | null {
  const pairs: any[] = perp?.data?.marketPairs ?? [];
  const rows = pairs
    .map((p) => ({
      f: Number(p?.fundingRate),
      w: Number(p?.volumeUsd),
      oi: Number(p?.openInterestUsd),
    }))
    .filter((r) => Number.isFinite(r.f));
  if (rows.length === 0) return null;

  let wSum = 0;
  let fwSum = 0;
  let oiSum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const w = Number.isFinite(r.w) && r.w > 0 ? r.w : 0;
    wSum += w;
    fwSum += w * r.f;
    if (Number.isFinite(r.oi) && r.oi > 0) oiSum += r.oi;
    if (r.f < min) min = r.f;
    if (r.f > max) max = r.f;
  }
  // Volume-weighted mean, falling back to a plain mean if no volume is reported.
  const fundingRate =
    wSum > 0 ? fwSum / wSum : rows.reduce((a, r) => a + r.f, 0) / rows.length;

  return {
    fundingRate,
    openInterestUsd: oiSum,
    venues: rows.length,
    minVenueFunding: min,
    maxVenueFunding: max,
  };
}

export interface GlobalMetrics {
  btcDominance: number;
  ethDominance: number;
}

/** Pull market context (dominance) from a CMC `global-metrics/quotes/latest` response. */
export function parseGlobalMetrics(global: any): GlobalMetrics | null {
  const d = global?.data;
  const btc = Number(d?.btcDominance);
  const eth = Number(d?.ethDominance);
  if (!Number.isFinite(btc) || !Number.isFinite(eth)) return null;
  return { btcDominance: btc, ethDominance: eth };
}

export interface LiveSnapshotInput {
  asset: string;
  /** Committed historical daily closes, oldest first (the reproducible context). */
  histCloses: readonly number[];
  /** Committed historical funding aligned to `histCloses`. */
  histFunding: readonly number[];
  /** Live CMC price, appended as the newest bar. */
  price: number;
  /** Live CMC aggregate funding, appended as the newest reading. */
  fundingRate: number;
  openInterest?: number;
  fearGreed?: number;
  longShortRatio?: number;
}

/**
 * Append the live CMC reading as the newest bar on the committed history tail.
 * The historical context is reproducible (committed snapshots); only the final
 * point is live, which is exactly what the z-score / momentum windows need to
 * place the live reading in context.
 */
export function buildLiveSnapshot(input: LiveSnapshotInput): CmcSnapshot {
  const snap: CmcSnapshot = {
    asset: input.asset,
    closes: [...input.histCloses, input.price],
    funding: [...input.histFunding, input.fundingRate],
  };
  if (input.openInterest !== undefined) snap.openInterest = input.openInterest;
  if (input.fearGreed !== undefined) snap.fearGreed = input.fearGreed;
  if (input.longShortRatio !== undefined) snap.longShortRatio = input.longShortRatio;
  return snap;
}

// ---------------------------------------------------------------------------
// Live fetch (thin I/O wrapper; verified by `npm run spec -- --live`)
// ---------------------------------------------------------------------------

const BASE = "https://api.coinmarketcap.com/data-api/v3";
// A browser user-agent: the data-api is the keyless endpoint the CMC site calls.
const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/149.0 Safari/537.36";

/** A live reading assembled from the keyless CMC data-api. */
export interface CmcLiveReading {
  asset: string;
  id: number;
  price: number;
  marketCap: number;
  /** Volume-weighted aggregate funding across CMC's perp venues (null if none). */
  fundingRate: number | null;
  openInterestUsd: number | null;
  /** Number of perp venues that reported funding. */
  venues: number;
  /** Market context: BTC/ETH dominance (null if unavailable). */
  btcDominance: number | null;
  ethDominance: number | null;
  asOf: string;
  /** The CMC endpoints actually called, for provenance in the artifact. */
  endpoints: string[];
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/**
 * Pull a live reading for one asset from the keyless CMC data-api: its quote
 * (price + market cap) from the listing, and its aggregate perp funding + open
 * interest from the perpetual market pairs. No API key.
 */
export async function fetchCmcLive(symbol: string, asOfIso: string): Promise<CmcLiveReading> {
  const listingUrl = `${BASE}/cryptocurrency/listing?start=1&limit=30&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all`;
  const listing = await getJson(listingUrl);
  const q = quoteFromListing(listing, symbol);
  if (!q) throw new Error(`${symbol} not found in CMC listing top 30`);

  const perpUrl = `${BASE}/cryptocurrency/market-pairs/latest?id=${q.id}&category=perpetual&limit=20&convert=USD`;
  const perp = await getJson(perpUrl);
  const agg = aggregatePerpFunding(perp);

  // Market context (dominance). Non-fatal: if it fails the spec still prices.
  const globalUrl = `${BASE}/global-metrics/quotes/latest`;
  let gm: GlobalMetrics | null = null;
  try {
    gm = parseGlobalMetrics(await getJson(globalUrl));
  } catch {
    gm = null;
  }

  return {
    asset: q.symbol,
    id: q.id,
    price: q.price,
    marketCap: q.marketCap,
    fundingRate: agg?.fundingRate ?? null,
    openInterestUsd: agg?.openInterestUsd ?? null,
    venues: agg?.venues ?? 0,
    btcDominance: gm?.btcDominance ?? null,
    ethDominance: gm?.ethDominance ?? null,
    asOf: asOfIso,
    endpoints: gm ? [listingUrl, perpUrl, globalUrl] : [listingUrl, perpUrl],
  };
}
