/**
 * Fetch fresh perp funding for the CMC20 constituents over the overlay window
 * and commit it to data/cmc20-basket-funding.json. The overlay reads this in
 * preference to the deep-history per-asset files, so its basket signal stays
 * current up to today without disturbing the pinned deep-history validation
 * (event study / placebo / multiasset run on the frozen snapshot, untouched).
 *
 * Binance fundingRate, no key. ~240 days of 8h funding is < 1000 points per
 * symbol, so one page per constituent.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "..", "data");
const FUT = "https://fapi.binance.com";
const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/149.0 Safari/537.36";
const WINDOW_DAYS = 260; // CMC20 inception (2025-11-11) is ~220d ago; pad for the z-window warmup.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  throw new Error(`GET ${url} -> retries exhausted`);
}

async function fetchFunding(pair, startTime) {
  const url = `${FUT}/fapi/v1/fundingRate?symbol=${pair}&startTime=${startTime}&limit=1000`;
  const page = await getJson(url);
  return page.map((r) => [Number(r.fundingTime), Number(r.fundingRate)]);
}

async function main() {
  let universe;
  try {
    universe = JSON.parse(readFileSync(resolve(DATA, "cmc20-constituents.json"), "utf8"));
  } catch {
    throw new Error("data/cmc20-constituents.json missing; run refresh-universe first.");
  }
  const startTime = Date.now() - WINDOW_DAYS * 86_400_000;
  const out = {};
  let ok = 0;
  for (const c of universe) {
    if (!c.pair) continue;
    try {
      const series = await fetchFunding(c.pair, startTime);
      if (series.length > 0) { out[c.prefix] = series; ok++; }
      await sleep(150);
    } catch (e) {
      console.log(`  ${c.pair}: skip (${String(e).slice(0, 50)})`);
    }
  }
  if (ok === 0) throw new Error("no constituent funding fetched; refusing to overwrite.");
  writeFileSync(resolve(DATA, "cmc20-basket-funding.json"), JSON.stringify(out));
  const sample = Object.entries(out)[0];
  console.log(
    `cmc20-basket-funding.json: ${ok} constituents, ` +
      `e.g. ${sample[0]} ${sample[1].length} pts, last ${new Date(sample[1][sample[1].length - 1][0]).toISOString().slice(0, 10)}`,
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
