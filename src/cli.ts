/**
 * CLI for the leverage-divergence backtest.
 *
 *   tsx src/cli.ts backtest      run the full strategy, emit reports/, print summary
 *   tsx src/cli.ts walkforward   per-year (out-of-sample) performance table
 *   tsx src/cli.ts ablation      full + each ablation + baselines, write ablation.csv
 *
 * All commands read the committed snapshots in data/ (no network).
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadDataset, ASSETS, PRIMARY } from "./data/loaders.js";
import { emitReport } from "./report/emit.js";
import { makeLeverageDivergence } from "./strategy/leverage-divergence.js";
import { runStrategy, perYear, ablationSet, type YearRow } from "./runners/run.js";
import { crossAsset, costSensitivity, eventStudy, regimeReturns, realVsProxyFunding } from "./runners/analysis.js";
import { specFromDataset, specFromSnapshot, type CmcSnapshot } from "./spec.js";
import { fetchCmcLive, buildLiveSnapshot } from "./data/cmc.js";
import { checkClose, verdict, type Check } from "./engine/verify.js";
import { walletAction } from "./wallet.js";
import { createHash } from "node:crypto";
import { cmc20Overlay, constituentCoverage } from "./runners/cmc20-overlay.js";
import { readFileSync } from "node:fs";
import type { Metrics } from "./types.js";

const PRIMARY_SYMBOL = ASSETS.find((a) => a.prefix === PRIMARY)?.symbol ?? "BNBUSDT";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS = resolve(HERE, "..", "reports");

function fmt(n: number, d = 2): string {
  return n.toFixed(d);
}

function summarize(label: string, m: Metrics): string {
  return [
    `${label.padEnd(22)}`,
    `ret ${fmt(m.totalReturnPct).padStart(9)}%`,
    `maxDD ${fmt(m.maxDrawdownPct).padStart(7)}%`,
    `Sharpe ${fmt(m.sharpe).padStart(6)}`,
    `trades ${String(m.totalTrades).padStart(4)}`,
    `expo ${fmt(m.exposurePct).padStart(6)}%`,
  ].join("  ");
}

async function cmdBacktest() {
  const { bars, signals } = loadDataset(PRIMARY);
  const { scorecard, fills, equityCurve } = await runStrategy(
    makeLeverageDivergence({ symbol: PRIMARY_SYMBOL }),
    bars,
    signals,
    { symbol: PRIMARY_SYMBOL },
  );
  const outDir = resolve(REPORTS, "full");
  emitReport(scorecard, fills, equityCurve, outDir);
  console.log(`${PRIMARY_SYMBOL}: ${bars.length} daily bars, sha256 ${scorecard.manifest.datasetSha256.slice(0, 12)}…`);
  console.log(summarize("leverage-divergence", scorecard.metrics));
  console.log(`Reports written to ${outDir}/`);
}

async function cmdMultiasset() {
  const rows = await crossAsset();
  console.log("Headline vs buy-and-hold across assets:");
  console.log("asset    strat:Sharpe DD%    ret%   | BH:Sharpe DD%    ret%   | fundOff:Sh | PSR  DSR");
  for (const r of rows) {
    const s = r.headline, b = r.buyHold;
    console.log(
      `${r.symbol.padEnd(8)} ${fmt(s.sharpe)}  ${fmt(s.maxDrawdownPct).padStart(5)} ${fmt(s.totalReturnPct).padStart(8)}` +
      `  | ${fmt(b.sharpe)}  ${fmt(b.maxDrawdownPct).padStart(5)} ${fmt(b.totalReturnPct).padStart(8)}` +
      `  | ${fmt(r.fundingOffSharpe).padStart(6)}   | ${fmt(r.psr)} ${fmt(r.dsr)}`,
    );
  }
  mkdirSync(REPORTS, { recursive: true });
  const csv =
    "asset,strat_sharpe,strat_maxdd,strat_ret,bh_sharpe,bh_maxdd,bh_ret,funding_off_sharpe,psr,dsr\n" +
    rows.map((r) => `${r.symbol},${fmt(r.headline.sharpe)},${fmt(r.headline.maxDrawdownPct)},${fmt(r.headline.totalReturnPct)},${fmt(r.buyHold.sharpe)},${fmt(r.buyHold.maxDrawdownPct)},${fmt(r.buyHold.totalReturnPct)},${fmt(r.fundingOffSharpe)},${fmt(r.psr)},${fmt(r.dsr)}`).join("\n") + "\n";
  writeFileSync(resolve(REPORTS, "multiasset.csv"), csv, "utf8");
  console.log(`\nWrote ${resolve(REPORTS, "multiasset.csv")}`);
}

async function cmdCosts() {
  const rows = await costSensitivity(PRIMARY, PRIMARY_SYMBOL);
  console.log(`Cost sensitivity (${PRIMARY_SYMBOL}), headline strategy:`);
  console.log("fee_bps  slip_bps  return%   maxDD%   Sharpe");
  for (const r of rows) {
    console.log(`${String(r.feeBps).padStart(6)}  ${String(r.slippageBps).padStart(7)}  ${fmt(r.returnPct).padStart(8)}  ${fmt(r.maxDrawdownPct).padStart(6)}  ${fmt(r.sharpe).padStart(6)}`);
  }
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    resolve(REPORTS, "cost-sensitivity.csv"),
    "fee_bps,slippage_bps,return_pct,maxdd_pct,sharpe\n" +
      rows.map((r) => `${r.feeBps},${r.slippageBps},${fmt(r.returnPct)},${fmt(r.maxDrawdownPct)},${fmt(r.sharpe)}`).join("\n") + "\n",
    "utf8",
  );
  console.log(`\nWrote ${resolve(REPORTS, "cost-sensitivity.csv")}`);
}

async function cmdEventStudy() {
  const { bars, signals } = loadDataset(PRIMARY);
  const stats = eventStudy(bars, signals, [7, 30]);
  console.log(`Signal event study (${PRIMARY_SYMBOL}): forward return by divergence state`);
  console.log("horizon  state          n     meanFwd%   hitRate%");
  for (const s of stats) {
    console.log(`${String(s.horizonDays).padStart(5)}d  ${s.state.padEnd(13)} ${String(s.n).padStart(4)}   ${fmt(s.meanForwardPct).padStart(8)}   ${fmt(s.hitRatePct).padStart(7)}`);
  }
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    resolve(REPORTS, "event-study.csv"),
    "horizon_days,state,n,mean_forward_pct,hit_rate_pct\n" +
      stats.map((s) => `${s.horizonDays},${s.state},${s.n},${fmt(s.meanForwardPct)},${fmt(s.hitRatePct)}`).join("\n") + "\n",
    "utf8",
  );
  console.log(`\nWrote ${resolve(REPORTS, "event-study.csv")}`);
}

function printYearTable(rows: YearRow[]) {
  console.log("\nYear   return%     maxDD%   endEquity");
  for (const r of rows) {
    console.log(
      `${r.year}  ${fmt(r.returnPct).padStart(8)}  ${fmt(r.maxDrawdownPct).padStart(8)}  ${fmt(r.endEquity, 0).padStart(10)}`,
    );
  }
}

async function cmdWalkforward() {
  const { bars, signals } = loadDataset();
  const { equityCurve } = await runStrategy(makeLeverageDivergence(), bars, signals);
  const rows = perYear(equityCurve, bars);
  console.log("Per-year, out-of-sample (parameters fixed a priori, never fit to the data):");
  printYearTable(rows);
  mkdirSync(REPORTS, { recursive: true });
  const csv =
    "year,return_pct,maxdd_pct,end_equity\n" +
    rows.map((r) => `${r.year},${fmt(r.returnPct)},${fmt(r.maxDrawdownPct)},${fmt(r.endEquity, 2)}`).join("\n") +
    "\n";
  writeFileSync(resolve(REPORTS, "walkforward.csv"), csv, "utf8");
  console.log(`\nWrote ${resolve(REPORTS, "walkforward.csv")}`);
}

async function cmdAblation() {
  const { bars, signals } = loadDataset();
  const rows: Array<{ label: string; m: Metrics }> = [];
  for (const v of ablationSet()) {
    const { scorecard } = await runStrategy(v.agent, bars, signals);
    rows.push({ label: v.label, m: scorecard.metrics });
    console.log(summarize(v.label, scorecard.metrics));
  }
  mkdirSync(REPORTS, { recursive: true });
  const header = "variant,return_pct,maxdd_pct,sharpe,sortino,win_rate_pct,profit_factor,trades,fees,exposure_pct\n";
  const body = rows
    .map(
      ({ label, m }) =>
        `${label},${fmt(m.totalReturnPct)},${fmt(m.maxDrawdownPct)},${fmt(m.sharpe)},${m.sortino === null ? "" : fmt(m.sortino)},${fmt(m.winRatePct)},${m.profitFactor === null ? "" : fmt(m.profitFactor)},${m.totalTrades},${fmt(m.totalFees, 2)},${fmt(m.exposurePct)}`,
    )
    .join("\n");
  writeFileSync(resolve(REPORTS, "ablation.csv"), header + body + "\n", "utf8");
  console.log(`\nWrote ${resolve(REPORTS, "ablation.csv")}`);
}

async function cmdCmc20() {
  // The unified strategy: time CMC's own index with the funding signal built from
  // its constituents. CMC20 has no perp market, so the signal is the AGGREGATE
  // funding of its majors (BTC/ETH/BNB/SOL) — the same engine, applied to the
  // index it is meant to protect.
  const r = await cmc20Overlay();
  const cov = constituentCoverage();
  console.log(`CMC20 funding-regime overlay (CoinMarketCap 20 Index, id 38442, BEP-20 on BSC)`);
  console.log(`  ${r.bars} daily bars, ${r.firstDay} to ${r.lastDay}`);
  console.log(`  signal = market-cap-weighted funding of ${cov.withFunding}/${cov.total} CMC20 constituents + CMC20 trend gate`);
  console.log(`  basket: ${cov.symbols.join(", ")}`);
  console.log(summarize("overlay (timed CMC20)", r.overlay));
  console.log(summarize("CMC20 buy-and-hold", r.buyHold));
  console.log(`  PSR overlay ${r.overlayPsr.toFixed(3)}  vs buy-hold ${r.buyHoldPsr.toFixed(3)}`);
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(resolve(REPORTS, "cmc20-overlay.json"), JSON.stringify(r, null, 2), "utf8");
  console.log(`\nWrote ${resolve(REPORTS, "cmc20-overlay.json")}`);
}

async function cmdSpec() {
  // `spec --live [--asset BNB]` pulls the latest reading from the keyless CMC
  // data-api (price + aggregate perp funding + open interest) and prices it with
  // the same engine as the backtest. `spec --file <snapshot.json>` prices a
  // hand-assembled snapshot. Default: tail of the committed BNB dataset.
  if (process.argv.includes("--live")) {
    await cmdSpecLive();
    return;
  }
  const fileArg = process.argv.indexOf("--file");
  let spec;
  if (fileArg !== -1 && process.argv[fileArg + 1]) {
    const snap = JSON.parse(readFileSync(process.argv[fileArg + 1]!, "utf8")) as CmcSnapshot;
    spec = specFromSnapshot(snap, new Date(loadDataset(PRIMARY).bars.at(-1)!.time).toISOString());
    if (!spec) { console.error("Not enough data in snapshot to compute a signal."); process.exit(1); }
    console.log(`Strategy spec for ${spec.asset} (live snapshot):`);
  } else {
    const { bars, signals } = loadDataset(PRIMARY);
    spec = specFromDataset(PRIMARY_SYMBOL, bars, signals);
    if (!spec) { console.error("Not enough data to compute a signal."); process.exit(1); }
    console.log(`Strategy spec for ${PRIMARY_SYMBOL} (as-of latest committed bar, same engine as the backtest):`);
  }
  console.log(JSON.stringify(spec, null, 2));
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(resolve(REPORTS, "latest-spec.json"), JSON.stringify(spec, null, 2), "utf8");
  console.error(`\nWrote ${resolve(REPORTS, "latest-spec.json")}`);
}

/** Live path: assemble a snapshot from real keyless CMC data and price it. */
async function cmdSpecLive() {
  const assetArg = process.argv.indexOf("--asset");
  const sym = (assetArg !== -1 && process.argv[assetArg + 1] ? process.argv[assetArg + 1]! : "BNB").toUpperCase();
  const match = ASSETS.find((a) => a.symbol === `${sym}USDT`);
  if (!match) {
    console.error(`No committed history for ${sym}. Available: ${ASSETS.map((a) => a.symbol.replace("USDT", "")).join(", ")}`);
    process.exit(1);
  }
  const prefix = match.prefix;

  // Reproducible historical context: the committed daily closes + funding, tail
  // only. The live CMC reading is appended as the newest bar.
  const { bars, signals } = loadDataset(prefix);
  const histCloses: number[] = [];
  const histFunding: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const f = signals[i]?.fundingRate;
    if (f !== undefined && f !== null) {
      histCloses.push(bars[i]!.close);
      histFunding.push(f);
    }
  }
  const tailCloses = histCloses.slice(-150);
  const tailFunding = histFunding.slice(-150);

  console.error(`Fetching live ${sym} from the CoinMarketCap data-api (keyless)…`);
  const live = await fetchCmcLive(sym, new Date().toISOString());
  if (!Number.isFinite(live.price) || live.price <= 0) {
    console.error(`CMC returned no usable price for ${sym}.`);
    process.exit(1);
  }
  if (live.fundingRate === null || !Number.isFinite(live.fundingRate)) {
    console.error(`CMC returned no perp funding for ${sym}; cannot build a live signal.`);
    process.exit(1);
  }

  const snap = buildLiveSnapshot({
    asset: sym,
    histCloses: tailCloses,
    histFunding: tailFunding,
    price: live.price,
    fundingRate: live.fundingRate,
    openInterest: live.openInterestUsd ?? undefined,
  });
  const spec = specFromSnapshot(snap, live.asOf);
  if (!spec) { console.error("Not enough committed history to price the live reading."); process.exit(1); }

  // Surface the live open interest in the readings and attach data provenance so
  // a reviewer can see exactly which CMC endpoints produced the spec.
  const artifact = {
    ...spec,
    readings: { ...spec.readings, open_interest: live.openInterestUsd },
    data_source: {
      provider: "CoinMarketCap data-api (keyless)",
      asset: sym,
      cmc_id: live.id,
      price_usd: live.price,
      market_cap_usd: live.marketCap,
      aggregate_funding_rate: live.fundingRate,
      open_interest_usd: live.openInterestUsd,
      perp_venues: live.venues,
      btc_dominance_pct: live.btcDominance,
      eth_dominance_pct: live.ethDominance,
      as_of: live.asOf,
      endpoints: live.endpoints,
      note: "Live latest reading from CMC; the z-score/trend windows use committed, reproducible historical snapshots.",
    },
    // How to ACT on the spec: hold the allocation as CMC20 (a real BEP-20 on BNB
    // Chain) in Trust Wallet. The Skill emits the target, it does not place trades.
    trust_wallet: walletAction(spec.target_allocation),
  };

  console.log(`Strategy spec for ${sym} (LIVE from CoinMarketCap, ${live.venues} perp venues):`);
  console.log(JSON.stringify(artifact, null, 2));
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(resolve(REPORTS, "live-spec.json"), JSON.stringify(artifact, null, 2), "utf8");
  console.error(`\nWrote ${resolve(REPORTS, "live-spec.json")}`);
}

async function cmdRegime() {
  const rows = await regimeReturns();
  console.log("Regime-conditional returns (price vs 200-day MA): strategy vs buy-and-hold WITHIN each regime");
  console.log("asset    regime  share%   strat ret%   buy-hold ret%   edge");
  for (const r of rows) {
    const edge = r.stratRetPct - r.bhRetPct;
    console.log(
      `${r.asset.padEnd(8)} ${r.regime.padEnd(5)}  ${fmt(r.share * 100).padStart(5)}  ${fmt(r.stratRetPct).padStart(10)}  ${fmt(r.bhRetPct).padStart(13)}   ${edge >= 0 ? "+" : ""}${fmt(edge)}`,
    );
  }
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    resolve(REPORTS, "regime-returns.csv"),
    "asset,regime,share,strat_ret_pct,bh_ret_pct,edge_pct\n" +
      rows.map((r) => `${r.asset},${r.regime},${fmt(r.share)},${fmt(r.stratRetPct)},${fmt(r.bhRetPct)},${fmt(r.stratRetPct - r.bhRetPct)}`).join("\n") + "\n",
    "utf8",
  );
  console.log(`\nWrote ${resolve(REPORTS, "regime-returns.csv")}`);
}

async function cmdProxy() {
  const rows = await realVsProxyFunding();
  console.log("Real funding vs price-proxy funding (same strategy, same assets):");
  console.log("asset     real:Sharpe  proxy:Sharpe  gain   | real DD%  proxy DD%");
  let wins = 0;
  for (const r of rows) {
    if (r.realSharpe > r.proxySharpe) wins++;
    console.log(`${r.asset.padEnd(9)} ${fmt(r.realSharpe).padStart(8)}   ${fmt(r.proxySharpe).padStart(8)}   ${(r.sharpeGain >= 0 ? "+" : "") + fmt(r.sharpeGain)}   | ${fmt(r.realDD).padStart(6)}   ${fmt(r.proxyDD).padStart(6)}`);
  }
  console.log(`Real funding beats the price-proxy on ${wins}/${rows.length} assets.`);
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    resolve(REPORTS, "real-vs-proxy.csv"),
    "asset,real_sharpe,real_maxdd,real_ret,proxy_sharpe,proxy_maxdd,proxy_ret,sharpe_gain\n" +
      rows.map((r) => `${r.asset},${fmt(r.realSharpe)},${fmt(r.realDD)},${fmt(r.realRet)},${fmt(r.proxySharpe)},${fmt(r.proxyDD)},${fmt(r.proxyRet)},${fmt(r.sharpeGain)}`).join("\n") + "\n",
    "utf8",
  );
  console.log(`\nWrote ${resolve(REPORTS, "real-vs-proxy.csv")}`);
}

async function cmdVerify() {
  // Re-derive the headline numbers from the committed dataset and prove they match
  // the committed reports AND the README. If a number was edited anywhere, a check
  // fails and the verdict is UNVERIFIED. This makes the CLAIMS tamper-evident, not
  // just a log that a signal was emitted.
  const r1 = (x: number) => Number(x.toFixed(1));
  const r2 = (x: number) => Number(x.toFixed(2));
  const committed = JSON.parse(readFileSync(resolve(REPORTS, "cmc20-overlay.json"), "utf8"));
  const checks: Check[] = [];

  // 1. CMC20 overlay: recompute and compare to the committed report.
  const ov = await cmc20Overlay();
  checks.push(checkClose("cmc20.overlay.maxDD", r2(ov.overlay.maxDrawdownPct), r2(committed.overlay.maxDrawdownPct)));
  checks.push(checkClose("cmc20.overlay.return", r2(ov.overlay.totalReturnPct), r2(committed.overlay.totalReturnPct)));
  checks.push(checkClose("cmc20.buyhold.maxDD", r2(ov.buyHold.maxDrawdownPct), r2(committed.buyHold.maxDrawdownPct)));
  checks.push(checkClose("cmc20.overlay.psr", r2(ov.overlayPsr), r2(committed.overlayPsr)));

  // 2. Event study: recompute the 30d confirmed-up row, compare to the committed CSV.
  const { bars, signals } = loadDataset(PRIMARY);
  const es = eventStudy(bars, signals, [7, 30]);
  const row = es.find((r) => r.horizonDays === 30 && r.state === "confirmed-up");
  const esRow = readFileSync(resolve(REPORTS, "event-study.csv"), "utf8")
    .trim().split("\n").map((l) => l.split(",")).find((c) => c[0] === "30" && c[1] === "confirmed-up");
  if (row && esRow) {
    checks.push(checkClose("eventstudy.30d.up.meanFwd", r2(row.meanForwardPct), Number(esRow[3])));
    checks.push(checkClose("eventstudy.30d.up.hitRate", r2(row.hitRatePct), Number(esRow[4])));
  } else {
    checks.push({ label: "eventstudy.30d.up.present", ok: false, got: 0, want: 1 });
  }

  // 3. README headline must match the recomputed overlay (catches a doctored README).
  const readme = readFileSync(resolve(HERE, "..", "README.md"), "utf8");
  const m = readme.match(/drawdown from ([\d.]+)% to ([\d.]+)%/);
  if (m) {
    checks.push(checkClose("README.buyhold.maxDD", r1(ov.buyHold.maxDrawdownPct), Number(m[1])));
    checks.push(checkClose("README.overlay.maxDD", r1(ov.overlay.maxDrawdownPct), Number(m[2])));
  } else {
    checks.push({ label: "README.headline.parse", ok: false, got: 0, want: 1 });
  }

  // Report + dataset fingerprints (recomputed each run, printed for audit).
  console.log("Results verification — recomputed from the committed dataset:\n");
  for (const c of checks) {
    console.log(`  ${c.ok ? "OK  " : "FAIL"}  ${c.label.padEnd(30)} got ${String(c.got).padStart(10)}  want ${String(c.want).padStart(10)}`);
  }
  console.log("\nDataset fingerprints (sha256, first 16):");
  for (const f of ["cmc20-hist.json", "bnb-funding.json", "bnb-1d.json"]) {
    try {
      const h = createHash("sha256").update(readFileSync(resolve(HERE, "..", "data", f))).digest("hex").slice(0, 16);
      console.log(`  ${f.padEnd(20)} ${h}`);
    } catch { /* file optional */ }
  }
  const v = verdict(checks);
  console.log(`\nVERDICT: ${v.verified
    ? "VERIFIED — every headline number reproduces from the committed data"
    : "UNVERIFIED — drift in: " + v.failed.join(", ")}`);
  if (!v.verified) process.exit(1);
}

async function main() {
  const cmd = process.argv[2] ?? "backtest";
  switch (cmd) {
    case "backtest":
      return cmdBacktest();
    case "walkforward":
      return cmdWalkforward();
    case "ablation":
      return cmdAblation();
    case "multiasset":
      return cmdMultiasset();
    case "costs":
      return cmdCosts();
    case "eventstudy":
      return cmdEventStudy();
    case "cmc20":
      return cmdCmc20();
    case "spec":
      return cmdSpec();
    case "regime":
      return cmdRegime();
    case "proxy":
      return cmdProxy();
    case "verify":
      return cmdVerify();
    default:
      console.error(`Unknown command: ${cmd}. Use backtest | walkforward | ablation | multiasset | costs | eventstudy | cmc20 | spec | regime | proxy | verify.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
