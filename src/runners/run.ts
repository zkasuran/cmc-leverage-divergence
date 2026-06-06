/**
 * Runner helpers: execute a strategy over a dataset, segment performance by year
 * (out-of-sample by construction, since no parameters are fit to the data), and
 * assemble the ablation set that isolates each signal's contribution.
 */

import { runBacktest, type RunResult } from "../engine/backtest.js";
import { hashDataset } from "../report/emit.js";
import type {
  Bar,
  SignalPoint,
  EngineConfig,
  RiskPolicy,
  StrategyAgent,
  Granularity,
} from "../types.js";
import { makeLeverageDivergence } from "../strategy/leverage-divergence.js";
import { DEFAULT_DIVERGENCE_CONFIG } from "../signals/divergence.js";
import { makeBuyHold } from "../baselines/buy-hold.js";
import { makeFngOnly } from "../baselines/fng-only.js";
import rsiMeanrev from "../strategies/rsi-meanrev.js";

export const DEFAULT_ENGINE: EngineConfig = {
  startingEquity: 10_000,
  feeBps: 10, // 0.1% spot taker
  slippageBps: 5,
  seed: 42,
};

// Long-only spot: a wide kill-switch only guards against pathological blowups.
export const DEFAULT_RISK: RiskPolicy = { maxDrawdownKill: 0.6 };

export interface RunOpts {
  config?: Partial<EngineConfig>;
  risk?: RiskPolicy;
  symbol?: string;
  granularity?: Granularity;
}

export async function runStrategy(
  agent: StrategyAgent,
  bars: readonly Bar[],
  signals: readonly (SignalPoint | null)[] | undefined,
  opts: RunOpts = {},
): Promise<RunResult> {
  const config = { ...DEFAULT_ENGINE, ...(opts.config ?? {}) };
  const risk = opts.risk ?? DEFAULT_RISK;
  return runBacktest({
    agent,
    bars,
    signals,
    config,
    risk,
    manifest: {
      agentbenchVersion: "0.1.0",
      symbol: opts.symbol ?? "BTCUSDT",
      granularity: opts.granularity ?? "1day",
      source: "binance-cmc",
      bars: bars.length,
      firstBarTime: bars[0]!.time,
      lastBarTime: bars[bars.length - 1]!.time,
      datasetSha256: hashDataset(bars),
    },
  });
}

export interface YearRow {
  year: number;
  startEquity: number;
  endEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
}

/** Segment the equity curve by calendar year (UTC). equity[i] marks bars[i]. */
export function perYear(equity: readonly number[], bars: readonly Bar[]): YearRow[] {
  const rows = new Map<number, { idxs: number[] }>();
  const n = Math.min(equity.length, bars.length);
  for (let i = 0; i < n; i++) {
    const y = new Date(bars[i]!.time).getUTCFullYear();
    if (!rows.has(y)) rows.set(y, { idxs: [] });
    rows.get(y)!.idxs.push(i);
  }
  const out: YearRow[] = [];
  for (const [year, { idxs }] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const seg = idxs.map((i) => equity[i]!);
    const startEquity = seg[0]!;
    const endEquity = seg[seg.length - 1]!;
    let peak = seg[0]!;
    let maxDd = 0;
    for (const e of seg) {
      if (e > peak) peak = e;
      const dd = (peak - e) / peak;
      if (dd > maxDd) maxDd = dd;
    }
    out.push({
      year,
      startEquity,
      endEquity,
      returnPct: (endEquity / startEquity - 1) * 100,
      maxDrawdownPct: maxDd * 100,
    });
  }
  return out;
}

export interface Variant {
  label: string;
  agent: StrategyAgent;
}

/** Full strategy, each ablation, and the baselines. */
export function ablationSet(): Variant[] {
  return [
    { label: "headline", agent: makeLeverageDivergence() },
    { label: "contrarian", agent: makeLeverageDivergence({ divergence: { tiltScale: -DEFAULT_DIVERGENCE_CONFIG.tiltScale } }) },
    { label: "no-divergence", agent: makeLeverageDivergence({ divergence: { useDivergence: false } }) },
    { label: "no-trend", agent: makeLeverageDivergence({ divergence: { useTrend: false } }) },
    { label: "no-crowding", agent: makeLeverageDivergence({ divergence: { useCrowding: false } }) },
    { label: "plus-fng", agent: makeLeverageDivergence({ divergence: { useFng: true } }) },
    { label: "baseline:buy-hold", agent: makeBuyHold() },
    { label: "baseline:fng-only", agent: makeFngOnly() },
    { label: "baseline:rsi-meanrev", agent: rsiMeanrev },
  ];
}
