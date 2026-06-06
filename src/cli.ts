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
import { loadDataset } from "./data/loaders.js";
import { emitReport } from "./report/emit.js";
import { makeLeverageDivergence } from "./strategy/leverage-divergence.js";
import { runStrategy, perYear, ablationSet, type YearRow } from "./runners/run.js";
import type { Metrics } from "./types.js";

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
  const { bars, signals } = loadDataset();
  const { scorecard, fills, equityCurve } = await runStrategy(makeLeverageDivergence(), bars, signals);
  const outDir = resolve(REPORTS, "full");
  emitReport(scorecard, fills, equityCurve, outDir);
  console.log(`Dataset: ${bars.length} daily bars, sha256 ${scorecard.manifest.datasetSha256.slice(0, 12)}…`);
  console.log(summarize("leverage-divergence", scorecard.metrics));
  console.log(`Reports written to ${outDir}/`);
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

async function main() {
  const cmd = process.argv[2] ?? "backtest";
  switch (cmd) {
    case "backtest":
      return cmdBacktest();
    case "walkforward":
      return cmdWalkforward();
    case "ablation":
      return cmdAblation();
    default:
      console.error(`Unknown command: ${cmd}. Use backtest | walkforward | ablation.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
