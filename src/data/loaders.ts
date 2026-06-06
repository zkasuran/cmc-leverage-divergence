/**
 * Offline dataset loader. Reads the committed snapshots in data/ and aligns
 * every series to the daily bar timeline as-of each bar's OPEN time, so the
 * backtest never sees a value before it would have existed.
 *
 *   - funding: most recent 8h settlement at or before the bar open.
 *   - Fear & Greed: shifted +1 day (a day's reading is only knowable the next
 *     morning), then taken as-of the bar open.
 *   - open interest / long-short ratio: as-of the bar open, but Binance only
 *     serves ~30 days, so older bars get `undefined` (honest, not faked).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bar, SignalPoint } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = resolve(HERE, "..", "..", "data");

/**
 * Validation assets: every CMC20 constituent with both deep daily price history
 * and a funding market on Binance (>= ~4 years), so the funding-confirmation
 * signal can be tested out-of-sample on each. BNB is primary (this is a BNB Chain
 * hackathon). The newer/illiquid constituents (HYPE, CC, M, TON) have no deep
 * spot history, so they feed the live CMC20 basket but not this backtest.
 */
export const ASSETS: Array<{ prefix: string; symbol: string }> = [
  { prefix: "bnb", symbol: "BNBUSDT" },
  { prefix: "btc", symbol: "BTCUSDT" },
  { prefix: "eth", symbol: "ETHUSDT" },
  { prefix: "sol", symbol: "SOLUSDT" },
  { prefix: "xrp", symbol: "XRPUSDT" },
  { prefix: "trx", symbol: "TRXUSDT" },
  { prefix: "doge", symbol: "DOGEUSDT" },
  { prefix: "xlm", symbol: "XLMUSDT" },
  { prefix: "ada", symbol: "ADAUSDT" },
  { prefix: "link", symbol: "LINKUSDT" },
  { prefix: "ltc", symbol: "LTCUSDT" },
  { prefix: "bch", symbol: "BCHUSDT" },
  { prefix: "zec", symbol: "ZECUSDT" },
  { prefix: "xmr", symbol: "XMRUSDT" },
  { prefix: "hbar", symbol: "HBARUSDT" },
];

/** The primary asset (this is a BNB Chain hackathon). */
export const PRIMARY = "bnb";

interface Point {
  time: number;
  value: number;
}

function readJson(dir: string, name: string): any {
  return JSON.parse(readFileSync(resolve(dir, name), "utf8"));
}

function readJsonIfExists(dir: string, name: string): any | null {
  const p = resolve(dir, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Binance daily klines -> Bar[] (sorted ascending). */
export function loadBars(prefix = "bnb", dir = DEFAULT_DATA_DIR): Bar[] {
  const raw: any[] = readJson(dir, `${prefix}-1d.json`);
  return raw
    .map((r) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .sort((a, b) => a.time - b.time);
}

function loadFunding(prefix: string, dir: string): Point[] {
  const raw: any[] = readJson(dir, `${prefix}-funding.json`);
  return raw
    .map((r) => ({ time: Number(r.fundingTime), value: Number(r.fundingRate) }))
    .sort((a, b) => a.time - b.time);
}

function loadFng(dir: string): Point[] {
  const raw: any[] = readJson(dir, "fng.json");
  return raw
    .map((r) => ({ time: Number(r.timestamp) * 1000 + 86_400_000, value: Number(r.value) }))
    .sort((a, b) => a.time - b.time);
}

function loadOi(prefix: string, dir: string): Point[] {
  const raw = readJsonIfExists(dir, `${prefix}-oi.json`);
  if (!raw) return [];
  return raw
    .map((r: any) => ({ time: Number(r.timestamp), value: Number(r.sumOpenInterest) }))
    .sort((a: Point, b: Point) => a.time - b.time);
}

function loadLs(prefix: string, dir: string): Point[] {
  const raw = readJsonIfExists(dir, `${prefix}-ls.json`);
  if (!raw) return [];
  return raw
    .map((r: any) => ({ time: Number(r.timestamp), value: Number(r.longShortRatio) }))
    .sort((a: Point, b: Point) => a.time - b.time);
}

/** Latest value at or before `t`, or null if none exists yet. Points are sorted ascending. */
export function asOf(points: readonly Point[], t: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.time <= t) {
      ans = points[mid]!.value;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export interface Dataset {
  bars: Bar[];
  signals: (SignalPoint | null)[];
}

/** Load bars + aligned signals from the committed snapshots for one asset. */
export function loadDataset(prefix = "bnb", dir = DEFAULT_DATA_DIR): Dataset {
  const bars = loadBars(prefix, dir);
  const funding = loadFunding(prefix, dir);
  const fng = loadFng(dir);
  const oi = loadOi(prefix, dir);
  const ls = loadLs(prefix, dir);

  const signals: (SignalPoint | null)[] = bars.map((bar) => {
    const point: SignalPoint = {};
    const f = asOf(funding, bar.time);
    if (f !== null) point.fundingRate = f;
    const g = asOf(fng, bar.time);
    if (g !== null) point.fearGreed = g;
    const o = asOf(oi, bar.time);
    if (o !== null) point.openInterest = o;
    const r = asOf(ls, bar.time);
    if (r !== null && r > 0) point.longShortRatio = r;
    return Object.keys(point).length > 0 ? point : null;
  });

  return { bars, signals };
}
