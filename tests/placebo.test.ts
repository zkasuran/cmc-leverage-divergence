import { describe, it, expect } from "vitest";
import {
  divergenceStates,
  confirmedFlushSpread,
  shuffleFundingSignals,
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

describe("confirmedFlushSpread", () => {
  it("returns null when a bucket is too thin", () => {
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({
      time: i * 86_400_000, open: 100, high: 100, low: 100, close: 100, volume: 1,
    }));
    const signals = bars.map(() => ({ fundingRate: 0 }) as SignalPoint);
    expect(confirmedFlushSpread(bars, signals, 30)).toBeNull();
  });
});
