/**
 * Placebo (label-shuffle / permutation) null test for the funding-confirmation
 * finding.
 *
 * The headline claim is causal: the funding x price divergence state at a bar
 * predicts the FORWARD return, so confirmed-up beats flush-down at the 30-day
 * horizon (the event study). The skeptical question is "would ANY signal with the
 * same shape produce that spread? is it just price momentum, or an artifact of one
 * window?"
 *
 * This answers it by permutation. We keep the price path exactly as it is and
 * shuffle the funding series across time, breaking the funding<->price alignment
 * while preserving funding's own distribution. Then we recompute the same
 * confirmed-up - flush-down spread on each shuffle, building a null distribution.
 * Because the price-momentum gate still fires under the shuffle, the null is NOT
 * zero: it is what price momentum alone earns with random funding. If the real
 * spread sits in the right tail of that null (low p), funding carries forward
 * information BEYOND momentum. If it does not, the finding is not real and we say so.
 *
 * Pooling: the finding is cross-asset, so the headline test pools the forward
 * returns of every liquid constituent and shuffles each asset's funding
 * independently. Per-asset numbers are reported too — the honest picture is that
 * funding passes where leverage is liquid (ETH/SOL/DOGE) and is absorbed by
 * momentum or the trend gate elsewhere (BNB/BTC and thin-funding alts).
 *
 * Deterministic: the shuffle uses the repo's seeded RNG, so the same seed always
 * produces the same null distribution and the same p-value. Pure except for the
 * RNG; no I/O.
 *
 * Performance: state classification reuses the real `computeFeatures`, but over a
 * bounded trailing window (the signal only reads the last trendWindow/zWindow/
 * lookback bars), so a shuffle pass is O(bars * window) not O(bars^2). The
 * windowed states are byte-identical to the full-prefix event study; a unit test
 * pins that equality.
 */

import type { Bar, SignalPoint } from "../types.js";
import { SeededRng } from "../engine/rng.js";
import {
  computeFeatures,
  DEFAULT_DIVERGENCE_CONFIG,
  type DivergenceConfig,
} from "../signals/divergence.js";

export type DivState = "confirmed-up" | "flush-down" | "neutral";

/**
 * Trailing window (bars) handed to computeFeatures per bar. It must cover the
 * longest lookback the signal reads (trendWindow) plus the funding/price windows,
 * so the windowed features equal the full-prefix features exactly.
 */
function windowSize(cfg: DivergenceConfig): number {
  return Math.max(cfg.trendWindow, cfg.zWindow, cfg.lookback) + cfg.zWindow + cfg.lookback + 5;
}

/**
 * Per-bar divergence state, classified from PAST+current data only (no lookahead).
 * Equivalent to the event-study classification in analysis.ts, but windowed for
 * speed so the permutation loop is tractable.
 */
export function divergenceStates(
  bars: readonly Bar[],
  signals: readonly (SignalPoint | null)[],
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
  threshold = 0.1,
): DivState[] {
  const closes = bars.map((b) => b.close);
  const W = windowSize(cfg);
  const states: DivState[] = [];
  for (let i = 0; i < bars.length; i++) {
    const lo = Math.max(0, i + 1 - W);
    const f = computeFeatures(closes.slice(lo, i + 1), signals.slice(lo, i + 1), cfg);
    if (f === null) states.push("neutral");
    else if (f.divergence >= threshold) states.push("confirmed-up");
    else if (f.divergence <= -threshold) states.push("flush-down");
    else states.push("neutral");
  }
  return states;
}

/** Forward returns (fraction) grouped by state at the given horizon. */
function forwardReturnsByState(
  bars: readonly Bar[],
  states: readonly DivState[],
  horizonDays: number,
): Record<DivState, number[]> {
  const closes = bars.map((b) => b.close);
  const out: Record<DivState, number[]> = { "confirmed-up": [], "flush-down": [], neutral: [] };
  for (let i = 0; i + horizonDays < bars.length; i++) {
    out[states[i]!]!.push(closes[i + horizonDays]! / closes[i]! - 1);
  }
  return out;
}

const meanPct = (xs: readonly number[]): number =>
  xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * 100 : 0;

/**
 * The event-study spread for one asset: mean forward return of confirmed-up minus
 * flush-down at one horizon, in percentage points, plus the raw forward-return
 * arrays so callers can pool across assets. Returns null when either bucket is
 * thinner than `minBucket`.
 */
export function confirmedFlushSpread(
  bars: readonly Bar[],
  signals: readonly (SignalPoint | null)[],
  horizonDays: number,
  cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG,
  threshold = 0.1,
  minBucket = 5,
): { spreadPct: number; upPct: number; flushPct: number; up: number[]; flush: number[] } | null {
  const states = divergenceStates(bars, signals, cfg, threshold);
  const fwd = forwardReturnsByState(bars, states, horizonDays);
  const up = fwd["confirmed-up"];
  const flush = fwd["flush-down"];
  if (up.length < minBucket || flush.length < minBucket) return null;
  return { spreadPct: meanPct(up) - meanPct(flush), upPct: meanPct(up), flushPct: meanPct(flush), up, flush };
}

/**
 * Permute the non-null funding readings across the positions that carry them.
 * Positions without funding stay null; every other signal field is preserved.
 * Fisher-Yates with a seeded RNG, so the permutation is reproducible.
 */
export function shuffleFundingSignals(
  signals: readonly (SignalPoint | null)[],
  rng: SeededRng,
): (SignalPoint | null)[] {
  const idx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < signals.length; i++) {
    const f = signals[i]?.fundingRate;
    if (f !== undefined && f !== null) {
      idx.push(i);
      vals.push(f);
    }
  }
  for (let i = vals.length - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    const t = vals[i]!;
    vals[i] = vals[j]!;
    vals[j] = t;
  }
  const out: (SignalPoint | null)[] = signals.map((s) => (s ? { ...s } : null));
  for (let k = 0; k < idx.length; k++) {
    const at = idx[k]!;
    out[at] = { ...(out[at] ?? {}), fundingRate: vals[k]! };
  }
  return out;
}

/** Nearest-rank percentile of a sorted-ascending array. */
function percentile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(q * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, rank))]!;
}

/** The non-null funding readings, in time order. */
function fundingValues(signals: readonly (SignalPoint | null)[]): number[] {
  const vals: number[] = [];
  for (const s of signals) {
    const f = s?.fundingRate;
    if (f !== undefined && f !== null) vals.push(f);
  }
  return vals;
}

/**
 * Unbiased integer in [0, n) from the seeded RNG (rejection sampling), so block
 * shuffling and rotation do not inherit the modulo bias of `nextU32() % n`.
 */
function randInt(rng: SeededRng, n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x = rng.nextU32();
  while (x >= limit) x = rng.nextU32();
  return x % n;
}

/**
 * Block length for the circular block permutation: the autocorrelation e-folding
 * lag of the funding series (the first lag where the normalised autocorrelation
 * drops below 1/e). Funding rates are persistent, so this is the horizon over
 * which a permutation must keep funding values together to preserve that
 * persistence. Clamped to [2, n/4] so a block is never degenerate or the whole
 * series.
 */
export function autocorrLength(vals: readonly number[]): number {
  const n = vals.length;
  if (n < 8) return Math.max(1, Math.min(n - 1, 2));
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  let c0 = 0;
  for (const v of vals) c0 += (v - mean) * (v - mean);
  c0 /= n;
  if (c0 === 0) return 2;
  const maxLag = Math.floor(n / 4);
  const threshold = 1 / Math.E;
  for (let lag = 1; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = lag; i < n; i++) c += (vals[i]! - mean) * (vals[i - lag]! - mean);
    c /= n;
    if (c / c0 < threshold) return Math.max(2, lag);
  }
  return Math.max(2, maxLag);
}

/**
 * Circular block permutation of a series: rotate by a random offset, cut into
 * consecutive blocks of length `blockLen`, shuffle the block order, concatenate.
 * Within-block ordering (so most of the autocorrelation up to `blockLen`) is
 * preserved, while the alignment of the series with anything else is randomised.
 */
function blockPermute(vals: readonly number[], rng: SeededRng, blockLen: number): number[] {
  const n = vals.length;
  if (n <= 1) return [...vals];
  const L = Math.max(1, Math.min(blockLen, n));
  if (L >= n) {
    // One block cannot be reordered; a pure circular rotation still breaks the
    // funding<->price alignment while preserving autocorrelation exactly.
    const rot = 1 + randInt(rng, n - 1);
    return Array.from({ length: n }, (_, i) => vals[(i + rot) % n]!);
  }
  const rot = randInt(rng, n);
  const rotated = Array.from({ length: n }, (_, i) => vals[(i + rot) % n]!);
  const blocks: number[][] = [];
  for (let s = 0; s < n; s += L) blocks.push(rotated.slice(s, Math.min(s + L, n)));
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = blocks[i]!;
    blocks[i] = blocks[j]!;
    blocks[j] = t;
  }
  const out: number[] = [];
  for (const b of blocks) out.push(...b);
  return out.slice(0, n);
}

/**
 * Circular block permutation of the funding series, the autocorrelation-preserving
 * null. Unlike the i.i.d. shuffle, it keeps funding's serial correlation intact and
 * only randomises its alignment with price, so a persistent funding series is
 * compared against an equally persistent null. This is the stricter, primary null.
 */
export function blockPermuteFundingSignals(
  signals: readonly (SignalPoint | null)[],
  rng: SeededRng,
  blockLen: number,
): (SignalPoint | null)[] {
  const idx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < signals.length; i++) {
    const f = signals[i]?.fundingRate;
    if (f !== undefined && f !== null) {
      idx.push(i);
      vals.push(f);
    }
  }
  const permuted = blockPermute(vals, rng, blockLen);
  const out: (SignalPoint | null)[] = signals.map((s) => (s ? { ...s } : null));
  for (let k = 0; k < idx.length; k++) {
    const at = idx[k]!;
    out[at] = { ...(out[at] ?? {}), fundingRate: permuted[k]! };
  }
  return out;
}

/** The funding permutation for a null kind: i.i.d. label shuffle or block permutation. */
export type NullKind = "iid" | "block";

export interface PlaceboOptions {
  horizonDays?: number;
  nShuffles?: number;
  seed?: number;
  threshold?: number;
  minBucket?: number;
  /** Null model: "block" (autocorrelation-preserving, primary) or "iid" (label shuffle). */
  nullKind?: NullKind;
  /** Block length for the "block" null. Defaults to the funding autocorrelation length. */
  blockLen?: number;
}

export interface PlaceboResult {
  horizonDays: number;
  nShuffles: number;
  validShuffles: number;
  seed: number;
  realSpreadPct: number;
  realUpPct: number;
  realFlushPct: number;
  nullMeanPct: number;
  nullP95Pct: number;
  /** Permutation p-value: P(null spread >= real spread). */
  pValue: number;
  /** Real spread clears the null 95th percentile and the p-value is < 0.05. */
  passed: boolean;
  /** Which null produced this result. */
  nullKind: NullKind;
  /** Block length used for the "block" null (0 for the i.i.d. null). */
  blockLen: number;
}

/** One labelled dataset for the pooled test. */
export interface NamedDataset {
  symbol: string;
  bars: readonly Bar[];
  signals: readonly (SignalPoint | null)[];
}

/** Summarise a real value against a collected null distribution. */
function summariseNull(realSpread: number, nullSpreads: number[], nShuffles: number, seed: number, horizonDays: number, up: number, flush: number, nullKind: NullKind, blockLen: number): PlaceboResult {
  nullSpreads.sort((a, b) => a - b);
  const validShuffles = nullSpreads.length;
  const atLeast = nullSpreads.filter((x) => x >= realSpread).length;
  const nullMeanPct = validShuffles ? nullSpreads.reduce((a, b) => a + b, 0) / validShuffles : 0;
  const nullP95Pct = percentile(nullSpreads, 0.95);
  // Phipson & Smyth (2010) unbiased permutation p-value: (1 + #ge) / (1 + N).
  const pValue = (1 + atLeast) / (1 + validShuffles);
  return {
    horizonDays,
    nShuffles,
    validShuffles,
    seed,
    realSpreadPct: realSpread,
    realUpPct: up,
    realFlushPct: flush,
    nullMeanPct,
    nullP95Pct,
    pValue,
    passed: realSpread > nullP95Pct && pValue < 0.05,
    nullKind,
    blockLen,
  };
}

/**
 * The pooled REAL spread only (no shuffling), for the verifier: deterministic and
 * fast, so `npm run verify` can re-derive the headline placebo number without
 * re-running the permutation. Throws when the pooled buckets are too thin.
 */
export function pooledRealSpread(
  datasets: readonly NamedDataset[],
  opts: PlaceboOptions = {},
): { spreadPct: number; upPct: number; flushPct: number; nUp: number; nFlush: number } {
  const horizonDays = opts.horizonDays ?? 30;
  const threshold = opts.threshold ?? 0.1;
  const minBucket = opts.minBucket ?? 5;
  const up: number[] = [];
  const flush: number[] = [];
  for (const d of datasets) {
    const r = confirmedFlushSpread(d.bars, d.signals, horizonDays, DEFAULT_DIVERGENCE_CONFIG, threshold, minBucket);
    if (r === null) continue;
    up.push(...r.up);
    flush.push(...r.flush);
  }
  if (up.length < minBucket || flush.length < minBucket) {
    throw new Error("placebo(pooledRealSpread): too few confirmed-up/flush-down bars");
  }
  return { spreadPct: meanPct(up) - meanPct(flush), upPct: meanPct(up), flushPct: meanPct(flush), nUp: up.length, nFlush: flush.length };
}

/** Single-asset permutation test. */
export function placeboTest(
  bars: readonly Bar[],
  signals: readonly (SignalPoint | null)[],
  opts: PlaceboOptions = {},
): PlaceboResult {
  const horizonDays = opts.horizonDays ?? 30;
  const nShuffles = opts.nShuffles ?? 500;
  const seed = opts.seed ?? 20260618;
  const threshold = opts.threshold ?? 0.1;
  const minBucket = opts.minBucket ?? 5;

  const nullKind: NullKind = opts.nullKind ?? "iid";

  const real = confirmedFlushSpread(bars, signals, horizonDays, DEFAULT_DIVERGENCE_CONFIG, threshold, minBucket);
  if (real === null) throw new Error("placebo: too few confirmed-up/flush-down bars to form a spread");

  const blockLen = nullKind === "block" ? (opts.blockLen ?? autocorrLength(fundingValues(signals))) : 0;
  const permute = (sig: readonly (SignalPoint | null)[], rng: SeededRng): (SignalPoint | null)[] =>
    nullKind === "block" ? blockPermuteFundingSignals(sig, rng, blockLen) : shuffleFundingSignals(sig, rng);

  const rng = new SeededRng(seed);
  const nullSpreads: number[] = [];
  for (let s = 0; s < nShuffles; s++) {
    const shuffled = permute(signals, rng);
    const r = confirmedFlushSpread(bars, shuffled, horizonDays, DEFAULT_DIVERGENCE_CONFIG, threshold, minBucket);
    if (r !== null) nullSpreads.push(r.spreadPct);
  }
  return summariseNull(real.spreadPct, nullSpreads, nShuffles, seed, horizonDays, real.upPct, real.flushPct, nullKind, blockLen);
}

/**
 * Pooled permutation test across several assets: concatenate the confirmed-up and
 * flush-down forward returns from every asset into one pooled spread, then shuffle
 * EACH asset's funding independently per iteration and recompute the pooled spread.
 * This tests the cross-asset finding directly, which is the form the README claims.
 */
export function pooledPlaceboTest(datasets: readonly NamedDataset[], opts: PlaceboOptions = {}): PlaceboResult {
  const horizonDays = opts.horizonDays ?? 30;
  const nShuffles = opts.nShuffles ?? 500;
  const seed = opts.seed ?? 20260618;
  const threshold = opts.threshold ?? 0.1;
  const minBucket = opts.minBucket ?? 5;

  const pooledSpread = (sigs: readonly (readonly (SignalPoint | null)[])[]): { spread: number; up: number; flush: number } | null => {
    const up: number[] = [];
    const flush: number[] = [];
    for (let d = 0; d < datasets.length; d++) {
      const r = confirmedFlushSpread(datasets[d]!.bars, sigs[d]!, horizonDays, DEFAULT_DIVERGENCE_CONFIG, threshold, minBucket);
      if (r === null) continue;
      up.push(...r.up);
      flush.push(...r.flush);
    }
    if (up.length < minBucket || flush.length < minBucket) return null;
    return { spread: meanPct(up) - meanPct(flush), up: meanPct(up), flush: meanPct(flush) };
  };

  const nullKind: NullKind = opts.nullKind ?? "iid";

  const real = pooledSpread(datasets.map((d) => d.signals));
  if (real === null) throw new Error("placebo(pooled): too few confirmed-up/flush-down bars to form a spread");

  // Each asset's funding is permuted independently, with its own block length so
  // the null preserves each asset's own funding persistence. The pooled blockLen
  // reported is the median across assets (per-asset lengths are in `perAsset`).
  const blockLens = datasets.map((d) => (nullKind === "block" ? (opts.blockLen ?? autocorrLength(fundingValues(d.signals))) : 0));
  const sortedLens = [...blockLens].sort((a, b) => a - b);
  const medianBlockLen = sortedLens.length ? sortedLens[Math.floor(sortedLens.length / 2)]! : 0;
  const permute = (sig: readonly (SignalPoint | null)[], rng: SeededRng, i: number): (SignalPoint | null)[] =>
    nullKind === "block" ? blockPermuteFundingSignals(sig, rng, blockLens[i]!) : shuffleFundingSignals(sig, rng);

  const rng = new SeededRng(seed);
  const nullSpreads: number[] = [];
  for (let s = 0; s < nShuffles; s++) {
    const shuffled = datasets.map((d, i) => permute(d.signals, rng, i));
    const r = pooledSpread(shuffled);
    if (r !== null) nullSpreads.push(r.spread);
  }
  return summariseNull(real.spread, nullSpreads, nShuffles, seed, horizonDays, real.up, real.flush, nullKind, medianBlockLen);
}
