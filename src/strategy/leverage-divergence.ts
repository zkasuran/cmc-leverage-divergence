/**
 * Leverage-divergence strategy.
 *
 * Long-only spot allocator. Each bar it asks the signal module for a target
 * equity fraction in [0, 1] (driven by the funding-vs-price divergence core plus
 * the Fear & Greed tilt and crowding size-down), then rebalances toward that
 * target with a deadband so it does not churn on noise.
 *
 * The strategy holds no state: it reconstructs the price + signal series from the
 * read-only context, so it is deterministic and lookahead-free by construction.
 */

import type { Bar, BarContext, Order, StrategyAgent, SignalPoint } from "../types.js";
import {
  computeFeatures,
  DEFAULT_DIVERGENCE_CONFIG,
  type DivergenceConfig,
} from "../signals/divergence.js";

export interface LeverageDivergenceConfig {
  symbol: string;
  /** Largest equity fraction to hold long. */
  maxFraction: number;
  /** Only rebalance when the target moves by more than this fraction of equity. */
  minRebalance: number;
  /** Signal-module configuration (also the ablation surface). */
  divergence: DivergenceConfig;
}

export const DEFAULT_STRATEGY_CONFIG: LeverageDivergenceConfig = {
  symbol: "BTCUSDT",
  maxFraction: 1,
  minRebalance: 0.1,
  divergence: DEFAULT_DIVERGENCE_CONFIG,
};

/** Overrides accepted by the factory; `divergence` is a partial of the signal config. */
export interface LeverageDivergenceOverrides {
  symbol?: string;
  maxFraction?: number;
  minRebalance?: number;
  divergence?: Partial<DivergenceConfig>;
}

/** Build a strategy instance. Vary `divergence` toggles for ablation runs. */
export function makeLeverageDivergence(
  partial: LeverageDivergenceOverrides = {},
): StrategyAgent {
  const cfg: LeverageDivergenceConfig = {
    ...DEFAULT_STRATEGY_CONFIG,
    ...partial,
    divergence: { ...DEFAULT_DIVERGENCE_CONFIG, ...(partial.divergence ?? {}) },
  };

  return {
    name: "leverage-divergence",

    onBar(bar: Bar, ctx: BarContext): Order[] {
      const closes = [...ctx.history.map((b) => b.close), bar.close];
      const signalSeries: (SignalPoint | null)[] = [
        ...(ctx.signalHistory ?? ctx.history.map(() => null)),
        ctx.signals ?? null,
      ];

      const f = computeFeatures(closes, signalSeries, cfg.divergence);
      if (f === null) return [];

      const price = bar.close;
      if (price <= 0 || ctx.equity <= 0) return [];

      const targetFraction = Math.min(cfg.maxFraction, f.target);
      const desiredSize = (targetFraction * ctx.equity) / price;
      const delta = desiredSize - ctx.position.size;

      // Deadband on the notional move keeps turnover (and fees) sane.
      const moveFraction = Math.abs(delta * price) / ctx.equity;
      if (moveFraction < cfg.minRebalance) return [];

      if (delta > 0) {
        return [{ symbol: cfg.symbol, side: "buy", orderType: "market", size: delta, tag: `tgt=${targetFraction.toFixed(2)} div=${f.divergence.toFixed(2)}` }];
      }
      return [{ symbol: cfg.symbol, side: "sell", orderType: "market", size: -delta, tag: `tgt=${targetFraction.toFixed(2)} div=${f.divergence.toFixed(2)}` }];
    },
  };
}

export default makeLeverageDivergence();
