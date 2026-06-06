import { describe, it, expect } from "vitest";
import { runBacktest } from "../src/engine/backtest.js";
import type { Bar, BarContext, Order, SignalPoint, StrategyAgent } from "../src/types.js";

/** A few flat bars so the loop runs without trading noise. */
function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 86_400_000,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }));
}

describe("engine threads signals with no lookahead", () => {
  it("ctx.signals is the current bar and signalHistory holds only prior bars", async () => {
    const n = 6;
    // Encode each bar's index into its funding rate so we can assert alignment.
    const signals: (SignalPoint | null)[] = Array.from({ length: n }, (_, i) => ({
      fundingRate: i,
    }));

    const seen: Array<{ index: number; current: number | undefined; histLen: number; lastHist: number | undefined }> = [];
    const probe: StrategyAgent = {
      name: "probe",
      onBar(_bar: Bar, ctx: BarContext): Order[] {
        seen.push({
          index: ctx.index,
          current: ctx.signals?.fundingRate,
          histLen: ctx.signalHistory?.length ?? -1,
          lastHist: ctx.signalHistory?.[ctx.signalHistory.length - 1]?.fundingRate ?? undefined,
        });
        return [];
      },
    };

    await runBacktest({
      agent: probe,
      bars: bars(n),
      signals,
      config: { startingEquity: 10_000, feeBps: 10, slippageBps: 1, seed: 1 },
      risk: {},
      manifest: {
        agentbenchVersion: "0.1.0",
        symbol: "BTCUSDT",
        granularity: "1day",
        source: "binance-cmc",
        bars: n,
        firstBarTime: 0,
        lastBarTime: (n - 1) * 86_400_000,
        datasetSha256: "test",
      },
    });

    // The loop visits bars 0..n-2 (orders fill against the next bar).
    expect(seen.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    for (const s of seen) {
      // current signal === this bar's encoded index (no future leak)
      expect(s.current).toBe(s.index);
      // history length === index, last history element === index-1
      expect(s.histLen).toBe(s.index);
      if (s.index > 0) expect(s.lastHist).toBe(s.index - 1);
    }
  });

  it("price-only run leaves ctx.signals undefined", async () => {
    let sawUndefined = true;
    const probe: StrategyAgent = {
      onBar(_bar, ctx) {
        if (ctx.signals !== undefined || ctx.signalHistory !== undefined) sawUndefined = false;
        return [];
      },
    };
    await runBacktest({
      agent: probe,
      bars: bars(4),
      config: { startingEquity: 10_000, feeBps: 10, slippageBps: 1, seed: 1 },
      risk: {},
      manifest: {
        agentbenchVersion: "0.1.0",
        symbol: "BTCUSDT",
        granularity: "1day",
        source: "fixture",
        bars: 4,
        firstBarTime: 0,
        lastBarTime: 3 * 86_400_000,
        datasetSha256: "test",
      },
    });
    expect(sawUndefined).toBe(true);
  });
});
