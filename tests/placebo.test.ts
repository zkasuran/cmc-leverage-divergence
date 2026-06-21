import { describe, it, expect } from "vitest";
import {
  divergenceStates,
  confirmedFlushSpread,
  shuffleFundingSignals,
  blockPermuteFundingSignals,
  autocorrLength,
  placeboTest,
  pooledPlaceboTest,
  type DivState,
} from "../src/runners/placebo.js";
import { loadDataset } from "../src/data/loaders.js";
import { computeFeatures, DEFAULT_DIVERGENCE_CONFIG } from "../src/signals/divergence.js";
import { SeededRng } from "../src/engine/rng.js";
import type { Bar, SignalPoint } from "../src/types.js";

/** The slow, obviously-correct full-prefix classification (mirrors eventStudy). */
function fullPrefixStates(bars: readonly Bar[], signals: readonly (SignalPoint | null)[], threshold = 0.1): DivState[] {
  const closes = bars.map((b) => b.close);
  const out: DivState[] = [];
  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(closes.slice(0, i + 1), signals.slice(0, i + 1), DEFAULT_DIVERGENCE_CONFIG);
    if (f === null) out.push("neutral");
    else if (f.divergence >= threshold) out.push("confirmed-up");
    else if (f.divergence <= -threshold) out.push("flush-down");
    else out.push("neutral");
  }
  return out;
}

describe("divergenceStates is faithful to the full-prefix event study (windowing changes nothing)", () => {
  it("windowed states equal full-prefix states on real BNB data", () => {
    const { bars, signals } = loadDataset("bnb");
    // First 500 bars is enough to exercise the trend window (100) many times over.
    const b = bars.slice(0, 500);
    const s = signals.slice(0, 500);
    expect(divergenceStates(b, s)).toEqual(fullPrefixStates(b, s));
  });
});

describe("shuffleFundingSignals is a permutation", () => {
  it("preserves the multiset of funding values, their count and the series length", () => {
    const signals: (SignalPoint | null)[] = [
      { fundingRate: 0.01, fearGreed: 50 },
      null,
      { fundingRate: -0.02 },
      { fundingRate: 0.03, longShortRatio: 1.2 },
      { fearGreed: 40 }, // no funding
    ];
    const out = shuffleFundingSignals(signals, new SeededRng(1));
    expect(out).toHaveLength(signals.length);
    const before = signals.map((x) => x?.fundingRate).filter((x): x is number => typeof x === "number").sort();
    const after = out.map((x) => x?.fundingRate).filter((x): x is number => typeof x === "number").sort();
    expect(after).toEqual(before);
    // Non-funding fields survive at their positions.
    expect(out[0]!.fearGreed).toBe(50);
    expect(out[3]!.longShortRatio).toBe(1.2);
    expect(out[4]!.fearGreed).toBe(40);
    expect(out[1]).toBeNull();
  });
});

describe("placeboTest is deterministic", () => {
  it("the same seed yields the same p-value and null", () => {
    const { bars, signals } = loadDataset("bnb");
    const a = placeboTest(bars, signals, { nShuffles: 40, seed: 7 });
    const b = placeboTest(bars, signals, { nShuffles: 40, seed: 7 });
    expect(b.pValue).toBe(a.pValue);
    expect(b.nullP95Pct).toBe(a.nullP95Pct);
    expect(b.validShuffles).toBe(a.validShuffles);
  });
});

describe("the test has power AND does not rubber-stamp (anti-circularity)", () => {
  // DOGE: funding carries genuine forward information -> the spread escapes the null.
  it("PASSES where funding is informative (DOGE)", { timeout: 30000 }, () => {
    const { bars, signals } = loadDataset("doge");
    const r = placeboTest(bars, signals, { nShuffles: 200, seed: 20260618 });
    expect(r.realSpreadPct).toBeGreaterThan(r.nullP95Pct);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.passed).toBe(true);
  });

  // BTC: the confirmed-vs-flush spread is essentially price momentum, so a random
  // funding shuffle reproduces it -> the test must NOT pass. This is the control
  // that proves the placebo can fail.
  it("FAILS where funding adds nothing beyond momentum (BTC)", { timeout: 30000 }, () => {
    const { bars, signals } = loadDataset("btc");
    const r = placeboTest(bars, signals, { nShuffles: 200, seed: 20260618 });
    expect(r.passed).toBe(false);
    expect(r.pValue).toBeGreaterThan(0.05);
  });
});

describe("pooled placebo across the liquid majors", () => {
  it("the cross-asset finding clears the shuffled null", { timeout: 60000 }, () => {
    const pool = ["bnb", "btc", "eth", "sol", "doge", "xrp", "ada"].map((p) => {
      const { bars, signals } = loadDataset(p);
      return { symbol: p.toUpperCase(), bars, signals };
    });
    const r = pooledPlaceboTest(pool, { nShuffles: 120, seed: 20260618 });
    expect(r.realSpreadPct).toBeGreaterThan(r.nullP95Pct);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.passed).toBe(true);
  });
});

describe("blockPermuteFundingSignals is a permutation", () => {
  it("preserves the multiset of funding values, their count and non-funding fields", () => {
    const signals: (SignalPoint | null)[] = Array.from({ length: 40 }, (_, i) => ({
      fundingRate: Math.sin(i / 3) * 0.01,
      fearGreed: i,
    }));
    signals[5] = null;
    signals[9] = { fearGreed: 99 }; // no funding
    const out = blockPermuteFundingSignals(signals, new SeededRng(3), 4);
    expect(out).toHaveLength(signals.length);
    const before = signals.map((x) => x?.fundingRate).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    const after = out.map((x) => x?.fundingRate).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    expect(after).toEqual(before);
    expect(out[5]).toBeNull();
    expect(out[9]!.fearGreed).toBe(99);
  });
});

describe("the block null preserves autocorrelation; the i.i.d. null destroys it", () => {
  // The whole point of the block permutation: a persistent funding series stays
  // persistent under the null, so significance is not inflated by comparing an
  // autocorrelated signal against a white-noise null.
  const lag1 = (xs: number[]): number => {
    const n = xs.length;
    const m = xs.reduce((a, b) => a + b, 0) / n;
    let c0 = 0;
    let c1 = 0;
    for (let i = 0; i < n; i++) c0 += (xs[i]! - m) ** 2;
    for (let i = 1; i < n; i++) c1 += (xs[i]! - m) * (xs[i - 1]! - m);
    return c1 / c0;
  };
  const funding = (s: (SignalPoint | null)[]): number[] =>
    s.map((x) => x?.fundingRate).filter((x): x is number => typeof x === "number");

  it("retains most of the lag-1 autocorrelation under the block null, near zero under i.i.d.", () => {
    // A strongly autocorrelated (AR-like) funding series.
    const base: number[] = [];
    let v = 0;
    for (let i = 0; i < 300; i++) {
      v = 0.92 * v + 0.08 * Math.sin(i / 7);
      base.push(v);
    }
    const signals: (SignalPoint | null)[] = base.map((f) => ({ fundingRate: f }));
    const origAc = lag1(base);
    expect(origAc).toBeGreaterThan(0.8);

    const L = autocorrLength(base);
    expect(L).toBeGreaterThan(1);

    const block = lag1(funding(blockPermuteFundingSignals(signals, new SeededRng(11), L)));
    const iid = lag1(funding(shuffleFundingSignals(signals, new SeededRng(11))));

    // Block keeps the series persistent; i.i.d. shuffles it to near white noise.
    expect(block).toBeGreaterThan(0.6);
    expect(iid).toBeLessThan(0.2);
    expect(block).toBeGreaterThan(iid + 0.4);
  });
});

describe("block-permutation null (the primary, autocorrelation-preserving null)", () => {
  it("is deterministic for a fixed seed", () => {
    const { bars, signals } = loadDataset("bnb");
    const a = placeboTest(bars, signals, { nShuffles: 40, seed: 7, nullKind: "block" });
    const b = placeboTest(bars, signals, { nShuffles: 40, seed: 7, nullKind: "block" });
    expect(b.pValue).toBe(a.pValue);
    expect(b.nullP95Pct).toBe(a.nullP95Pct);
    expect(b.blockLen).toBe(a.blockLen);
    expect(b.nullKind).toBe("block");
  });

  it("the cross-asset finding clears the autocorrelation-preserving null", { timeout: 60000 }, () => {
    const pool = ["bnb", "btc", "eth", "sol", "doge", "xrp", "ada"].map((p) => {
      const { bars, signals } = loadDataset(p);
      return { symbol: p.toUpperCase(), bars, signals };
    });
    const r = pooledPlaceboTest(pool, { nShuffles: 200, seed: 20260618, nullKind: "block" });
    expect(r.nullKind).toBe("block");
    expect(r.realSpreadPct).toBeGreaterThan(r.nullP95Pct);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.passed).toBe(true);
  });

  // Anti-circularity still holds under the stricter null: power on DOGE, control on BTC.
  it("PASSES on DOGE and FAILS on BTC under the block null", { timeout: 60000 }, () => {
    const doge = loadDataset("doge");
    const btc = loadDataset("btc");
    const rd = placeboTest(doge.bars, doge.signals, { nShuffles: 200, seed: 20260618, nullKind: "block" });
    const rb = placeboTest(btc.bars, btc.signals, { nShuffles: 200, seed: 20260618, nullKind: "block" });
    expect(rd.pValue).toBeLessThan(0.05);
    expect(rd.passed).toBe(true);
    expect(rb.passed).toBe(false);
    expect(rb.pValue).toBeGreaterThan(0.05);
  });
});

describe("confirmedFlushSpread", () => {
  it("returns null when a bucket is too thin", () => {
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({
      time: i * 86_400_000, open: 100, high: 100, low: 100, close: 100, volume: 1,
    }));
    const signals = bars.map(() => ({ fundingRate: 0 }) as SignalPoint);
    expect(confirmedFlushSpread(bars, signals, 30)).toBeNull();
  });
});
