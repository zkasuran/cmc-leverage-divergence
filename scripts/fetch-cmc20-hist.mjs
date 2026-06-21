/**
 * Fetch the CMC20 index (CoinMarketCap 20 Index DTF, id 38442) daily price
 * history from CoinMarketCap's keyless data-api and commit it to
 * data/cmc20-hist.json, in the exact shape src/data/cmc-loader.ts parses
 * (data.quotes[].{timeOpen, quote:{open,high,low,close,volume}}).
 *
 * This is what advances the overlay backtest: run it on a schedule and the
 * CMC20 history extends to the latest closed day, so `npm run cmc20` charts the
 * index up to today instead of a frozen snapshot. No API key.
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "..", "data");

// CMC20 index id, and convertId 2781 = USD. Inception was 2025-11-11.
const ID = 38442;
const CONVERT = 2781;
const INCEPTION = 1762819200; // 2025-11-11 00:00:00 UTC
const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/149.0 Safari/537.36";

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const url =
    `https://api.coinmarketcap.com/data-api/v3.1/cryptocurrency/historical` +
    `?id=${ID}&convertId=${CONVERT}&interval=1d&timeStart=${INCEPTION}&timeEnd=${now}`;

  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`CMC historical -> ${res.status}`);
  const json = await res.json();

  const quotes = json?.data?.quotes;
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new Error("CMC historical returned no quotes; refusing to overwrite the snapshot.");
  }
  // Sanity: the shape the loader needs must be present on the last bar.
  const last = quotes[quotes.length - 1];
  if (last?.quote?.close == null || !last?.timeOpen) {
    throw new Error("Unexpected CMC historical shape; refusing to overwrite.");
  }

  writeFileSync(resolve(DATA, "cmc20-hist.json"), JSON.stringify(json));
  console.log(
    `cmc20-hist.json: ${quotes.length} daily bars, ` +
      `${quotes[0].timeOpen.slice(0, 10)} -> ${last.timeOpen.slice(0, 10)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
