/**
 * Leverage-divergence signal module.
 *
 * The headline mechanism is the divergence between perp **funding** and **price**
 * momentum, not a fixed funding threshold. Two tradable regimes:
 *
 *   - Bullish capitulation: funding is abnormally negative (crowded shorts paying
 *     longs) while price is NOT rallying. Forced shorts + a price that refuses to
 *     fall is the historical local-bottom signature → scale long.
 *   - Bearish exhaustion: price pushes higher while funding momentum fades (the
 *     rally is not backed by fresh leverage demand) → step aside.
 *
 * Around that core sit z-scored overlays (Fear & Greed contrarian tilt, a
 * long/short crowding size-down) so the output is one interpretable target. Each
 * component is independently toggleable, which is what the ablation runner flips.
 *
 * Everything here is a pure function of arrays that end at the current bar, so it
 * cannot look ahead and is trivially unit-testable.
 */

import type { SignalPoint } from "../types.js";

export interface DivergenceConfig {
  /** Lookback (bars) for price momentum and the funding baseline. */
  lookback: number;
  /** Window (bars) for standardising funding readings. */
  zWindow: number;
  /** Price return at or below this counts as "not rallying" for the long branch. */
  priceFlat: number;
  /** Price return at or above this counts as "pushing higher" for the de-risk branch. */
  priceUp: number;
  /** Base long allocation the signals tilt around (0..1). */
  base: number;
  /** How hard the divergence tilt moves allocation around the base. */
  tiltScale: number;
  /** |funding z| must exceed this to arm a capitulation/blowoff branch. */
  zEnter: number;
  /** Divides |z| (beyond zEnter) to map it into [0,1] strength. */
  zScale: number;
  /** Divides price return to map it into [0,1] strength on the price gate. */
  priceScale: number;
  /** Fear & Greed midpoint (contrarian pivot). */
  fngMid: number;
  /** Fear & Greed scale: full tilt at +/- this distance from the midpoint. */
  fngScale: number;
  /** Weight of the Fear & Greed tilt added to the divergence core. */
  fngWeight: number;
  /** Crowding sensitivity: larger = size cut harder as the long/short ratio skews. */
  crowdK: number;
  /** Trend filter window (bars) for the risk-on/off regime gate. */
  trendWindow: number;
  /** Allocation multiplier when price is below its trend (risk-off). */
  riskOffFactor: number;
  /** Toggle the divergence core (off = pure funding contrarian). */
  useDivergence: boolean;
  /** Toggle the Fear & Greed tilt. */
  useFng: boolean;
  /** Toggle the crowding size-down. */
  useCrowding: boolean;
  /** Toggle the trend regime gate. */
  useTrend: boolean;
}

export const DEFAULT_DIVERGENCE_CONFIG: DivergenceConfig = {
  lookback: 7,
  zWindow: 30,
  priceFlat: 0,
  priceUp: 0.05,
  base: 0.5,
  tiltScale: 0.5,
  zEnter: 1.0,
  zScale: 1.5,
  priceScale: 0.15,
  fngMid: 50,
  fngScale: 50,
  fngWeight: 0.15,
  crowdK: 0.7,
  trendWindow: 100,
  riskOffFactor: 0.2,
  useDivergence: true,
  // Fear & Greed is OFF by default: the ablation shows it does not improve the
  // funding-divergence core on this data, so the honest default leaves it out.
  useFng: false,
  useCrowding: true,
  useTrend: true,
};

export interface Features {
  /** Price return over the lookback window. */
  pRet: number;
  /** z-score of the current funding rate vs its recent window. */
  fundingZ: number;
  /** z-score of funding momentum (now minus recent baseline). */
  fundingChgZ: number;
  /** Fear & Greed reading carried as-of the bar (or null). */
  fearGreed: number | null;
  /** Long/short ratio carried as-of the bar (or null). */
  longShortRatio: number | null;
  /** Leverage signal in [-1, 1] (+ = funding-confirmed momentum/add, - = leverage flush/trim). */
  divergence: number;
  /** Fear & Greed contrarian tilt in [-1, 1]. */
  fngTilt: number;
  /** Crowding size multiplier in (0, 1]. */
  crowdingSize: number;
  /** Trend regime multiplier: 1 when risk-on, riskOffFactor when below trend. */
  trendFactor: number;
  /** base + divergence tilt + Fear&Greed tilt, before clamp/sizing. */
  combined: number;
  /** Long-only target equity fraction in [0, 1]. */
  target: number;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/** z-score of `x` against the distribution `xs`. Returns 0 when there is no spread. */
export function zscore(x: number, xs: readonly number[]): number {
  const sd = std(xs);
  if (sd === 0) return 0;
  return (x - mean(xs)) / sd;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
const clamp01 = (x: number): number => clamp(x, 0, 1);

/** Last non-null value of `field` across the aligned signal series, or null. */
function lastSignal(
  signals: readonly (SignalPoint | null)[],
  field: keyof SignalPoint,
): number | null {
  for (let i = signals.length - 1; i >= 0; i--) {
    const v = signals[i]?.[field];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

/** Collected funding-rate series (gaps dropped), oldest first. */
function fundingSeries(signals: readonly (SignalPoint | null)[]): number[] {
  const out: number[] = [];
  for (const s of signals) {
    const f = s?.fundingRate;
    if (f !== undefined && f !== null) out.push(f);
  }
  return out;
}

/**
 * Compute features at the LAST element of the given series. `closes` and
 * `signals` are index-aligned and end at the current bar. Returns null when
 * there is not enough history to standardise.
 */
export function computeFeatures(
  closes: readonly number[],
  signals: readonly (SignalPoint | null)[],
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
): Features | null {
  const n = closes.length;
  if (n <= Math.max(cfg.lookback, cfg.zWindow)) return null;

  // Price momentum over the lookback.
  const cNow = closes[n - 1]!;
  const cPast = closes[n - 1 - cfg.lookback]!;
  if (cPast <= 0) return null;
  const pRet = cNow / cPast - 1;

  // Funding standardisation needs a populated window.
  const fund = fundingSeries(signals);
  if (fund.length <= Math.max(cfg.lookback, cfg.zWindow)) return null;
  const fNow = fund[fund.length - 1]!;
  const fWindow = fund.slice(-cfg.zWindow - 1, -1); // strictly prior window
  const fundingZ = zscore(fNow, fWindow);

  // Funding momentum: now minus the recent baseline, standardised by the window.
  const fBaseline = mean(fund.slice(-cfg.lookback - 1, -1));
  const fChg = fNow - fBaseline;
  const fundingChgZ = zscore(fChg, fWindow.map((v) => v - fBaseline));

  // --- Leverage signal, the funding x price interaction, tilt in [-1, 1] ---
  // The event study (references/backtest-results.md) shows the popular contrarian
  // reading is BACKWARDS at daily horizon: leverage-CONFIRMED momentum predicts,
  // capitulation does not bounce. So the score is positive when funding and price
  // AGREE (confirmed up) and negative when leverage flushes into weakness.
  //   confirmedUp (+): funding abnormally POSITIVE (leverage building) and price
  //     extended up => ride it.
  //   flushDown (-): funding abnormally NEGATIVE (leverage giving up) and price
  //     weak => step aside.
  // The `contrarian` ablation flips the tilt and underperforms, which is the proof.
  let divergence = 0;
  if (cfg.useDivergence) {
    const sNeg = clamp01((-fundingZ - cfg.zEnter) / cfg.zScale); // arms once fundingZ <= -zEnter
    const sPos = clamp01((fundingZ - cfg.zEnter) / cfg.zScale); //  arms once fundingZ >= +zEnter
    const priceWeak = clamp01((cfg.priceFlat - pRet) / cfg.priceScale + 0.5);
    const priceHot = clamp01((pRet - cfg.priceUp) / cfg.priceScale + 0.5);
    const confirmedUp = sPos * priceHot;
    const flushDown = sNeg * priceWeak;
    divergence = clamp(confirmedUp - flushDown, -1, 1);
  }
  // useDivergence=false leaves divergence at 0: the funding signal is fully
  // removed, so the ablation honestly measures the funding signal's contribution.

  // --- Fear & Greed contrarian tilt ---
  const fearGreed = lastSignal(signals, "fearGreed");
  let fngTilt = 0;
  if (cfg.useFng && fearGreed !== null) {
    fngTilt = clamp((cfg.fngMid - fearGreed) / cfg.fngScale, -1, 1);
  }

  // --- Crowding size-down ---
  const longShortRatio = lastSignal(signals, "longShortRatio");
  let crowdingSize = 1;
  if (cfg.useCrowding && longShortRatio !== null && longShortRatio > 0) {
    crowdingSize = 1 / (1 + cfg.crowdK * Math.abs(Math.log(longShortRatio)));
  }

  // Allocation = base + divergence tilt + Fear&Greed tilt, then crowding size-down.
  const combined =
    cfg.base + cfg.tiltScale * divergence + (cfg.useFng ? cfg.fngWeight * fngTilt : 0);

  // Trend regime gate: don't fight the primary trend. Below the long MA, cut the
  // contrarian book to riskOffFactor so capitulation buys aren't knife-catches in
  // a structural downtrend. Inactive until enough bars exist to form the MA.
  let trendFactor = 1;
  if (cfg.useTrend && n > cfg.trendWindow) {
    const sma = mean(closes.slice(n - cfg.trendWindow));
    if (cNow < sma) trendFactor = cfg.riskOffFactor;
  }

  const target = clamp01(combined) * crowdingSize * trendFactor;

  return {
    pRet,
    fundingZ,
    fundingChgZ,
    fearGreed,
    longShortRatio,
    divergence,
    fngTilt,
    crowdingSize,
    trendFactor,
    combined,
    target,
  };
}
