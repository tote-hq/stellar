'use client';

import { useMemo, type ReactNode } from 'react';

import { E2E_CHECKOUT_ADDRESS } from '../lib/e2e-checkout.ts';
import { WalletContext, type WalletState } from '../lib/use-wallet.ts';

/**
 * A signed-in testnet wallet for the weekly checkout spec.
 *
 * `openEscrow` returns a local id. It does not build a transaction and it
 * does not call a chain. Playwright fulfills the checkout routes, so this
 * provider never reaches Horizon, Soroban, or a faucet.
 */
export function E2eCheckoutWallet({ children }: { children: ReactNode }) {
  const value = useMemo<WalletState>(() => ({
    enabled: true,
    ready: true,
    authenticated: true,
    androidChoices: false,
    kind: 'off',
    address: E2E_CHECKOUT_ADDRESS,
    email: 'e2e@example.test',
    login: () => {},
    loginMobile: async () => {},
    logout: async () => {},
    accessToken: async () => 'e2e-signature',
    signTransaction: async () => {
      throw new Error('e2e wallet does not sign transactions');
    },
    openEscrow: async () => 'e2e-open',
  }), []);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
