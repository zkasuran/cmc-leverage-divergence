import { describe, it, expect } from "vitest";
import { CMC20, trustWalletCoinLink, walletAction } from "../src/wallet.js";

describe("Trust Wallet action (hold the spec's allocation as CMC20)", () => {
  it("builds the Trust Wallet open_coin deep link for the CMC20 BEP-20 token", () => {
    const link = trustWalletCoinLink(CMC20.contract);
    expect(link).toBe(
      "https://link.trustwallet.com/open_coin?asset=c20000714_t0x2f8A339B5889FfaC4c5A956787cdA593b3c36867",
    );
  });

  it("turns a target allocation into a hold/cash split with the deep link", () => {
    const a = walletAction(0.1);
    expect(a.holdPct).toBe(10);
    expect(a.cashPct).toBe(90);
    expect(a.token).toBe("CMC20");
    expect(a.contract).toBe(CMC20.contract);
    expect(a.trustWalletLink).toContain("link.trustwallet.com/open_coin");
    expect(a.instruction).toContain("10%");
    expect(a.instruction).toContain("CMC20");
  });

  it("risk-off (0 allocation) means stay fully in cash", () => {
    const a = walletAction(0);
    expect(a.holdPct).toBe(0);
    expect(a.cashPct).toBe(100);
  });

  it("clamps an out-of-range allocation to [0,100]", () => {
    expect(walletAction(1.2).holdPct).toBe(100);
    expect(walletAction(-0.3).holdPct).toBe(0);
  });
});
