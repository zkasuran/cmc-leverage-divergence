/**
 * Fetch raw historical inputs and commit them to data/ so every backtest is
 * reproducible offline (the loaders never touch the network).
 *
 * Sources, all free and keyless:
 *   - Binance spot klines (daily price)            -> data/btc-1d.json
 *   - Binance perp funding-rate history (8h)       -> data/btc-funding.json
 *   - Alternative.me Fear & Greed full history      -> data/fng.json
 *   - Binance futures OI + long/short (last ~30d)   -> data/btc-oi.json, data/btc-ls.json
 *
 * Run: npm run fetch-data
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "..", "..", "data");

const SPOT = "https://api.binance.com";
const FUT = "https://fapi.binance.com";
const SYMBOL = "BTCUSDT";
const START = Date.UTC(2019, 8, 1); // 2019-09-01, around perp funding inception

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": "cmc-leverage-divergence/0.1" } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  throw new Error(`GET ${url} -> giving up after retries`);
}

/** Page Binance daily klines from START to now (1000 bars/call). */
async function fetchKlines(): Promise<any[]> {
  const out: any[] = [];
  let start = START;
  const now = Date.now();
  while (start < now) {
    const url = `${SPOT}/api/v3/klines?symbol=${SYMBOL}&interval=1d&startTime=${start}&limit=1000`;
    const page: any[] = await getJson(url);
    if (page.length === 0) break;
    out.push(...page);
    const last = page[page.length - 1][0] as number;
    if (page.length < 1000) break;
    start = last + 86_400_000;
    await sleep(300);
  }
  return out;
}

/** Page Binance funding-rate history from START to now (1000/call). */
async function fetchFunding(): Promise<any[]> {
  const out: any[] = [];
  let start = START;
  const now = Date.now();
  while (start < now) {
    const url = `${FUT}/fapi/v1/fundingRate?symbol=${SYMBOL}&startTime=${start}&limit=1000`;
    const page: any[] = await getJson(url);
    if (page.length === 0) break;
    out.push(...page);
    const last = page[page.length - 1].fundingTime as number;
    if (page.length < 1000) break;
    start = last + 1;
    await sleep(300);
  }
  return out;
}

async function main() {
  mkdirSync(DATA, { recursive: true });

  console.log("Fetching daily klines...");
  const klines = await fetchKlines();
  writeFileSync(resolve(DATA, "btc-1d.json"), JSON.stringify(klines));
  console.log(`  ${klines.length} daily bars`);

  console.log("Fetching funding-rate history...");
  const funding = await fetchFunding();
  writeFileSync(resolve(DATA, "btc-funding.json"), JSON.stringify(funding));
  console.log(`  ${funding.length} funding points`);

  console.log("Fetching Fear & Greed history...");
  const fng = await getJson("https://api.alternative.me/fng/?limit=0&format=json");
  writeFileSync(resolve(DATA, "fng.json"), JSON.stringify(fng.data ?? fng));
  console.log(`  ${(fng.data ?? []).length} F&G readings`);

  console.log("Fetching open interest (last ~30d)...");
  const oi = await getJson(`${FUT}/futures/data/openInterestHist?symbol=${SYMBOL}&period=1d&limit=30`);
  writeFileSync(resolve(DATA, "btc-oi.json"), JSON.stringify(oi));
  console.log(`  ${oi.length} OI points`);

  console.log("Fetching long/short ratio (last ~30d)...");
  const ls = await getJson(`${FUT}/futures/data/globalLongShortAccountRatio?symbol=${SYMBOL}&period=1d&limit=30`);
  writeFileSync(resolve(DATA, "btc-ls.json"), JSON.stringify(ls));
  console.log(`  ${ls.length} long/short points`);

  console.log("Done. Snapshots written to data/.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
