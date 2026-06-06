/**
 * CMC20 funding-regime overlay — the unifying strategy.
 *
 * CMC20 is CoinMarketCap's top-20 index (tokenized on BNB Smart Chain). It has no
 * perp market of its own, but its largest constituents (BTC, ETH, BNB, SOL) do.
 * This builds an AGGREGATE funding-confirmation signal from those constituents and
 * uses it to time exposure to the CMC20 index itself:
 *
 *   - hold CMC20 when the basket's leverage is confirmed / the trend is up,
 *   - step to cash when constituent funding flushes or CMC20 falls below its trend.
 *
 * So the funding engine we validated across four assets becomes the risk gate for
 * CMC's own index — one project, not two. The signal is computed with the SAME
 * `computeFeatures` the backtest and the live spec use, on a synthetic "basket
 * funding" series (constituent funding averaged), aligned to CMC20's daily bars.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCmc20Bars } from "../data/cmc-loader.js";
import { loadDataset, DEFAULT_DATA_DIR, asOf } from "../data/loaders.js";
import { runStrategy } from "./run.js";
import { makeLeverageDivergence } from "../strategy/leverage-divergence.js";
import { makeBuyHold } from "../baselines/buy-hold.js";
import { returnsFromEquity, probabilisticSharpe } from "../engine/stats.js";
import type { Bar, SignalPoint, Metrics } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Series {
  time: number;
  value: number;
}

interface Constituent {
  symbol: string;
  prefix: string;
  pair: string;
  marketCap: number;
}

/**
 * The CMC20 constituent universe: CoinMarketCap's current top-20 by market cap
 * (ex-stablecoins, ex-wrapped, per CMC20 methodology) intersected with the assets
 * that have a liquid perp funding market. Derived in data/cmc20-constituents.json
 * from the CMC listing API. Falls back to the four majors if the file is absent.
 *
 * This is dynamic by construction: re-run `npm run fetch-data` and the universe
 * refreshes to whatever CMC ranks in the top 20 today, so a coin that drops out
 * leaves and a new entrant joins automatically.
 */
export function loadConstituents(dir = DEFAULT_DATA_DIR): Constituent[] {
  const path = resolve(dir, "cmc20-constituents.json");
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as Constituent[];
  }
  return [
    { symbol: "BTC", prefix: "btc", pair: "BTCUSDT", marketCap: 1 },
    { symbol: "ETH", prefix: "eth", pair: "ETHUSDT", marketCap: 1 },
    { symbol: "BNB", prefix: "bnb", pair: "BNBUSDT", marketCap: 1 },
    { symbol: "SOL", prefix: "sol", pair: "SOLUSDT", marketCap: 1 },
  ];
}

/** Read one constituent's funding series. Majors come via loadDataset; the rest
 * from their committed `<prefix>-funding.json`. Returns [] if no data. */
function constituentFunding(c: Constituent, dir: string): Series[] {
  // Majors are loaded as full assets (they have klines too).
  if (["btc", "eth", "bnb", "sol"].includes(c.prefix)) {
    const { bars, signals } = loadDataset(c.prefix, dir);
    const out: Series[] = [];
    for (let i = 0; i < bars.length; i++) {
      const f = signals[i]?.fundingRate;
      if (f !== undefined) out.push({ time: bars[i]!.time, value: f });
    }
    return out;
  }
  const path = resolve(dir, `${c.prefix}-funding.json`);
  if (!existsSync(path)) return [];
  const raw: any[] = JSON.parse(readFileSync(path, "utf8"));
  return raw
    .map((r) => ({ time: Number(r.fundingTime), value: Number(r.fundingRate) }))
    .sort((a, b) => a.time - b.time);
}

/** Global Fear & Greed series (shared across assets). */
function fngSeries(dir: string): Series[] {
  const { bars, signals } = loadDataset("btc", dir);
  return bars
    .map((b, i) => ({ time: b.time, value: signals[i]?.fearGreed }))
    .filter((x): x is Series => x.value !== undefined);
}

/**
 * Build the CMC20 basket funding series aligned to CMC20 bars: at each bar, take a
 * MARKET-CAP-WEIGHTED average of every constituent's most-recent funding rate
 * (as-of that bar's open, so no lookahead), over whatever constituents have data
 * at that time. Bigger index members move the basket signal more, exactly as they
 * move the index. Fear & Greed is the global series, carried through.
 */
export function buildBasketSignals(
  cmc20Bars: readonly Bar[],
  dir = DEFAULT_DATA_DIR,
): (SignalPoint | null)[] {
  const universe = loadConstituents(dir);
  const series = universe.map((c) => ({ weight: c.marketCap, funding: constituentFunding(c, dir) }));
  const fng = fngSeries(dir);

  return cmc20Bars.map((bar) => {
    let wsum = 0;
    let acc = 0;
    for (const s of series) {
      const v = asOf(s.funding, bar.time);
      if (v !== null) { acc += s.weight * v; wsum += s.weight; }
    }
    const point: SignalPoint = {};
    if (wsum > 0) point.fundingRate = acc / wsum;
    const g = asOf(fng, bar.time);
    if (g !== null) point.fearGreed = g;
    return Object.keys(point).length > 0 ? point : null;
  });
}

/** How many constituents actually contribute funding at the latest CMC20 bar. */
export function constituentCoverage(dir = DEFAULT_DATA_DIR): { total: number; withFunding: number; symbols: string[] } {
  const universe = loadConstituents(dir);
  const bars = loadCmc20Bars();
  const last = bars[bars.length - 1]!.time;
  const have = universe.filter((c) => asOf(constituentFunding(c, dir), last) !== null);
  return { total: universe.length, withFunding: have.length, symbols: have.map((c) => c.symbol) };
}

export interface OverlayResult {
  bars: number;
  firstDay: string;
  lastDay: string;
  overlay: Metrics;
  buyHold: Metrics;
  overlayPsr: number;
  buyHoldPsr: number;
  /** Downsampled equity curves (normalised to 100 at start) for charting. */
  curve: { t: string; ov: number; bh: number }[];
}

/** Normalise an equity curve to start at 100 and downsample to ~80 points. */
function normCurve(eq: readonly number[], times: number[], step: number): { t: string; v: number }[] {
  const base = eq[0] || 1;
  const out: { t: string; v: number }[] = [];
  for (let i = 0; i < eq.length; i += step) {
    out.push({ t: new Date(times[i]!).toISOString().slice(0, 10), v: Math.round((eq[i]! / base) * 1000) / 10 });
  }
  // always include the last point
  const last = eq.length - 1;
  if ((last % step) !== 0) out.push({ t: new Date(times[last]!).toISOString().slice(0, 10), v: Math.round((eq[last]! / base) * 1000) / 10 });
  return out;
}

/**
 * Run the funding-regime overlay on CMC20: trade the CMC20 index using the
 * basket-funding signal + CMC20's own trend gate. Compare to holding CMC20.
 */
export async function cmc20Overlay(): Promise<OverlayResult> {
  const bars = loadCmc20Bars();
  const signals = buildBasketSignals(bars);
  const overlay = await runStrategy(makeLeverageDivergence({ symbol: "CMC20" }), bars, signals, { symbol: "CMC20" });
  const bh = await runStrategy(makeBuyHold("CMC20"), bars, signals, { symbol: "CMC20" });
  const times = bars.map((b) => b.time);
  const step = Math.max(1, Math.floor(bars.length / 80));
  const ovC = normCurve(overlay.equityCurve, times, step);
  const bhC = normCurve(bh.equityCurve, times, step);
  const curve = ovC.map((p, i) => ({ t: p.t, ov: p.v, bh: bhC[i]?.v ?? p.v }));
  return {
    bars: bars.length,
    firstDay: new Date(bars[0]!.time).toISOString().slice(0, 10),
    lastDay: new Date(bars[bars.length - 1]!.time).toISOString().slice(0, 10),
    overlay: overlay.scorecard.metrics,
    buyHold: bh.scorecard.metrics,
    overlayPsr: probabilisticSharpe(returnsFromEquity(overlay.equityCurve), 0),
    buyHoldPsr: probabilisticSharpe(returnsFromEquity(bh.equityCurve), 0),
    curve,
  };
}
