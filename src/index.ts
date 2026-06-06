/**
 * cmc-leverage-divergence — a backtestable crypto strategy built on the
 * funding-rate-vs-price divergence signal, with a reproducible backtest engine.
 *
 * The public surface: the signal module, the strategy, the data loaders, and the
 * vendored backtest engine (extended to carry exogenous market-structure signals).
 */

// Types (public contract)
export type {
  Bar, Order, Fill, Position, RiskPolicy, Violation,
  EngineConfig, Metrics, RunManifest, Scorecard, Granularity,
  StrategyAgent, BarContext, RunMeta, SignalPoint,
} from "./types.js";
export { BarSchema, OrderSchema, SignalPointSchema, ScorecardSchema, GRANULARITIES } from "./types.js";

// Engine (vendored, signal-aware)
export { runBacktest } from "./engine/backtest.js";
export type { BacktestInput, RunResult, ManifestInput } from "./engine/backtest.js";
export { computeMetrics } from "./engine/metrics.js";
export { screenOrders } from "./engine/riskguard.js";

// Signals + strategy
export {
  computeFeatures, mean, std, zscore,
  DEFAULT_DIVERGENCE_CONFIG,
} from "./signals/divergence.js";
export type { DivergenceConfig, Features } from "./signals/divergence.js";
export {
  makeLeverageDivergence, DEFAULT_STRATEGY_CONFIG,
} from "./strategy/leverage-divergence.js";
export type { LeverageDivergenceConfig, LeverageDivergenceOverrides } from "./strategy/leverage-divergence.js";

// Baselines
export { makeBuyHold } from "./baselines/buy-hold.js";
export { makeFngOnly } from "./baselines/fng-only.js";

// Data + reports + runners
export { loadDataset, loadBars, asOf, DEFAULT_DATA_DIR, ASSETS, PRIMARY } from "./data/loaders.js";
export type { Dataset } from "./data/loaders.js";
export { emitReport, hashDataset } from "./report/emit.js";
export { runStrategy, perYear, ablationSet } from "./runners/run.js";
export type { YearRow, Variant, RunOpts } from "./runners/run.js";
export { crossAsset, costSensitivity, eventStudy, cmc20Benchmark, regimeReturns } from "./runners/analysis.js";
export type { AssetResult, CostRow, EventStat, DivState, Cmc20Result } from "./runners/analysis.js";
export { loadCmc20Bars, loadCmc20Signals } from "./data/cmc-loader.js";
export { cmc20Overlay, buildBasketSignals } from "./runners/cmc20-overlay.js";
export type { OverlayResult } from "./runners/cmc20-overlay.js";

// Spec generator — the bridge: same signal code the backtest uses, emitting the
// live strategy spec the Skill documents.
export {
  specFromSnapshot, specFromDataset, specFromFeatures,
} from "./spec.js";
export type { StrategySpec, CmcSnapshot, SignalState } from "./spec.js";

// Statistics (probabilistic + deflated Sharpe)
export {
  probabilisticSharpe, deflatedSharpe, sharpePerPeriod, returnsFromEquity,
} from "./engine/stats.js";
