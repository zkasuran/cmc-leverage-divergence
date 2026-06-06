import { describe, it, expect } from "vitest";
import {
  normCdf,
  normInv,
  sharpePerPeriod,
  returnsFromEquity,
  probabilisticSharpe,
  deflatedSharpe,
  expectedMaxSharpe,
  skewness,
  kurtosis,
} from "../src/engine/stats.js";

describe("normal distribution helpers", () => {
  it("normCdf at known points", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 4);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("normInv inverts normCdf", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 4);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
    expect(normCdf(normInv(0.83))).toBeCloseTo(0.83, 3);
  });
});

describe("return helpers", () => {
  it("returnsFromEquity computes simple returns", () => {
    const r = returnsFromEquity([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]!).toBeCloseTo(0.1, 6);
    expect(r[1]!).toBeCloseTo(-0.1, 6);
  });
  it("sharpePerPeriod is mean/std", () => {
    expect(sharpePerPeriod([0.01, 0.01, 0.01])).toBe(0); // no variance -> 0 guard
    expect(sharpePerPeriod([0.02, -0.01, 0.03, 0.0])).toBeGreaterThan(0);
  });
  it("skew and kurtosis of a symmetric set", () => {
    expect(skewness([-2, -1, 0, 1, 2])).toBeCloseTo(0, 6);
    expect(kurtosis([-2, -1, 0, 1, 2])).toBeGreaterThan(0);
  });
});

describe("probabilistic + deflated Sharpe", () => {
  // a steadily positive return stream: high PSR
  const good = Array.from({ length: 400 }, (_, i) => 0.004 + 0.01 * Math.sin(i));
  it("PSR is high for a clearly positive Sharpe and ~0.5 for zero-mean", () => {
    expect(probabilisticSharpe(good, 0)).toBeGreaterThan(0.9);
    const zero = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    expect(probabilisticSharpe(zero, 0)).toBeCloseTo(0.5, 1);
  });
  it("deflation lowers the score relative to PSR when trials have spread", () => {
    const psr = probabilisticSharpe(good, 0);
    const trials = [0.02, 0.05, 0.08, 0.11, 0.14]; // spread of per-period Sharpes
    const dsr = deflatedSharpe(good, trials);
    expect(dsr).toBeLessThanOrEqual(psr);
    expect(dsr).toBeGreaterThanOrEqual(0);
  });
  it("expectedMaxSharpe grows with trial count", () => {
    expect(expectedMaxSharpe(0.1, 10)).toBeGreaterThan(expectedMaxSharpe(0.1, 3));
  });
});
