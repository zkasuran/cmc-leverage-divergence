/**
 * CMC20 loader via CoinMarketCap's free data-api.
 * CoinMarketCap 20 Index DTF (id 38442), BEP-20 on BNB Smart Chain.
 * This is CMC's own index product — the sponsor-aligned benchmark.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bar, SignalPoint } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "..", "..", "data");

interface CmcQuote {
  timeOpen: string; timeClose: string; timeHigh: string; timeLow: string;
  quote: { open: number; high: number; low: number; close: number; volume: number; marketCap: number; };
}

/** Parse CMC historical JSON → Bar[]. The snapshots are committed. */
export function loadCmc20Bars(): Bar[] {
  const raw = JSON.parse(readFileSync(resolve(DATA, "cmc20-hist.json"), "utf8"));
  const quotes: CmcQuote[] = raw.data?.quotes ?? [];
  return quotes.map((q) => ({
    time: new Date(q.timeOpen).getTime(),
    open: q.quote.open,
    high: q.quote.high,
    low: q.quote.low,
    close: q.quote.close,
    volume: q.quote.volume,
  })).sort((a, b) => a.time - b.time);
}

/** CMC20 has no perp market, so signals are bare (price only). */
export function loadCmc20Signals(bars: readonly Bar[]): (SignalPoint | null)[] {
  return bars.map(() => null);
}
