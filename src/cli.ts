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
import { crossAsset, costSensitivity, eventStudy, cmc20Benchmark } from "./runners/analysis.js";
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
  const r = await cmc20Benchmark();
  console.log(`CMC20 (CoinMarketCap 20 Index, id 38442, BEP-20 on BSC) — CMC data-api`);
  console.log(`  ${r.bars} daily bars, ${r.firstDay} to ${r.lastDay}`);
  console.log(summarize("strategy (no perp data)", r.strategy));
  console.log(summarize("CMC20 buy-and-hold", r.buyHold));
  console.log("Note: CMC20 has no perp market, so no funding signal fires; the");
  console.log("strategy holds base allocation under the trend gate (capital-preserving).");
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    resolve(REPORTS, "cmc20.json"),
    JSON.stringify(r, null, 2),
    "utf8",
  );
  console.log(`\nWrote ${resolve(REPORTS, "cmc20.json")}`);
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
    default:
      console.error(`Unknown command: ${cmd}. Use backtest | walkforward | ablation | multiasset | costs | eventstudy | cmc20.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
