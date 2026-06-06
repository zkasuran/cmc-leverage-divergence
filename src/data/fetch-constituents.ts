import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const FUT = "https://fapi.binance.com";
const START = Date.UTC(2024, 0, 1);
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
async function ff(pair: string): Promise<any[]> {
  const out: any[] = []; let s = START; const now = Date.now();
  while (s < now) {
    const p: any[] = await getJson(`${FUT}/fapi/v1/fundingRate?symbol=${pair}&startTime=${s}&limit=1000`);
    if (!p.length) break; out.push(...p); if (p.length < 1000) break;
    s = p[p.length - 1].fundingTime + 1; await sleep(200);
  }
  return out;
}
async function main() {
  const uni = JSON.parse(readFileSync(resolve(DATA, "cmc20-constituents.json"), "utf8"));
  for (const c of uni) {
    if (["btc", "eth", "bnb", "sol"].includes(c.prefix)) continue;
    try { const f = await ff(c.pair); writeFileSync(resolve(DATA, `${c.prefix}-funding.json`), JSON.stringify(f)); console.log(`${c.pair}: ${f.length}`); }
    catch (e) { console.log(`${c.pair}: FAIL ${String(e).slice(0, 30)}`); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
