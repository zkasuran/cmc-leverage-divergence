/**
 * Build the static frontend (index.html + demo/index.html) from the committed
 * reports and the live CMC20 universe. Run after `npm run fetch-data` and the
 * report regeneration so the page reflects fresh data.
 *
 *   node scripts/build-frontend.mjs
 *
 * The HTML shell lives in scripts/frontend-template.html with a single
 * `/*__DATA__*\/` marker; this script computes the 7 data vars and injects them.
 * No network, no deps — pure fs + the existing report files.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => resolve(ROOT, p);

function json(p) {
  return JSON.parse(readFileSync(R(p), "utf8"));
}
function csv(p) {
  const lines = readFileSync(R(p), "utf8").trim().split("\n");
  const head = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const o = {};
    head.forEach((h, i) => (o[h] = cells[i]));
    return o;
  });
}
const f = (v, d = 2) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : v;
};

// --- Load reports ---
const overlay = json("reports/cmc20-overlay.json");
const ov = overlay.overlay;
const bh = overlay.buyHold;
const spec = json("reports/latest-spec.json");
const universe = json("data/cmc20-universe.json");
const multiRows = csv("reports/multiasset.csv");
const eventRows = csv("reports/event-study.csv");
const regimeRows = csv("reports/regime-returns.csv");
const ablationRows = csv("reports/ablation.csv");

// --- Build the 7 data objects (shape must match the template's render JS) ---
const OVERLAY = {
  ovRet: f(ov.totalReturnPct, 1), ovDD: f(ov.maxDrawdownPct, 1), ovPsr: f(overlay.overlayPsr, 2),
  bhRet: f(bh.totalReturnPct, 1), bhDD: f(bh.maxDrawdownPct, 1), bhPsr: f(overlay.buyHoldPsr, 2),
  ddCut: f(bh.maxDrawdownPct - ov.maxDrawdownPct, 1),
  lossCut: f(ov.totalReturnPct - bh.totalReturnPct, 1),
  bars: overlay.bars, firstDay: overlay.firstDay, lastDay: overlay.lastDay,
};
const BEAR = regimeRows.filter((r) => r.regime === "bear").map((r) => ({
  asset: r.asset.replace("USDT", ""),
  strat: Math.round(Number(r.strat_ret_pct)),
  bh: Math.round(Number(r.bh_ret_pct)),
  edge: Math.round(Number(r.edge_pct)),
}));
const EVENT = eventRows.map((r) => ({
  horizon_days: r.horizon_days, state: r.state, n: Number(r.n),
  mean_forward_pct: f(r.mean_forward_pct), hit_rate_pct: f(r.hit_rate_pct),
}));
const MULTI = multiRows.map((r) => ({
  asset: r.asset, strat_sharpe: f(r.strat_sharpe), strat_maxdd: f(r.strat_maxdd),
  strat_ret: f(r.strat_ret), bh_sharpe: f(r.bh_sharpe), bh_maxdd: f(r.bh_maxdd),
  bh_ret: f(r.bh_ret), dsr: f(r.dsr),
}));
const ABLATION = ablationRows.slice(0, 6).map((r) => ({
  variant: r.variant, sharpe: f(r.sharpe), maxdd_pct: f(r.maxdd_pct),
}));
const SPEC = {
  asset: spec.asset, as_of: spec.as_of.slice(0, 10), state: spec.signal.state,
  score: spec.signal.score, target: spec.target_allocation, regime: spec.regime,
  fundingZ: f(spec.readings.funding_z), fng: spec.readings.fear_greed,
  priceRet: f(spec.readings.price_return_lookback),
};
const UNI = universe;

const dataLine =
  `var OVERLAY=${JSON.stringify(OVERLAY)};` +
  `var BEAR=${JSON.stringify(BEAR)};` +
  `var EVENT=${JSON.stringify(EVENT)};` +
  `var MULTI=${JSON.stringify(MULTI)};` +
  `var ABLATION=${JSON.stringify(ABLATION)};` +
  `var SPEC=${JSON.stringify(SPEC)};` +
  `var UNI=${JSON.stringify(UNI)};`;

const template = readFileSync(R("scripts/frontend-template.html"), "utf8");
if (!template.includes("/*__DATA__*/")) {
  console.error("Template missing /*__DATA__*/ marker"); process.exit(1);
}
const html = template.replace("/*__DATA__*/", dataLine);

writeFileSync(R("index.html"), html);
writeFileSync(R("demo/index.html"), html);
console.log(`Frontend rebuilt: ${html.length} chars`);
console.log(`  CMC20 overlay: ${OVERLAY.ovDD}% DD vs ${OVERLAY.bhDD}% buy-hold`);
console.log(`  constituents: ${UNI.index20.length} (${UNI.tradeable} hedgeable), watch: ${UNI.watch.length}`);
console.log(`  spec as-of ${SPEC.as_of}: ${SPEC.regime}, target ${SPEC.target}`);
