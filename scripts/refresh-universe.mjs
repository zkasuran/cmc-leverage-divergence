/**
 * Refresh data/cmc20-universe.json from CoinMarketCap's live market-cap ranking.
 * Derives the CMC20 constituents (top 20 ex-stablecoins, ex-wrapped) plus a
 * watchlist (ranks 21-25), and flags each as hedgeable (has a Binance perp).
 *
 *   node scripts/refresh-universe.mjs
 *
 * Uses CMC's free data-api (browser UA) and the Binance perp exchangeInfo. No key.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/149.0 Safari/537.36";

const STABLE = new Set(["USDT","USDC","DAI","TUSD","FDUSD","USDD","USDE","USD1","PYUSD","BUSD","USDS","USDe"]);
const isWrapped = (s, n) =>
  /wrapped|staked/i.test(n) || ["WBTC","WETH","WBNB","STETH","WSTETH","WEETH","WBETH"].includes(s);

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function main() {
  // 1. CMC ranking
  const listing = await getJson(
    "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=40&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all",
  );
  const coins = listing?.data?.cryptoCurrencyList ?? [];

  // 2. Binance perp universe (which symbols have USDT-margined perps)
  let perp = new Set();
  try {
    const ex = await getJson("https://fapi.binance.com/fapi/v1/exchangeInfo");
    for (const s of ex.symbols ?? []) {
      if (s.contractType === "PERPETUAL" && s.quoteAsset === "USDT") perp.add(s.baseAsset);
    }
  } catch (e) {
    console.warn("Binance exchangeInfo failed; falling back to committed hedgeable flags:", String(e).slice(0, 60));
  }

  const eligible = [];
  for (const c of coins) {
    const s = c.symbol, n = c.name, mc = c.quotes?.[0]?.marketCap ?? 0;
    const tags = (c.tags ?? []).map((t) => String(t).toLowerCase());
    if (STABLE.has(s) || tags.includes("stablecoin")) continue;
    if (isWrapped(s, n) || tags.includes("wrapped-tokens")) continue;
    eligible.push({ symbol: s, name: n, mc: Math.round((mc / 1e9) * 10) / 10 });
  }

  const hedge = (s) => (perp.size ? perp.has(s) : true);
  const index20 = eligible.slice(0, 20).map((c, i) => ({ ...c, rank: i + 1, hedgeable: hedge(c.symbol) }));
  const watch = eligible.slice(20, 25).map((c, i) => ({ ...c, rank: 21 + i, hedgeable: hedge(c.symbol) }));

  const out = {
    index20,
    watch,
    tradeable: index20.filter((c) => c.hedgeable).length,
    untradeable: index20.filter((c) => !c.hedgeable).map((c) => c.symbol),
  };

  // If Binance failed, preserve known hedgeable flags from the committed file.
  if (!perp.size) {
    try {
      const prev = JSON.parse(readFileSync(resolve(ROOT, "data/cmc20-universe.json"), "utf8"));
      const known = new Map(prev.index20.concat(prev.watch).map((c) => [c.symbol, c.hedgeable]));
      for (const c of out.index20.concat(out.watch)) if (known.has(c.symbol)) c.hedgeable = known.get(c.symbol);
      out.tradeable = out.index20.filter((c) => c.hedgeable).length;
      out.untradeable = out.index20.filter((c) => !c.hedgeable).map((c) => c.symbol);
    } catch { /* first run, leave defaults */ }
  }

  writeFileSync(resolve(ROOT, "data/cmc20-universe.json"), JSON.stringify(out, null, 1));
  console.log(`Universe refreshed: ${index20.length} constituents, ${out.tradeable} hedgeable, watch ${watch.length}`);
  console.log("  index:", index20.map((c) => c.symbol + (c.hedgeable ? "" : "*")).join(" "));
}

main().catch((e) => { console.error(e); process.exit(1); });
