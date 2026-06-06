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

import { loadCmc20Bars } from "../data/cmc-loader.js";
import { loadDataset, ASSETS } from "../data/loaders.js";
import { runStrategy } from "./run.js";
import { makeLeverageDivergence } from "../strategy/leverage-divergence.js";
import { makeBuyHold } from "../baselines/buy-hold.js";
import { asOf } from "../data/loaders.js";
import { returnsFromEquity, probabilisticSharpe } from "../engine/stats.js";
import type { Bar, SignalPoint, Metrics } from "../types.js";

/** Constituents of CMC20 that have liquid perp funding markets. */
const CONSTITUENTS = ["btc", "eth", "bnb", "sol"];

interface Series {
  time: number;
  value: number;
}

/**
 * Build a basket funding series aligned to CMC20 bars: at each CMC20 bar, average
 * the most-recent funding rate of each constituent (as-of that bar's open, so no
 * lookahead). The basket's Fear & Greed is global, carried straight through.
 */
export function buildBasketSignals(
  cmc20Bars: readonly Bar[],
): (SignalPoint | null)[] {
  // Collect each constituent's funding series + the (shared, global) F&G series.
  const fundingByAsset: Series[][] = [];
  let fng: Series[] = [];
  for (const prefix of CONSTITUENTS) {
    const { bars, signals } = loadDataset(prefix);
    const series: Series[] = [];
    for (let i = 0; i < bars.length; i++) {
      const f = signals[i]?.fundingRate;
      if (f !== undefined) series.push({ time: bars[i]!.time, value: f });
    }
    fundingByAsset.push(series);
    if (fng.length === 0) {
      fng = bars
        .map((b, i) => ({ time: b.time, value: signals[i]?.fearGreed }))
        .filter((x): x is Series => x.value !== undefined);
    }
  }

  return cmc20Bars.map((bar) => {
    const fundings: number[] = [];
    for (const series of fundingByAsset) {
      const v = asOf(series, bar.time);
      if (v !== null) fundings.push(v);
    }
    const point: SignalPoint = {};
    if (fundings.length > 0) {
      point.fundingRate = fundings.reduce((a, b) => a + b, 0) / fundings.length;
    }
    const g = asOf(fng, bar.time);
    if (g !== null) point.fearGreed = g;
    return Object.keys(point).length > 0 ? point : null;
  });
}

export interface OverlayResult {
  bars: number;
  firstDay: string;
  lastDay: string;
  overlay: Metrics;
  buyHold: Metrics;
  overlayPsr: number;
  buyHoldPsr: number;
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
  return {
    bars: bars.length,
    firstDay: new Date(bars[0]!.time).toISOString().slice(0, 10),
    lastDay: new Date(bars[bars.length - 1]!.time).toISOString().slice(0, 10),
    overlay: overlay.scorecard.metrics,
    buyHold: bh.scorecard.metrics,
    overlayPsr: probabilisticSharpe(returnsFromEquity(overlay.equityCurve), 0),
    buyHoldPsr: probabilisticSharpe(returnsFromEquity(bh.equityCurve), 0),
  };
}
