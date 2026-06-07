import { describe, it, expect } from "vitest";
import { checkClose, verdict, type Check } from "../src/engine/verify.js";

describe("results verifier", () => {
  it("checkClose passes when the recomputed value matches within tolerance", () => {
    const c = checkClose("cmc20.maxDD", 15.06, 15.06, 0.01);
    expect(c.ok).toBe(true);
  });

  it("checkClose fails when a committed number was edited away from the recomputed one", () => {
    // A README/report that claims 9.0% DD but the engine recomputes 15.06% must fail.
    const c = checkClose("cmc20.maxDD", 15.06, 9.0, 0.01);
    expect(c.ok).toBe(false);
    expect(c.got).toBe(15.06);
    expect(c.want).toBe(9.0);
  });

  it("checkClose tolerates rounding within the relative tolerance", () => {
    expect(checkClose("psr", 0.1581, 0.158, 0.01).ok).toBe(true); // ~0.06% off
  });

  it("checkClose uses an absolute floor near zero", () => {
    expect(checkClose("z", 0.0004, 0.0, 0.01).ok).toBe(true);
    expect(checkClose("z", 0.5, 0.0, 0.01).ok).toBe(false);
  });

  it("verdict is VERIFIED only when every check passes", () => {
    const checks: Check[] = [
      { label: "a", ok: true, got: 1, want: 1 },
      { label: "b", ok: true, got: 2, want: 2 },
    ];
    expect(verdict(checks)).toEqual({ verified: true, failed: [] });
  });

  it("verdict is UNVERIFIED and names the failures", () => {
    const checks: Check[] = [
      { label: "a", ok: true, got: 1, want: 1 },
      { label: "b", ok: false, got: 2, want: 9 },
    ];
    const v = verdict(checks);
    expect(v.verified).toBe(false);
    expect(v.failed).toEqual(["b"]);
  });
});
