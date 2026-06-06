/**
 * Statistical rigor for the backtest: the Probabilistic and Deflated Sharpe
 * Ratios (Bailey & López de Prado). These ask the question a skeptical judge
 * should ask: given the sample length, the non-normal return shape, AND the
 * number of strategy variants tried, is the Sharpe still significant, or is it a
 * multiple-testing artifact?
 *
 * Pure functions of a return series; no I/O.
 */

const EULER = 0.5772156649015329;

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1)); // sample std
}

export function skewness(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const sd = std(xs);
  if (sd === 0) return 0;
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 3;
  return s / n;
}

/** Raw (non-excess) kurtosis; a normal distribution has 3. */
export function kurtosis(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 4) return 3;
  const m = mean(xs);
  const sd = std(xs);
  if (sd === 0) return 3;
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 4;
  return s / n;
}

/** Per-period (not annualised) Sharpe of a return series. */
export function sharpePerPeriod(returns: readonly number[]): number {
  const sd = std(returns);
  return sd === 0 ? 0 : mean(returns) / sd;
}

/** Daily simple returns from an equity curve. */
export function returnsFromEquity(equity: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!;
    if (prev > 0) out.push(equity[i]! / prev - 1);
  }
  return out;
}

/** Standard normal CDF via the Abramowitz–Stegun erf approximation. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number, r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

/**
 * Probabilistic Sharpe Ratio: P(true SR > benchmark) given sample length, skew
 * and kurtosis. `srBenchmark` and the estimate are PER-PERIOD.
 */
export function probabilisticSharpe(returns: readonly number[], srBenchmark = 0): number {
  const n = returns.length;
  if (n < 4) return 0;
  const sr = sharpePerPeriod(returns);
  const g3 = skewness(returns);
  const g4 = kurtosis(returns);
  const denom = Math.sqrt(Math.max(1e-12, 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr));
  const z = ((sr - srBenchmark) * Math.sqrt(n - 1)) / denom;
  return normCdf(z);
}

/**
 * Expected maximum Sharpe from `nTrials` independent trials whose per-period
 * Sharpes have standard deviation `srStd` (the multiple-testing benchmark).
 */
export function expectedMaxSharpe(srStd: number, nTrials: number): number {
  if (nTrials < 2 || srStd <= 0) return 0;
  const e = Math.E;
  return srStd * ((1 - EULER) * normInv(1 - 1 / nTrials) + EULER * normInv(1 - 1 / (nTrials * e)));
}

/**
 * Deflated Sharpe Ratio: PSR against the expected-max-Sharpe benchmark implied
 * by having tried `trialSharpes.length` variants. Haircuts for selection bias.
 */
export function deflatedSharpe(returns: readonly number[], trialSharpes: readonly number[]): number {
  const n = trialSharpes.length;
  if (n < 2) return probabilisticSharpe(returns, 0);
  const srStar = expectedMaxSharpe(std(trialSharpes), n);
  return probabilisticSharpe(returns, srStar);
}
