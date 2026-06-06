import { describe, it, expect } from "vitest";
import type { SignalPoint } from "../src/types.js";
import {
  mean,
  std,
  zscore,
  computeFeatures,
  DEFAULT_DIVERGENCE_CONFIG,
} from "../src/signals/divergence.js";

/** Build an aligned SignalPoint series from a funding array (+ optional fng/lsr). */
function sigs(funding: number[], fng?: number, lsr?: number): (SignalPoint | null)[] {
  return funding.map((f) => ({
    fundingRate: f,
    ...(fng !== undefined ? { fearGreed: fng } : {}),
    ...(lsr !== undefined ? { longShortRatio: lsr } : {}),
  }));
}

const N = 40;
const idx = Array.from({ length: N }, (_, k) => k);

describe("stats helpers", () => {
  it("mean and population std", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(std([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });
  it("zscore is 0 when there is no spread", () => {
    expect(zscore(5, [3, 3, 3])).toBe(0);
  });
  it("zscore sign tracks position vs the distribution", () => {
    expect(zscore(10, [0, 1, 2, 3])).toBeGreaterThan(0);
    expect(zscore(-10, [0, 1, 2, 3])).toBeLessThan(0);
  });
});

describe("computeFeatures", () => {
  it("returns null without enough history", () => {
    const short = idx.slice(0, 20).map(() => 100);
    expect(computeFeatures(short, sigs(short.map(() => 0.0001)))).toBeNull();
  });

  it("capitulation: abnormally negative funding + weak price => add above base", () => {
    const closes = idx.map((k) => 100 - 0.2 * k); // gentle decline
    const funding = idx.map((k) => (k < 33 ? 0.0001 : -0.002)); // abnormally negative tail
    const f = computeFeatures(closes, sigs(funding, 10, 1.0))!;
    expect(f).not.toBeNull();
    expect(f.fundingZ).toBeLessThan(-DEFAULT_DIVERGENCE_CONFIG.zEnter);
    expect(f.divergence).toBeGreaterThan(0);
    expect(f.target).toBeGreaterThan(DEFAULT_DIVERGENCE_CONFIG.base);
    expect(f.target).toBeLessThanOrEqual(1);
  });

  it("blowoff: abnormally positive funding + extended price => trim below base", () => {
    const closes = idx.map((k) => 100 * Math.pow(1.02, k)); // strong uptrend
    const funding = idx.map((k) => (k < 33 ? 0.0001 : 0.004)); // abnormally positive tail
    const f = computeFeatures(closes, sigs(funding, 85, 1.0))!;
    expect(f.pRet).toBeGreaterThan(DEFAULT_DIVERGENCE_CONFIG.priceUp);
    expect(f.fundingZ).toBeGreaterThan(DEFAULT_DIVERGENCE_CONFIG.zEnter);
    expect(f.divergence).toBeLessThan(0);
    expect(f.target).toBeLessThan(DEFAULT_DIVERGENCE_CONFIG.base);
  });

  it("neutral funding => no divergence tilt, target near base", () => {
    const closes = idx.map((k) => 100 * Math.pow(1.005, k)); // mild drift
    const funding = idx.map(() => 0.0001); // flat, no z extreme
    const f = computeFeatures(closes, sigs(funding, 50, 1.0))!;
    expect(f.divergence).toBe(0);
    expect(f.target).toBeCloseTo(DEFAULT_DIVERGENCE_CONFIG.base, 5);
  });

  it("crowding cuts size as the long/short ratio skews", () => {
    const closes = idx.map((k) => 100 - 0.2 * k);
    const funding = idx.map((k) => (k < 33 ? 0.0001 : -0.002));
    const neutral = computeFeatures(closes, sigs(funding, 10, 1.0))!;
    const crowded = computeFeatures(closes, sigs(funding, 10, 3.0))!;
    expect(neutral.crowdingSize).toBe(1);
    expect(crowded.crowdingSize).toBeLessThan(1);
    expect(crowded.target).toBeLessThan(neutral.target);
  });
});

describe("trend regime gate", () => {
  it("cuts allocation to riskOffFactor when price is below the long MA", () => {
    const cfg = { ...DEFAULT_DIVERGENCE_CONFIG, trendWindow: 100, useFng: false };
    const up = Array.from({ length: 115 }, (_, k) => 100 + k); // long uptrend
    const down = Array.from({ length: 15 }, (_, k) => 214 - 8 * k); // sharp drop under the MA
    const closes = [...up, ...down];
    const funding = closes.map((_, k) => (k < closes.length - 5 ? 0.0001 : -0.003)); // capitulation tail
    const f = computeFeatures(closes, sigs(funding), cfg)!;
    expect(f.divergence).toBeGreaterThan(0); // signal still bullish
    expect(f.trendFactor).toBe(cfg.riskOffFactor); // but regime is risk-off
    expect(f.target).toBeLessThanOrEqual(cfg.riskOffFactor); // so the book is cut
  });
});

describe("ablation toggles", () => {
  const closes = idx.map((k) => 100 - 0.2 * k);
  const funding = idx.map((k) => (k < 33 ? 0.0001 : -0.002));

  it("useDivergence=false falls back to pure funding contrarian", () => {
    const f = computeFeatures(closes, sigs(funding, 10, 1.0), {
      ...DEFAULT_DIVERGENCE_CONFIG,
      useDivergence: false,
    })!;
    // funding is abnormally negative => contrarian long bias stays positive
    expect(f.divergence).toBeGreaterThan(0);
  });

  it("useFng=false zeroes the Fear & Greed tilt", () => {
    const f = computeFeatures(closes, sigs(funding, 10, 1.0), {
      ...DEFAULT_DIVERGENCE_CONFIG,
      useFng: false,
    })!;
    expect(f.fngTilt).toBe(0);
  });

  it("useCrowding=false keeps full size regardless of the ratio", () => {
    const f = computeFeatures(closes, sigs(funding, 10, 5.0), {
      ...DEFAULT_DIVERGENCE_CONFIG,
      useCrowding: false,
    })!;
    expect(f.crowdingSize).toBe(1);
  });
});
