/**
 * Strategy-spec generator: the bridge between the Skill and the backtest.
 *
 * The SKILL.md tells an agent to read CMC data and "emit a backtestable strategy
 * spec". This module IS that step, executed in real code: it runs the SAME
 * `computeFeatures` the backtester replays over history, but on the latest bar,
 * and emits the exact spec documented in references/strategy-spec-schema.md.
 *
 * One signal brain, two surfaces:
 *   - `npm run spec`     → latest reading → spec JSON (the live deliverable)
 *   - `npm run backtest` → replay history → scorecard (the proof)
 *
 * Input modes:
 *   - default: uses the tail of the committed dataset (BNB) — offline, reproducible.
 *   - live:    pass a CmcSnapshot (e.g. from the CMC MCP tools) to price it now.
 */

import {
  computeFeatures,
  DEFAULT_DIVERGENCE_CONFIG,
  type DivergenceConfig,
  type Features,
} from "./signals/divergence.js";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy/leverage-divergence.js";
import type { Bar, SignalPoint } from "./types.js";

/** A live market snapshot, e.g. assembled from CMC AI Agent Hub MCP tool results. */
export interface CmcSnapshot {
  asset: string;
  /** Recent daily closes, oldest first, ending with the latest. */
  closes: number[];
  /** Recent funding rates aligned to `closes` (8h settlement carried to each bar). */
  funding: number[];
  /** Latest Fear & Greed (0-100), optional. */
  fearGreed?: number;
  /** Latest long/short account ratio, optional. */
  longShortRatio?: number;
  /** Latest open interest, optional. */
  openInterest?: number;
}

export type SignalState = "confirmed-up" | "flush-down" | "neutral";

export interface StrategySpec {
  asset: string;
  as_of: string;
  regime: "risk-on" | "risk-off";
  signal: { state: SignalState; score: number };
  readings: {
    funding_rate: number | null;
    funding_z: number;
    price_return_lookback: number;
    fear_greed: number | null;
    long_short_ratio: number | null;
    open_interest: number | null;
  };
  target_allocation: number;
  rules: Record<string, string | number>;
  risk: { max_drawdown_kill: number; long_only: boolean; fees_bps: number; slippage_bps: number };
  backtest_ref: string;
}

function stateOf(divergence: number, threshold = 0.1): SignalState {
  if (divergence >= threshold) return "confirmed-up";
  if (divergence <= -threshold) return "flush-down";
  return "neutral";
}

/** Build the spec from precomputed Features + the raw inputs that produced them. */
export function specFromFeatures(
  asset: string,
  f: Features,
  rawFunding: number | null,
  asOfIso: string,
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
): StrategySpec {
  return {
    asset,
    as_of: asOfIso,
    regime: f.trendFactor >= 1 ? "risk-on" : "risk-off",
    signal: { state: stateOf(f.divergence), score: round(f.divergence) },
    readings: {
      funding_rate: rawFunding,
      funding_z: round(f.fundingZ),
      price_return_lookback: round(f.pRet),
      fear_greed: f.fearGreed,
      long_short_ratio: f.longShortRatio,
      open_interest: null,
    },
    target_allocation: round(f.target),
    rules: {
      lookback: cfg.lookback,
      z_window: cfg.zWindow,
      z_enter: cfg.zEnter,
      add_when: "funding_z >= +1 and price extended up (leverage-confirmed momentum)",
      trim_when: "funding_z <= -1 and price weak (leverage flush)",
      trend_gate: `if close < SMA(${cfg.trendWindow}): allocation *= ${cfg.riskOffFactor}`,
      crowding: `allocation *= 1 / (1 + ${cfg.crowdK}*|ln(long_short_ratio)|)`,
      base: cfg.base,
      tilt_scale: cfg.tiltScale,
      rebalance_deadband: DEFAULT_STRATEGY_CONFIG.minRebalance,
    },
    risk: { max_drawdown_kill: 0.6, long_only: true, fees_bps: 10, slippage_bps: 5 },
    backtest_ref: "reports/multiasset.csv",
  };
}

/** Emit a spec from a live CMC snapshot using the real signal code. */
export function specFromSnapshot(
  snap: CmcSnapshot,
  asOfIso: string,
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
): StrategySpec | null {
  const signals: (SignalPoint | null)[] = snap.closes.map((_, i) => {
    const p: SignalPoint = {};
    if (snap.funding[i] !== undefined) p.fundingRate = snap.funding[i];
    if (i === snap.closes.length - 1) {
      if (snap.fearGreed !== undefined) p.fearGreed = snap.fearGreed;
      if (snap.longShortRatio !== undefined) p.longShortRatio = snap.longShortRatio;
      if (snap.openInterest !== undefined) p.openInterest = snap.openInterest;
    }
    return Object.keys(p).length ? p : null;
  });
  const f = computeFeatures(snap.closes, signals, cfg);
  if (!f) return null;
  const lastFunding = snap.funding[snap.funding.length - 1] ?? null;
  return specFromFeatures(snap.asset, f, lastFunding, asOfIso, cfg);
}

/** Emit a spec from the tail of a committed dataset (offline, reproducible). */
export function specFromDataset(
  asset: string,
  bars: readonly Bar[],
  signals: readonly (SignalPoint | null)[],
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
): StrategySpec | null {
  const closes = bars.map((b) => b.close);
  const f = computeFeatures(closes, signals, cfg);
  if (!f) return null;
  const lastSig = signals[signals.length - 1];
  const lastFunding = lastSig?.fundingRate ?? null;
  const asOf = new Date(bars[bars.length - 1]!.time).toISOString();
  return specFromFeatures(asset, f, lastFunding, asOf, cfg);
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
