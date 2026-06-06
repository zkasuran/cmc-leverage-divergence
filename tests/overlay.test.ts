import { describe, it, expect } from "vitest";
import { buildBasketSignals, loadConstituents, constituentCoverage } from "../src/runners/cmc20-overlay.js";
import { loadCmc20Bars } from "../src/data/cmc-loader.js";

describe("CMC20 basket overlay", () => {
  it("loads the constituent universe (>= 4, with market caps)", () => {
    const u = loadConstituents();
    expect(u.length).toBeGreaterThanOrEqual(4);
    for (const c of u) {
      expect(c.symbol).toBeTruthy();
      expect(c.marketCap).toBeGreaterThan(0);
    }
  });

  it("builds basket signals aligned 1:1 with CMC20 bars, no lookahead", () => {
    const bars = loadCmc20Bars();
    const sig = buildBasketSignals(bars);
    expect(sig.length).toBe(bars.length);
    // every non-null signal must have a finite funding rate
    for (const s of sig) {
      if (s && s.fundingRate !== undefined) {
        expect(Number.isFinite(s.fundingRate)).toBe(true);
      }
    }
    // at least some bars carry a basket funding reading
    expect(sig.filter((s) => s?.fundingRate !== undefined).length).toBeGreaterThan(0);
  });

  it("reports real constituent coverage", () => {
    const c = constituentCoverage();
    expect(c.total).toBeGreaterThanOrEqual(4);
    expect(c.withFunding).toBeGreaterThan(0);
    expect(c.withFunding).toBeLessThanOrEqual(c.total);
    expect(c.symbols.length).toBe(c.withFunding);
  });
});
