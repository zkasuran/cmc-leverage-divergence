/**
 * Fear & Greed-only contrarian baseline. Long fraction scales with how fearful
 * the market is, with no funding/divergence input. Isolates how much of the
 * edge is just "buy fear" vs the funding-divergence core.
 */
import type { StrategyAgent } from "../types.js";

export function makeFngOnly(
  symbol = "BTCUSDT",
  minRebalance = 0.1,
  fngMid = 50,
  fngScale = 50,
): StrategyAgent {
  return {
    name: "fng-only",
    onBar(bar, ctx) {
      const fng = ctx.signals?.fearGreed;
      if (fng === undefined || fng === null) return [];
      const target = Math.max(0, Math.min(1, (fngMid - fng) / fngScale));
      const desired = (target * ctx.equity) / bar.close;
      const delta = desired - ctx.position.size;
      if (Math.abs(delta * bar.close) / ctx.equity < minRebalance) return [];
      return [
        { symbol, side: delta > 0 ? "buy" : "sell", orderType: "market", size: Math.abs(delta) },
      ];
    },
  };
}

export default makeFngOnly();
