/**
 * Backtest loop — the orchestrator.
 *
 * Load bars → for each bar, call agent → RiskGuard → simulator → collect.
 * After the full run, compute metrics and emit the scorecard + ledger.
 */

import type { Bar, StrategyAgent, EngineConfig, RiskPolicy, Fill, Violation, BarContext, Position, RunManifest, Scorecard, SignalPoint } from "../types.js";
import { newSimState, executeOrder } from "./simulator.js";
import type { SimState } from "./simulator.js";
import { screenOrders, utcDayStart, type RiskCtx } from "./riskguard.js";
import { computeMetrics } from "./metrics.js";

/** Identity fields the caller provides; engine + risk + schemaVersion are added internally. */
export type ManifestInput = Pick<
  RunManifest,
  "agentbenchVersion" | "symbol" | "granularity" | "source" |
  "bars" | "firstBarTime" | "lastBarTime" | "datasetSha256"
>;

export interface BacktestInput {
  agent: StrategyAgent;
  bars: readonly Bar[];
  /**
   * Optional exogenous signals, index-aligned with `bars` (signals[i] is the
   * reading known as-of bars[i]'s open). Use `null` for a gap. Left undefined,
   * the run is price-only and `ctx.signals` is undefined.
   */
  signals?: readonly (SignalPoint | null)[];
  config: EngineConfig;
  risk: RiskPolicy;
  manifest: ManifestInput;
}

export interface RunResult {
  scorecard: Scorecard;
  fills: Fill[];
  violations: Violation[];
  equityCurve: number[];
}

/**
 * Run a full backtest. Returns the scorecard and raw ledger for the caller
 * to emit to files.
 */
export async function runBacktest(input: BacktestInput): Promise<RunResult> {
  const { agent, bars, signals, config, risk, manifest: manifestInput } = input;
  const state = newSimState(config.startingEquity);
  const fills: Fill[] = [];
  const violations: Violation[] = [];
  const equityCurve: number[] = [config.startingEquity];
  const positionHeld: boolean[] = [false]; // flat before the first bar

  let peakEquity = config.startingEquity;
  let dailyLoss = 0;
  let currentDay = 0;

  // Call agent init hook if present
  const meta = {
    symbol: manifestInput.symbol,
    granularity: manifestInput.granularity,
    bars: bars.length,
  };
  await agent.init?.(meta);

  // Main bar loop: agent sees bar[i], orders execute against bar[i+1]
  for (let i = 0; i < bars.length - 1; i++) {
    const currentBar = bars[i]!;
    const nextBar = bars[i+1]!;

    // Build read-only context for the agent
    const position: Position = {
      symbol: manifestInput.symbol,
      size: state.size,
      avgPrice: state.avgPrice,
    };
    const ctx: BarContext = {
      index: i,
      history: bars.slice(0, i),
      position,
      equity: equityCurve[equityCurve.length - 1]!,
      cash: state.cash,
      // Signals are capped at the current bar exactly like price history:
      // `signals` is the as-of reading for bar i, `signalHistory` holds the
      // strictly-prior readings. No lookahead is possible.
      signals: signals ? (signals[i] ?? null) : undefined,
      signalHistory: signals ? signals.slice(0, i) : undefined,
    };

    // 1. Agent decides
    let orders;
    try {
      orders = await agent.onBar(currentBar, ctx);
    } catch (err) {
      // Agent threw — record, skip this bar, continue (or halt on policy)
      violations.push({
        time: currentBar.time,
        rule: "agent-error",
        detail: `Agent onBar threw: ${String(err)}`,
        action: "kill",
      });
      break;
    }

    if (orders.length === 0) {
      // No trade: equity unchanged, record whether a position is still open.
      equityCurve.push(state.cash + state.size * nextBar.close);
      positionHeld.push(state.size !== 0);
      continue;
    }

    // 2. Risk context + screening. Market orders are valued at the execution
    // bar's open (where they fill) so notional/leverage caps actually bind.
    const riskCtx: RiskCtx = {
      now: nextBar.time,
      equity: ctx.equity,
      peakEquity,
      dailyRealisedLoss: dailyLoss,
      referencePrice: nextBar.open,
    };

    const { accepted, violations: vios } = screenOrders(
      orders,
      state,
      riskCtx,
      risk,
    );
    violations.push(...vios);

    const kill = vios.find((v) => v.action === "kill");
    if (kill) break;

    // 3. Execute accepted orders against the next bar. Track only the fills
    // produced on THIS bar so daily-loss is not double-counted.
    let barRealisedLoss = 0;
    for (const order of accepted) {
      const fill = executeOrder(order, nextBar, state, config);
      if (fill) {
        fills.push(fill);
        if (fill.realizedPnl < 0) barRealisedLoss += Math.abs(fill.realizedPnl);
      }
    }

    // Re-mark equity at the bar's close.
    const markedEquity = state.cash + state.size * nextBar.close;
    equityCurve.push(markedEquity);
    positionHeld.push(state.size !== 0);

    if (markedEquity > peakEquity) peakEquity = markedEquity;

    // Accumulate realised loss within the current UTC day; reset on day change.
    const day = utcDayStart(nextBar.time);
    if (day !== currentDay) {
      currentDay = day;
      dailyLoss = 0;
    }
    dailyLoss += barRealisedLoss;
  }

  // Compute metrics
  const metrics = computeMetrics({
    equity: equityCurve,
    fills,
    violations,
    granularity: manifestInput.granularity,
    riskFree: 0,
    startingEquity: config.startingEquity,
    totalBars: bars.length,
    positionHeld,
  });

  const manifest: RunManifest = {
    ...manifestInput,
    schemaVersion: 1,
    engine: config,
    risk,
  };

  const scorecard: Scorecard = {
    agent: agent.name ?? "unnamed",
    metrics,
    manifest,
  };

  return { scorecard, fills, violations, equityCurve };
}
