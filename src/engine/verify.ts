/**
 * Results verifier.
 *
 * The point is not to log that a signal was emitted, it is to make the published
 * RESULTS tamper-evident. `npm run verify` re-derives every headline number from
 * the committed dataset and checks it against the committed reports. If a number in
 * a report (or quoted in the README) was edited away from what the engine actually
 * produces, a check fails and the verdict is UNVERIFIED. A judge runs one command
 * and watches the claims prove themselves, or break.
 */

export interface Check {
  label: string;
  ok: boolean;
  got: number;
  want: number;
}

/**
 * Compare a freshly recomputed value against a committed one. `tol` is a relative
 * tolerance (fraction), with an absolute floor of `tol` for values near zero so a
 * claimed 0 cannot hide a real 0.5.
 */
export function checkClose(label: string, got: number, want: number, tol = 0.01): Check {
  const scale = Math.max(Math.abs(want), 1);
  const ok = Math.abs(got - want) <= tol * scale;
  return { label, ok, got, want };
}

/** VERIFIED only when every check passes; otherwise list the failed labels. */
export function verdict(checks: readonly Check[]): { verified: boolean; failed: string[] } {
  const failed = checks.filter((c) => !c.ok).map((c) => c.label);
  return { verified: failed.length === 0, failed };
}
