/**
 * Simulator — deterministic fill matching against OHLCV bars.
 *
 * Fill rules (conservative, no-lookahead, bar-by-bar backtest):
 * - Agent sees bar N's close, decides orders.
 * - Orders execute against bar N+1 (the "next" bar).
 * - Market order: fills at next bar's open.
 * - Limit buy:  fills at limit price if next bar's low <= limit price.
 * - Limit sell: fills at limit price if next bar's high >= limit price.
 * - Slippage (market orders only): moves fill price against the trader by
 *   `slippageBps` basis points before fee.
 * - Fee: Bitget spot standard 0.1% (10 bps) of notional, verified 2026-06-05.
 *
 * Returns the fill if the order was matched, or null if it was not.
 */

import type { Order, Fill, EngineConfig } from "../types.js";

/** Mutable position + cash state mutated by the simulator. */
export interface SimState {
  /** Signed base size (positive = long, negative = short). 0 = flat. */
  size: number;
  /** Volume-weighted average entry price of the open position. */
  avgPrice: number;
  /** Free quote-currency balance available for new orders. */
  cash: number;
  /** Running counter used to label fills with a monotonic index. */
  nextFillId: number;
}

/** Create a fresh sim state with the given starting cash. */
export function newSimState(startingEquity: number): SimState {
  return { size: 0, avgPrice: 0, cash: startingEquity, nextFillId: 0 };
}

/**
 * Attempt to fill an order against a single bar.
 * Returns null if the order cannot fill (e.g. limit not hit).
 * The caller owns updating the `SimState` via {@link applyFill}.
 */
export function fillOrder(
  order: Order,
  bar: { open: number; high: number; low: number; close: number; time: number },
  config: EngineConfig,
  /** Monotonic fill index. */
  fillId: number,
): Fill | null {
  const { side, orderType, symbol, size, tag } = order;
  const feeBps = config.feeBps;
  const slippageBps = config.slippageBps;

  let fillPrice: number | null = null;
  let isMarket = false;

  if (orderType === "market") {
    isMarket = true;
    // Market order fills at the bar open (first available price).
    fillPrice = bar.open;
  } else if (orderType === "limit" && order.price !== undefined) {
    if (side === "buy" && bar.low <= order.price) {
      fillPrice = order.price;
    } else if (side === "sell" && bar.high >= order.price) {
      fillPrice = order.price;
    }
  }

  if (fillPrice === null) return null;

  // Apply slippage to market orders only (worsens the price for the trader).
  const slippageFactor = isMarket ? slippageBps / 10_000 : 0;
  const slippedPrice =
    side === "buy"
      ? fillPrice * (1 + slippageFactor)
      : fillPrice * (1 - slippageFactor);

  const notional = slippedPrice * size;
  const fee = notional * (feeBps / 10_000);

  const fill: Fill = {
    time: bar.time,
    symbol,
    side,
    orderType,
    size,
    price: slippedPrice,
    fee,
    slippage: isMarket ? Math.abs(slippedPrice - fillPrice) * size : 0,
    realizedPnl: 0, // computed by applyFill
    equityAfter: 0, // computed by applyFill
    tag,
  };

  return fill;
}

/**
 * Apply a fill to the simulation state, updating position and cash.
 * Returns the fill with `realizedPnl` and `equityAfter` set, or null if the
 * order was a sell against no position (a no-op, no ledger row).
 */
export function applyFill(fill: Fill, state: SimState): Fill | null {
  const { side, size, price, fee } = fill;
  const notional = price * size;

  let realizedPnl = 0;

  if (side === "buy") {
    // Opening or adding to long.
    const totalSize = state.size + size;
    const oldCostBasis = state.avgPrice * state.size;
    const newCostBasis = notional;
    state.avgPrice =
      totalSize > 0 ? (oldCostBasis + newCostBasis) / totalSize : 0;
    state.size += size;
    state.cash -= notional + fee;
  } else {
    // sell — closing or reducing a long. Long-only spot MVP: a sell larger
    // than the held position is clamped to the held size (no shorting). This
    // prevents the engine from crediting cash for base the agent never held.
    // Shorts are an explicit stretch feature (futures), not enabled here.
    const filledSize = Math.min(size, Math.max(state.size, 0));

    // Nothing to sell (flat or short request on no position): no-op, no
    // phantom row in the ledger.
    if (filledSize <= 0) return null;

    const filledNotional = price * filledSize;
    const filledFee = filledNotional * (fee / notional || 0); // same bps rate
    if (state.avgPrice > 0) {
      realizedPnl = (price - state.avgPrice) * filledSize;
    }
    state.size -= filledSize;
    if (state.size <= 0) {
      state.size = 0;
      state.avgPrice = 0;
    }
    // avgPrice stays put for partial closes (VWAP on remaining position).
    state.cash += filledNotional - filledFee;

    // Reflect the clamp in the fill record so the ledger is honest, including
    // slippage scaled to the size that actually filled.
    fill.slippage = size > 0 ? fill.slippage * (filledSize / size) : 0;
    fill.size = filledSize;
    fill.fee = filledFee;
  }

  const equity = state.cash + state.size * price; // mark-to-market
  state.nextFillId++;

  fill.realizedPnl = realizedPnl;
  fill.equityAfter = equity;

  return fill;
}

/**
 * Convenience: fill an order, apply it, return Fill or null.
 * One call instead of fillOrder + applyFill for the common case.
 */
export function executeOrder(
  order: Order,
  bar: { open: number; high: number; low: number; close: number; time: number },
  state: SimState,
  config: EngineConfig,
): Fill | null {
  const f = fillOrder(order, bar, config, state.nextFillId);
  if (!f) return null;
  return applyFill(f, state);
}
