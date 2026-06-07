import { describe, it, expect } from "vitest";
import { screenOrders, utcDayStart, type RiskCtx } from "../src/engine/riskguard.js";
import { newSimState } from "../src/engine/simulator.js";
import type { Order, RiskPolicy } from "../src/types.js";

// A flat book with healthy equity and no prior loss, priced at 100.
function ctx(over: Partial<RiskCtx> = {}): RiskCtx {
  return {
    now: Date.UTC(2026, 0, 1),
    equity: 10_000,
    peakEquity: 10_000,
    dailyRealisedLoss: 0,
    referencePrice: 100,
    ...over,
  };
}

function buy(size: number, price?: number): Order {
  return { symbol: "BTCUSDT", side: "buy", orderType: price ? "limit" : "market", size, price };
}

describe("RiskGuard.screenOrders", () => {
  it("an empty policy enforces nothing", () => {
    const { accepted, violations } = screenOrders([buy(99)], newSimState(10_000), ctx(), {});
    expect(accepted).toHaveLength(1);
    expect(violations).toHaveLength(0);
  });

  it("rejects a symbol off the allowlist and keeps the allowed one", () => {
    const orders: Order[] = [
      { symbol: "DOGEUSDT", side: "buy", orderType: "market", size: 1 },
      buy(1),
    ];
    const { accepted, violations } = screenOrders(orders, newSimState(10_000), ctx(), {
      symbolAllowlist: ["BTCUSDT", "ETHUSDT"],
    });
    expect(accepted.map((o) => o.symbol)).toEqual(["BTCUSDT"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("symbol-allowlist");
    expect(violations[0]!.action).toBe("reject");
  });

  it("rejects an order over the max order size", () => {
    const { accepted, violations } = screenOrders([buy(5)], newSimState(10_000), ctx(), {
      maxOrderSize: 1,
    });
    expect(accepted).toHaveLength(0);
    expect(violations[0]!.rule).toBe("max-order-size");
  });

  it("values a market order at the reference price for the notional cap", () => {
    // size 2 * referencePrice 100 = 200 notional, over a 150 cap.
    const { accepted, violations } = screenOrders([buy(2)], newSimState(10_000), ctx(), {
      maxNotional: 150,
    });
    expect(accepted).toHaveLength(0);
    expect(violations[0]!.rule).toBe("max-notional");
  });

  it("uses a limit order's own price for the notional cap", () => {
    // size 1 * limit 200 = 200 notional, over a 150 cap (reference price is ignored).
    const { accepted, violations } = screenOrders([buy(1, 200)], newSimState(10_000), ctx(), {
      maxNotional: 150,
    });
    expect(accepted).toHaveLength(0);
    expect(violations[0]!.rule).toBe("max-notional");
  });

  it("caps the post-fill position size including the existing book", () => {
    const state = newSimState(10_000);
    state.size = 0.8; // already long 0.8
    const { accepted, violations } = screenOrders([buy(0.5)], state, ctx(), {
      maxPositionSize: 1,
    });
    expect(accepted).toHaveLength(0);
    expect(violations[0]!.rule).toBe("max-position-size");
  });

  it("rejects when gross exposure would exceed the leverage cap", () => {
    const state = newSimState(10_000);
    state.size = 80; // 80 * 100 = 8000 existing notional
    // + new 30 * 100 = 3000 => 11000 / 10000 = 1.1x, over a 1x cap.
    const { accepted, violations } = screenOrders([buy(30)], state, ctx(), { maxLeverage: 1 });
    expect(accepted).toHaveLength(0);
    expect(violations[0]!.rule).toBe("max-leverage");
  });

  it("fires the drawdown kill switch and halts the rest of the batch", () => {
    // equity 7000 vs peak 10000 = 30% drawdown, at a 20% kill level.
    const orders: Order[] = [buy(1), buy(1)];
    const { accepted, violations } = screenOrders(
      orders,
      newSimState(7_000),
      ctx({ equity: 7_000, peakEquity: 10_000 }),
      { maxDrawdownKill: 0.2 },
    );
    expect(accepted).toHaveLength(0);
    expect(violations).toHaveLength(1); // batch stops on the first kill, not one per order
    expect(violations[0]!.rule).toBe("max-drawdown-kill");
    expect(violations[0]!.action).toBe("kill");
  });

  it("does not kill while drawdown is below the kill level", () => {
    const { accepted, violations } = screenOrders(
      [buy(1)],
      newSimState(9_000),
      ctx({ equity: 9_000, peakEquity: 10_000 }), // 10% < 20%
      { maxDrawdownKill: 0.2 },
    );
    expect(accepted).toHaveLength(1);
    expect(violations).toHaveLength(0);
  });

  it("fires the daily-loss kill switch", () => {
    const { accepted, violations } = screenOrders(
      [buy(1)],
      newSimState(10_000),
      ctx({ dailyRealisedLoss: 600 }),
      { maxDailyLoss: 500 },
    );
    expect(accepted).toHaveLength(0);
    expect(violations[0]!.rule).toBe("max-daily-loss");
    expect(violations[0]!.action).toBe("kill");
  });

  it("a kill stops later orders even if they are individually fine", () => {
    const orders: Order[] = [buy(1), buy(1), buy(1)];
    const { accepted, violations } = screenOrders(
      orders,
      newSimState(7_000),
      ctx({ equity: 7_000, peakEquity: 10_000 }),
      { maxDrawdownKill: 0.2, maxOrderSize: 10 },
    );
    expect(accepted).toHaveLength(0);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.action).toBe("kill");
  });
});

describe("utcDayStart", () => {
  it("collapses any instant in a UTC day to that day's midnight", () => {
    const noon = Date.UTC(2026, 5, 7, 12, 34, 56);
    const midnight = Date.UTC(2026, 5, 7, 0, 0, 0);
    expect(utcDayStart(noon)).toBe(midnight);
  });

  it("two instants on the same UTC day share a day start; the next day differs", () => {
    const a = Date.UTC(2026, 5, 7, 1);
    const b = Date.UTC(2026, 5, 7, 23);
    const c = Date.UTC(2026, 5, 8, 0);
    expect(utcDayStart(a)).toBe(utcDayStart(b));
    expect(utcDayStart(c)).not.toBe(utcDayStart(a));
  });
});
