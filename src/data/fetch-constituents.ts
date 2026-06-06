import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const SPOT = "https://api.binance.com";
const FUT = "https://fapi.binance.com";
const START = Date.UTC(2017, 0, 1); // pull everything; APIs return from first listing
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(u: string): Promise<any> {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(u, { headers: { "user-agent": "x" } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (a + 1)); continue; }
    throw new Error(`${r.status}`);
  }
  throw new Error("retries");
}

/** Full daily kline history for a spot pair. */
async function klines(pair: string): Promise<any[]> {
  const out: any[] = []; let s = START; const now = Date.now();
  while (s < now) {
    const p: any[] = await getJson(`${SPOT}/api/v3/klines?symbol=${pair}&interval=1d&startTime=${s}&limit=1000`);
    if (!p.length) break; out.push(...p); if (p.length < 1000) break;
    s = (p[p.length - 1][0] as number) + 86_400_000; await sleep(150);
  }
  return out;
}

/** Full funding-rate history for a perp. */
async function funding(pair: string): Promise<any[]> {
  const out: any[] = []; let s = START; const now = Date.now();
  while (s < now) {
    const p: any[] = await getJson(`${FUT}/fapi/v1/fundingRate?symbol=${pair}&startTime=${s}&limit=1000`);
    if (!p.length) break; out.push(...p); if (p.length < 1000) break;
    s = (p[p.length - 1].fundingTime as number) + 1; await sleep(150);
  }
  return out;
}

async function main() {
  const uni = JSON.parse(readFileSync(resolve(DATA, "cmc20-constituents.json"), "utf8"));
  for (const c of uni) {
    // BTC/ETH/BNB/SOL already fetched as full assets by fetch.ts
    if (["btc", "eth", "bnb", "sol"].includes(c.prefix)) continue;
    try {
      const k = await klines(c.pair);
      writeFileSync(resolve(DATA, `${c.prefix}-1d.json`), JSON.stringify(k));
      const f = await funding(c.pair);
      writeFileSync(resolve(DATA, `${c.prefix}-funding.json`), JSON.stringify(f));
      const first = k.length ? new Date(k[0][0]).toISOString().slice(0, 7) : "?";
      console.log(`${c.pair}: ${k.length} bars (from ${first}), ${f.length} funding`);
    } catch (e) {
      console.log(`${c.pair}: FAIL ${String(e).slice(0, 30)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
