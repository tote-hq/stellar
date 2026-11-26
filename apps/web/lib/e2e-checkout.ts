/**
 * Local checkout harness for the weekly Playwright job.
 *
 * It exists only in `next dev` when the weekly workflow sets
 * `NEXT_PUBLIC_E2E_CHECKOUT=1`. A production build never sets that variable,
 * and `NODE_ENV === 'development'` is false there, so the harness cannot
 * mount on a deployment. The address is a public key generated for the
 * fixture. No secret for it is in this repo, and the spec mocks every route
 * that would otherwise touch a ledger, so the key cannot spend.
 */

export const E2E_CHECKOUT_ADDRESS = 'GDFSNQNQSNPYT6ETEMR4HUWSPVQZST3LYYAJADNSL32BCM7V75LID5XT';

export function e2eCheckoutHarness(env: {
  NODE_ENV?: string;
  NEXT_PUBLIC_E2E_CHECKOUT?: string;
} = process.env): boolean {
  return env.NODE_ENV === 'development' && env.NEXT_PUBLIC_E2E_CHECKOUT === '1';
}
