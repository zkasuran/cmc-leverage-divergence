/** Buy-and-hold baseline. Buys once after a warmup and holds to the end. */
import type { StrategyAgent } from "../types.js";

export function makeBuyHold(symbol = "BTCUSDT", warmup = 31): StrategyAgent {
  return {
    name: "buy-hold",
    onBar(bar, ctx) {
      if (ctx.index < warmup || ctx.position.size > 0) return [];
      const size = (ctx.equity * 0.99) / bar.close;
      if (size <= 0) return [];
      return [{ symbol, side: "buy", orderType: "market", size }];
    },
  };
}

export default makeBuyHold();
