/**
 * Cross-asset, cost-sensitivity and event-study analyses. These are the
 * rigour layer: prove the funding-divergence edge generalises across assets,
 * survives higher costs, and that the signal itself predicts forward returns
 * (decoupled from the strategy).
 */

import { loadDataset, ASSETS } from "../data/loaders.js";
import { runStrategy, ablationSet } from "./run.js";
import { makeLeverageDivergence } from "../strategy/leverage-divergence.js";
import { makeBuyHold } from "../baselines/buy-hold.js";
import { computeFeatures, DEFAULT_DIVERGENCE_CONFIG, type DivergenceConfig } from "../signals/divergence.js";
import {
  returnsFromEquity,
  sharpePerPeriod,
  probabilisticSharpe,
  deflatedSharpe,
} from "../engine/stats.js";
import type { Bar, SignalPoint, Metrics } from "../types.js";

export interface AssetResult {
  prefix: string;
  symbol: string;
  bars: number;
  headline: Metrics;
  buyHold: Metrics;
  /** Headline Sharpe with the funding signal turned OFF (trend gate only). */
  fundingOffSharpe: number;
  /** Probabilistic Sharpe (P true Sharpe > 0), accounts for skew/kurtosis. */
  psr: number;
  /** Deflated Sharpe (P true Sharpe > expected-max across the ablation trials). */
  dsr: number;
}

/** Run the headline strategy + buy-hold on one asset, with PSR/DSR. */
export async function runAsset(prefix: string, symbol: string): Promise<AssetResult> {
  const { bars, signals } = loadDataset(prefix);
  const head = await runStrategy(makeLeverageDivergence({ symbol }), bars, signals, { symbol });
  const bh = await runStrategy(makeBuyHold(symbol), bars, signals, { symbol });
  const fundingOff = await runStrategy(
    makeLeverageDivergence({ symbol, divergence: { useDivergence: false } }),
    bars,
    signals,
    { symbol },
  );

  // Trial Sharpes for the deflation = every ablation variant on this asset.
  const trialSharpes: number[] = [];
  for (const v of ablationSet()) {
    const r = await runStrategy(v.agent, bars, signals, { symbol });
    trialSharpes.push(sharpePerPeriod(returnsFromEquity(r.equityCurve)));
  }
  const headRets = returnsFromEquity(head.equityCurve);

  return {
    prefix,
    symbol,
    bars: bars.length,
    headline: head.scorecard.metrics,
    buyHold: bh.scorecard.metrics,
    fundingOffSharpe: fundingOff.scorecard.metrics.sharpe,
    psr: probabilisticSharpe(headRets, 0),
    dsr: deflatedSharpe(headRets, trialSharpes),
  };
}

/** Headline vs buy-hold across every asset. */
export async function crossAsset(): Promise<AssetResult[]> {
  const out: AssetResult[] = [];
  for (const a of ASSETS) out.push(await runAsset(a.prefix, a.symbol));
  return out;
}

export interface CostRow {
  feeBps: number;
  slippageBps: number;
  returnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
}

/** Headline strategy at 1x / 2x / 3x the base trading costs. */
export async function costSensitivity(prefix: string, symbol: string): Promise<CostRow[]> {
  const { bars, signals } = loadDataset(prefix);
  const out: CostRow[] = [];
  for (const mult of [1, 2, 3]) {
    const feeBps = 10 * mult;
    const slippageBps = 5 * mult;
    const r = await runStrategy(makeLeverageDivergence({ symbol }), bars, signals, {
      symbol,
      config: { feeBps, slippageBps },
    });
    const m = r.scorecard.metrics;
    out.push({ feeBps, slippageBps, returnPct: m.totalReturnPct, maxDrawdownPct: m.maxDrawdownPct, sharpe: m.sharpe });
  }
  return out;
}

export type DivState = "confirmed-up" | "flush-down" | "neutral";

export interface EventStat {
  state: DivState;
  horizonDays: number;
  n: number;
  meanForwardPct: number;
  hitRatePct: number;
}

/**
 * Signal event study: classify each bar by divergence state, then measure the
 * realised FORWARD return. This deliberately uses future prices — it answers
 * "does the signal carry predictive information?", separate from any strategy.
 */
export function eventStudy(
  bars: readonly Bar[],
  signals: readonly (SignalPoint | null)[],
  horizons: number[] = [7, 30],
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
  threshold = 0.1,
): EventStat[] {
  const closes = bars.map((b) => b.close);
  const states: DivState[] = [];
  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(closes.slice(0, i + 1), signals.slice(0, i + 1), cfg);
    if (f === null) states.push("neutral");
    else if (f.divergence >= threshold) states.push("confirmed-up");
    else if (f.divergence <= -threshold) states.push("flush-down");
    else states.push("neutral");
  }

  const out: EventStat[] = [];
  for (const h of horizons) {
    for (const state of ["confirmed-up", "flush-down", "neutral"] as DivState[]) {
      const fwd: number[] = [];
      for (let i = 0; i + h < bars.length; i++) {
        if (states[i] !== state) continue;
        fwd.push(closes[i + h]! / closes[i]! - 1);
      }
      const n = fwd.length;
      const mean = n ? fwd.reduce((a, b) => a + b, 0) / n : 0;
      const wins = fwd.filter((x) => x > 0).length;
      out.push({
        state,
        horizonDays: h,
        n,
        meanForwardPct: mean * 100,
        hitRatePct: n ? (wins / n) * 100 : 0,
      });
    }
  }
  return out;
}
