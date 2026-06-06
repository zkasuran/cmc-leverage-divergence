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

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bar, SignalPoint } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = resolve(HERE, "..", "..", "data");

interface Point {
  time: number;
  value: number;
}

function readJson(dir: string, name: string): any {
  return JSON.parse(readFileSync(resolve(dir, name), "utf8"));
}

/** Binance daily klines -> Bar[] (sorted ascending). */
export function loadBars(dir = DEFAULT_DATA_DIR): Bar[] {
  const raw: any[] = readJson(dir, "btc-1d.json");
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

function loadFunding(dir: string): Point[] {
  const raw: any[] = readJson(dir, "btc-funding.json");
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

function loadOi(dir: string): Point[] {
  const raw: any[] = readJson(dir, "btc-oi.json");
  return raw
    .map((r) => ({ time: Number(r.timestamp), value: Number(r.sumOpenInterest) }))
    .sort((a, b) => a.time - b.time);
}

function loadLs(dir: string): Point[] {
  const raw: any[] = readJson(dir, "btc-ls.json");
  return raw
    .map((r) => ({ time: Number(r.timestamp), value: Number(r.longShortRatio) }))
    .sort((a, b) => a.time - b.time);
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

/** Load bars + aligned signals from the committed snapshots. */
export function loadDataset(dir = DEFAULT_DATA_DIR): Dataset {
  const bars = loadBars(dir);
  const funding = loadFunding(dir);
  const fng = loadFng(dir);
  const oi = loadOi(dir);
  const ls = loadLs(dir);

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
