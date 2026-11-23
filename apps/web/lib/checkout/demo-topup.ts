/**
 * Checkout auto top-up uses the same chunk + cap rule as the faucet.
 * Kept as a thin re-export so existing imports keep resolving while callers
 * move to faucet-policy. No separate 1000-ceiling shortfall mint.
 */
export {
  CAP_UNITS as DEMO_TOPUP_CEILING_UNITS,
  CHUNK_UNITS,
  chunksForShortfall,
  faucetMint,
} from '../faucet-policy.ts';
