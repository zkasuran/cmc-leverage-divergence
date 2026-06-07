/**
 * Trust Wallet action.
 *
 * The Skill outputs a target allocation. It does not place trades. To ACT on the
 * spec a user holds CMC20, CoinMarketCap's own index, which is a real BEP-20 on BNB
 * Smart Chain and is holdable in Trust Wallet. This turns the spec's allocation into
 * a hold/cash split plus a Trust Wallet deep link to that exact token. That is the
 * honest third-sponsor tie (CMC data -> BNB Chain token -> Trust Wallet), no faked
 * execution.
 *
 * Deep-link format and contract are verified against developer.trustwallet.com
 * (Universal Asset ID: c20000714 = BNB Smart Chain, _t<contract> = the BEP-20) and
 * BscScan (the CMC20 DTF by Reserve).
 */

export const CMC20 = {
  token: "CMC20",
  name: "CoinMarketCap 20 Index DTF",
  chain: "BNB Smart Chain",
  /** SLIP-44-style Trust Wallet coin id for BNB Smart Chain (chainId 56). */
  chainCoinId: "c20000714",
  contract: "0x2f8A339B5889FfaC4c5A956787cdA593b3c36867",
} as const;

/** Trust Wallet deep link that opens a BEP-20 token's page in the app. */
export function trustWalletCoinLink(contract: string): string {
  return `https://link.trustwallet.com/open_coin?asset=${CMC20.chainCoinId}_t${contract}`;
}

export interface WalletAction {
  token: string;
  contract: string;
  chain: string;
  holdPct: number;
  cashPct: number;
  instruction: string;
  trustWalletLink: string;
}

/** Turn a target allocation in [0,1] into a hold/cash split + a Trust Wallet link. */
export function walletAction(targetAllocation: number): WalletAction {
  const holdPct = Math.round(Math.max(0, Math.min(1, targetAllocation)) * 100);
  const cashPct = 100 - holdPct;
  const instruction =
    holdPct === 0
      ? `Stay fully in cash (0% CMC20). Risk-off: the signal says do not hold the index now.`
      : `Hold ${holdPct}% in CMC20 (BEP-20 on BNB Chain) and ${cashPct}% in cash/stables.`;
  return {
    token: CMC20.token,
    contract: CMC20.contract,
    chain: CMC20.chain,
    holdPct,
    cashPct,
    instruction,
    trustWalletLink: trustWalletCoinLink(CMC20.contract),
  };
}
