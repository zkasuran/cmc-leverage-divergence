import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  quoteFromListing,
  aggregatePerpFunding,
  parseGlobalMetrics,
  buildLiveSnapshot,
} from "../src/data/cmc.js";
import { specFromSnapshot } from "../src/spec.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(HERE, "fixtures", name), "utf8"));

const listing = fixture("cmc-listing.json");
const perpBtc = fixture("cmc-perp-btc.json");
const global = fixture("cmc-global.json");

describe("CMC keyless data-api adapter", () => {
  describe("quoteFromListing", () => {
    it("extracts a coin's live quote (id, price, market cap) from the CMC listing", () => {
      const q = quoteFromListing(listing, "BTC");
      expect(q).not.toBeNull();
      expect(q!.id).toBe(1);
      expect(q!.symbol).toBe("BTC");
      expect(q!.price).toBeGreaterThan(0);
      expect(q!.marketCap).toBeGreaterThan(0);
    });

    it("is case-insensitive on the symbol", () => {
      expect(quoteFromListing(listing, "btc")!.id).toBe(1);
    });

    it("returns null for a symbol not in the listing", () => {
      expect(quoteFromListing(listing, "NOTACOIN")).toBeNull();
    });
  });

  describe("aggregatePerpFunding", () => {
    it("aggregates funding + open interest across the CMC perp venues", () => {
      const agg = aggregatePerpFunding(perpBtc);
      expect(agg).not.toBeNull();
      // A real per-8h funding rate is tiny; sanity-bound it well under 1%.
      expect(Number.isFinite(agg!.fundingRate)).toBe(true);
      expect(Math.abs(agg!.fundingRate)).toBeLessThan(0.01);
      // The aggregate must sit within the range of the venue readings it blends.
      expect(agg!.fundingRate).toBeGreaterThanOrEqual(agg!.minVenueFunding);
      expect(agg!.fundingRate).toBeLessThanOrEqual(agg!.maxVenueFunding);
      expect(agg!.openInterestUsd).toBeGreaterThan(0);
      expect(agg!.venues).toBeGreaterThan(0);
    });

    it("returns null when there are no perp pairs", () => {
      expect(aggregatePerpFunding({ data: { marketPairs: [] } })).toBeNull();
    });
  });

  describe("parseGlobalMetrics", () => {
    it("extracts BTC and ETH dominance from the CMC global-metrics response", () => {
      const g = parseGlobalMetrics(global);
      expect(g).not.toBeNull();
      expect(g!.btcDominance).toBeGreaterThan(0);
      expect(g!.btcDominance).toBeLessThan(100);
      expect(g!.ethDominance).toBeGreaterThan(0);
    });

    it("returns null when the payload has no data", () => {
      expect(parseGlobalMetrics({})).toBeNull();
    });

    it("returns null when a dominance field is missing", () => {
      expect(parseGlobalMetrics({ data: { btcDominance: 58 } })).toBeNull();
    });
  });

  describe("buildLiveSnapshot", () => {
    const histCloses = Array.from({ length: 120 }, (_, k) => 100 + k);
    const histFunding = Array.from({ length: 120 }, () => 0.0001);

    it("appends the live CMC reading as the newest bar on the committed tail", () => {
      const snap = buildLiveSnapshot({
        asset: "BTC",
        histCloses,
        histFunding,
        price: 61449.74,
        fundingRate: -0.00003,
        openInterest: 6.3e9,
        fearGreed: 55,
        longShortRatio: 1.1,
      });
      expect(snap.closes).toHaveLength(histCloses.length + 1);
      expect(snap.funding).toHaveLength(histFunding.length + 1);
      expect(snap.closes.at(-1)).toBe(61449.74);
      expect(snap.funding.at(-1)).toBe(-0.00003);
      expect(snap.openInterest).toBe(6.3e9);
      expect(snap.fearGreed).toBe(55);
      expect(snap.longShortRatio).toBe(1.1);
      expect(snap.asset).toBe("BTC");
    });

    it("produces a snapshot the real signal engine can price", () => {
      const snap = buildLiveSnapshot({
        asset: "BTC",
        histCloses,
        histFunding,
        price: 230,
        fundingRate: 0.004,
      });
      const spec = specFromSnapshot(snap, "2026-06-07T00:00:00.000Z");
      expect(spec).not.toBeNull();
      expect(spec!.asset).toBe("BTC");
      expect(spec!.target_allocation).toBeGreaterThanOrEqual(0);
      expect(spec!.target_allocation).toBeLessThanOrEqual(1);
    });
  });
});
