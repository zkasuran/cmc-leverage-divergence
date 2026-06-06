import { describe, it, expect } from "vitest";
import { specFromSnapshot, type CmcSnapshot } from "../src/spec.js";

/** A snapshot with enough history for the 30-bar funding window. */
function snapshot(overrides: Partial<CmcSnapshot> = {}): CmcSnapshot {
  const n = 40;
  return {
    asset: "BNB",
    closes: Array.from({ length: n }, (_, k) => 100 * Math.pow(1.02, k)), // uptrend
    funding: Array.from({ length: n }, (_, k) => (k < 33 ? 0.0001 : 0.004)), // positive tail
    fearGreed: 60,
    longShortRatio: 1.2,
    ...overrides,
  };
}

describe("spec generator (the Skill↔backtest bridge)", () => {
  it("emits a valid spec shape from a snapshot", () => {
    const spec = specFromSnapshot(snapshot(), "2026-06-06T00:00:00.000Z");
    expect(spec).not.toBeNull();
    expect(spec!.asset).toBe("BNB");
    expect(spec!.target_allocation).toBeGreaterThanOrEqual(0);
    expect(spec!.target_allocation).toBeLessThanOrEqual(1);
    expect(["confirmed-up", "flush-down", "neutral"]).toContain(spec!.signal.state);
    expect(spec!.readings.funding_rate).toBeCloseTo(0.004, 6);
    expect(spec!.rules.z_enter).toBe(1);
  });

  it("confirmed-up snapshot yields a confirmed-up state and risk-on regime", () => {
    const spec = specFromSnapshot(snapshot(), "2026-06-06T00:00:00.000Z")!;
    expect(spec.signal.state).toBe("confirmed-up");
    expect(spec.signal.score).toBeGreaterThan(0);
    expect(spec.regime).toBe("risk-on"); // price above its own MA in an uptrend
    expect(spec.target_allocation).toBeGreaterThan(0.5);
  });

  it("downtrend snapshot flips the regime to risk-off and cuts allocation", () => {
    // Need > trendWindow (100) bars for the trend gate to engage: 110 up then a
    // sharp drop below the 100-day MA, with a negative-funding flush tail.
    const up = Array.from({ length: 110 }, (_, k) => 100 + k);
    const drop = Array.from({ length: 20 }, (_, k) => 210 - 9 * k);
    const closes = [...up, ...drop];
    const funding = closes.map((_, k) => (k < closes.length - 6 ? 0.0001 : -0.003));
    const down: CmcSnapshot = { asset: "BNB", closes, funding, fearGreed: 20, longShortRatio: 1.1 };
    const spec = specFromSnapshot(down, "2026-06-06T00:00:00.000Z")!;
    expect(spec.regime).toBe("risk-off");
    expect(spec.target_allocation).toBeLessThan(0.5);
  });

  it("returns null when history is too short to compute the signal", () => {
    const short = snapshot({ closes: [100, 101, 102], funding: [0.0001, 0.0001, 0.0001] });
    expect(specFromSnapshot(short, "2026-06-06T00:00:00.000Z")).toBeNull();
  });
});
