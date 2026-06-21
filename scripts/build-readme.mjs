/**
 * Regenerate the CMC20-overlay headline numbers in README.md from the committed
 * report (reports/cmc20-overlay.json), so the README is never hand-asserted and
 * always matches the reproducible backtest after a data refresh. Anchored on the
 * surrounding prose (not the numbers themselves) so it is idempotent across runs.
 *
 * `npm run verify` then stays green because it checks the README drawdown line
 * against the same recomputed overlay.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const o = JSON.parse(readFileSync(resolve(ROOT, "reports/cmc20-overlay.json"), "utf8"));
const ov = o.overlay, bh = o.buyHold;
const f1 = (x) => x.toFixed(1); // 1 decimal, keeps sign
const f2 = (x) => x.toFixed(2);

const ovDD = f1(ov.maxDrawdownPct), bhDD = f1(bh.maxDrawdownPct);
const ovRet = f1(ov.totalReturnPct), bhRet = f1(bh.totalReturnPct);
const ovPsr = f2(o.overlayPsr), bhPsr = f2(o.buyHoldPsr);

let md = readFileSync(resolve(ROOT, "README.md"), "utf8");
const before = md;

const subs = [
  // "cut the drawdown from 40.0% to 15.1%"
  [/drawdown from [\d.]+% to [\d.]+%/g, `drawdown from ${bhDD}% to ${ovDD}%`],
  // "the loss from -35.6% to -12.8%"
  [/loss from -?[\d.]+% to -?[\d.]+%/g, `loss from ${bhRet}% to ${ovRet}%`],
  // "(0.16 overlay vs 0.14 buy-and-hold)" (appears twice)
  [/\([\d.]+ overlay vs [\d.]+ buy-and-hold\)/g, `(${ovPsr} overlay vs ${bhPsr} buy-and-hold)`],
  // table row: | CMC20 buy-and-hold | -35.6% | 40.0% | 0.14 |
  [/\| CMC20 buy-and-hold \| -?[\d.]+% \| [\d.]+% \| [\d.]+ \|/g, `| CMC20 buy-and-hold | ${bhRet}% | ${bhDD}% | ${bhPsr} |`],
  // table row: | **Funding-regime overlay** | **-12.8%** | **15.1%** | **0.16** |
  [/\| \*\*Funding-regime overlay\*\* \| \*\*-?[\d.]+%\*\* \| \*\*[\d.]+%\*\* \| \*\*[\d.]+\*\* \|/g, `| **Funding-regime overlay** | **${ovRet}%** | **${ovDD}%** | **${ovPsr}** |`],
];

let hits = 0;
for (const [re, rep] of subs) {
  md = md.replace(re, () => { hits++; return rep; });
}

if (md !== before) writeFileSync(resolve(ROOT, "README.md"), md);
console.log(
  `build-readme: overlay window ${o.firstDay} -> ${o.lastDay} | ` +
    `dd ${bhDD}->${ovDD} ret ${bhRet}->${ovRet} psr ${ovPsr}/${bhPsr} | ${hits} substitutions`,
);
