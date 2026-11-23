/**
 * How far a dual-mock checkout tops a testnet wallet up.
 * The ordinary faucet still grants 50 USDC and stops at 100. This ceiling is
 * only for the demo flags, and the route decides when it applies.
 * No imports: the faucet tests load this file by stripping types.
 */

/** 1000.00 USDC, in token units (6 decimals). */
export const DEMO_TOPUP_CEILING_UNITS = 10_000_000_000n;

/**
 * Units still missing to reach the ceiling.
 * Zero when the balance is already there. A negative balance is treated as empty.
 */
export function demoTopUpShortfall(balanceUnits: bigint): bigint {
  const balance = balanceUnits > 0n ? balanceUnits : 0n;
  if (balance >= DEMO_TOPUP_CEILING_UNITS) return 0n;
  return DEMO_TOPUP_CEILING_UNITS - balance;
}
