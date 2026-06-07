import { describe, it, expect } from "vitest";
import {
  appendRecord,
  verifyChain,
  recomputeDecision,
  parseChain,
  serializeChain,
  type ChainRecord,
  type ChainInputs,
} from "../src/engine/chain.js";
import { sha256Hex } from "../src/report/emit.js";

// Deterministic synthetic history (no network, no clock). 60 points is past the
// engine's max(lookback=7, zWindow=30) requirement so specFromSnapshot can price.
function inputs(seed: number): ChainInputs {
  const tail_closes: number[] = [];
  const tail_funding: number[] = [];
  for (let i = 0; i < 60; i++) {
    tail_closes.push(100 + Math.sin((i + seed) / 5) * 8 + i * 0.3);
    tail_funding.push(Math.sin((i + seed) / 7) * 0.0005);
  }
  return { tail_closes, tail_funding, price: 130 + seed, funding_rate: 0.0009, open_interest: 1_000_000 + seed };
}

// Build an honest record: record exactly the decision the engine derives.
function honest(prev: ChainRecord | null, seq: number): ChainRecord {
  const inp = inputs(seq);
  const stub = appendRecord(prev, {
    as_of: `2026-06-0${seq + 1}T00:00:00.000Z`,
    asset: "BNB",
    inputs: inp,
    decision: { signal_state: "neutral", score: 0, target_allocation: 0 },
  });
  const real = recomputeDecision(stub);
  if (!real) throw new Error("engine could not price the synthetic inputs");
  return appendRecord(prev, { as_of: stub.as_of, asset: stub.asset, inputs: inp, decision: real });
}

describe("decision-provenance chain", () => {
  it("appendRecord starts the genesis entry with an empty prev_hash", () => {
    const r0 = honest(null, 0);
    expect(r0.seq).toBe(0);
    expect(r0.prev_hash).toBe("");
    expect(r0.this_hash).toBe(sha256Hex("" + r0.reading_hash));
  });

  it("verifies an honest 3-entry chain on both gates", () => {
    const r0 = honest(null, 0);
    const r1 = honest(r0, 1);
    const r2 = honest(r1, 2);
    const v = verifyChain([r0, r1, r2]);
    expect(v.ok).toBe(true);
    expect(v.brokenAt).toBeNull();
  });

  it("link gate: a tampered this_hash is caught", () => {
    const r0 = honest(null, 0);
    const r1 = honest(r0, 1);
    const bad = { ...r1, this_hash: "deadbeef" };
    const v = verifyChain([r0, bad]);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("link gate: a reordered/dropped entry breaks the seq + prev_hash link", () => {
    const r0 = honest(null, 0);
    const r1 = honest(r0, 1);
    const r2 = honest(r1, 2);
    const v = verifyChain([r0, r2]); // r1 dropped
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });

  it("decision gate: a forged allocation fails EVEN with perfectly relinked hashes", () => {
    // This is the property a plain hash-log cannot provide. Edit the recorded
    // allocation to a lie, then recompute reading_hash + this_hash so every link
    // is internally consistent. The link gate passes; the decision gate must fail
    // because the lie does not re-derive from the recorded inputs.
    const r0 = honest(null, 0);
    const forgedDecision = { ...r0.decision, target_allocation: 0.99 };
    const relinked = appendRecord(null, {
      as_of: r0.as_of,
      asset: r0.asset,
      inputs: r0.inputs,
      decision: forgedDecision,
    });
    // Sanity: the forgery is internally hash-consistent (link gate would pass).
    expect(relinked.this_hash).toBe(sha256Hex("" + relinked.reading_hash));
    const v = verifyChain([relinked]);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
    expect(v.reason).toMatch(/re-derive/);
  });

  it("round-trips through JSONL serialize/parse", () => {
    const r0 = honest(null, 0);
    const r1 = honest(r0, 1);
    const restored = parseChain(serializeChain([r0, r1]));
    expect(restored).toEqual([r0, r1]);
    expect(verifyChain(restored).ok).toBe(true);
  });

  it("an empty chain verifies vacuously", () => {
    expect(verifyChain([]).ok).toBe(true);
  });
});
