/**
 * Decision-provenance chain.
 *
 * A rival ships a hash-chained log of its live calls, which proves entries were
 * appended in order and not reordered. This proves MORE. Each entry records the
 * live CMC inputs AND the decision they produced. `verifyChain` re-runs the
 * committed engine on those inputs and asserts the recorded decision is exactly
 * what the engine produces. So an entry is rejected on two independent gates:
 *
 *   1. Link gate:     the sha256 chain links, so nothing was reordered, dropped
 *                     or edited (the property a plain log has).
 *   2. Decision gate: the recorded allocation re-derives from the recorded
 *                     inputs through `specFromSnapshot`, so a hand-edited
 *                     allocation FAILS even when every hash links cleanly.
 *
 * The chain holds only readings we actually ran. It is never backfilled.
 */

import { sha256Hex } from "../report/emit.js";
import { buildLiveSnapshot } from "../data/cmc.js";
import { specFromSnapshot } from "../spec.js";
import { checkClose } from "./verify.js";

export interface ChainInputs {
  /** Committed history tail used as reproducible context, oldest first. */
  tail_closes: number[];
  /** Committed funding aligned to `tail_closes`. */
  tail_funding: number[];
  /** Live CMC price appended as the newest bar. */
  price: number;
  /** Live CMC aggregate funding appended as the newest reading. */
  funding_rate: number;
  open_interest: number | null;
}

export interface ChainDecision {
  signal_state: string;
  score: number;
  target_allocation: number;
}

export interface ChainRecord {
  seq: number;
  as_of: string;
  asset: string;
  inputs: ChainInputs;
  decision: ChainDecision;
  reading_hash: string;
  prev_hash: string;
  this_hash: string;
}

/** Canonical bytes of an entry's content, excluding the chain-link hashes. */
function readingHashOf(r: Omit<ChainRecord, "reading_hash" | "prev_hash" | "this_hash">): string {
  return sha256Hex(
    JSON.stringify({
      seq: r.seq,
      as_of: r.as_of,
      asset: r.asset,
      inputs: r.inputs,
      decision: r.decision,
    }),
  );
}

/** Build the next record, linking it to `prev` (null = genesis). */
export function appendRecord(
  prev: ChainRecord | null,
  entry: { as_of: string; asset: string; inputs: ChainInputs; decision: ChainDecision },
): ChainRecord {
  const seq = prev ? prev.seq + 1 : 0;
  const prev_hash = prev ? prev.this_hash : "";
  const reading_hash = readingHashOf({ seq, as_of: entry.as_of, asset: entry.asset, inputs: entry.inputs, decision: entry.decision });
  const this_hash = sha256Hex(prev_hash + reading_hash);
  return { seq, as_of: entry.as_of, asset: entry.asset, inputs: entry.inputs, decision: entry.decision, reading_hash, prev_hash, this_hash };
}

export interface ChainVerdict {
  ok: boolean;
  brokenAt: number | null;
  reason: string;
}

/** Re-derive the decision for one entry from its recorded inputs. */
export function recomputeDecision(r: ChainRecord): ChainDecision | null {
  const snap = buildLiveSnapshot({
    asset: r.asset,
    histCloses: r.inputs.tail_closes,
    histFunding: r.inputs.tail_funding,
    price: r.inputs.price,
    fundingRate: r.inputs.funding_rate,
    openInterest: r.inputs.open_interest ?? undefined,
  });
  const spec = specFromSnapshot(snap, r.as_of);
  if (!spec) return null;
  return { signal_state: spec.signal.state, score: spec.signal.score, target_allocation: spec.target_allocation };
}

/**
 * Walk the chain. Every entry must (1) link to its predecessor and re-hash to its
 * stored hashes; and (2) carry a decision that re-derives from its inputs. The
 * first failure stops the walk and is reported.
 */
export function verifyChain(records: readonly ChainRecord[]): ChainVerdict {
  let prev: ChainRecord | null = null;
  for (const r of records) {
    const expectedSeq = prev ? prev.seq + 1 : 0;
    if (r.seq !== expectedSeq) {
      return { ok: false, brokenAt: r.seq, reason: `seq ${r.seq} expected ${expectedSeq}` };
    }
    const expectedPrev = prev ? prev.this_hash : "";
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, brokenAt: r.seq, reason: `prev_hash mismatch at seq ${r.seq}` };
    }
    // Link gate: re-hash the content and the link.
    const reading_hash = readingHashOf({ seq: r.seq, as_of: r.as_of, asset: r.asset, inputs: r.inputs, decision: r.decision });
    if (reading_hash !== r.reading_hash) {
      return { ok: false, brokenAt: r.seq, reason: `reading_hash mismatch at seq ${r.seq} (content edited)` };
    }
    if (sha256Hex(r.prev_hash + reading_hash) !== r.this_hash) {
      return { ok: false, brokenAt: r.seq, reason: `this_hash mismatch at seq ${r.seq}` };
    }
    // Decision gate: the recorded decision must follow from the recorded inputs.
    const recomputed = recomputeDecision(r);
    if (!recomputed) {
      return { ok: false, brokenAt: r.seq, reason: `inputs at seq ${r.seq} cannot be priced by the engine` };
    }
    const alloc = checkClose(`seq${r.seq}.alloc`, recomputed.target_allocation, r.decision.target_allocation);
    const score = checkClose(`seq${r.seq}.score`, recomputed.score, r.decision.score);
    if (!alloc.ok || !score.ok) {
      return { ok: false, brokenAt: r.seq, reason: `decision at seq ${r.seq} does not re-derive from its inputs (recorded alloc ${r.decision.target_allocation}, engine ${recomputed.target_allocation})` };
    }
    if (recomputed.signal_state !== r.decision.signal_state) {
      return { ok: false, brokenAt: r.seq, reason: `signal state at seq ${r.seq} does not re-derive (recorded ${r.decision.signal_state}, engine ${recomputed.signal_state})` };
    }
    prev = r;
  }
  const n = records.length;
  return { ok: true, brokenAt: null, reason: n ? `${n} entr${n === 1 ? "y" : "ies"} verified` : "empty chain" };
}

/** Parse a JSONL chain file body into records (blank lines ignored). */
export function parseChain(jsonl: string): ChainRecord[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ChainRecord);
}

/** Serialize records back to JSONL (one compact object per line, trailing newline). */
export function serializeChain(records: readonly ChainRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}
