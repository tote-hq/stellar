import { expect, test } from '@playwright/test';

import { E2E_CHECKOUT_ADDRESS } from '../apps/web/lib/e2e-checkout';
import { installCheckoutMocks, isForbiddenHost } from './support/checkout-mocks';
import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

/**
 * Test-mode checkout against the local dev server.
 *
 * The store on screen is `/dev/checkout`, which 404s in production. The
 * dialog is the demo escrow path: it quotes, locks, and stops at payment.
 * Día is not paid, no order row is written, and the model is not called.
 * Traces stay off on this project because a future change could put a card
 * or a one-time code on screen, and this repo is public.
 */

const CHAT_ID = 'e2e-checkout-weekly';

test.describe('test-mode checkout', () => {
  test('quotes, locks, and stops at payment without leaving the dev server', async ({ page }) => {
    const errors = collectPageErrors(page);
    const external: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (isForbiddenHost(url)) {
        external.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });
    const calls = installCheckoutMocks(page);

    await page.addInitScript(
      ({ chatId, owner }) => {
        const now = Date.now();
        const cart = {
          retailer: 'dia',
          cartId: 'e2e-cart-weekly',
          total: { centavos: 180_000, display: '$1.800,00' },
          messages: [],
          lines: [
            {
              index: 0,
              skuId: 'sku-leche',
              name: 'Leche entera 1 L',
              quantity: 2,
              sellerId: '1',
              available: true,
              unitPrice: { centavos: 90_000, display: '$900,00' },
              lineTotal: { centavos: 180_000, display: '$1.800,00' },
            },
          ],
        };
        const chat = {
          v: 1,
          id: chatId,
          title: 'Leche',
          createdAt: now,
          updatedAt: now,
          orderState: 'open',
          sessionId: null,
          blocks: [
            { kind: 'user', id: 'b-user', text: 'Leche' },
            { kind: 'cart', id: 'b-cart', cart, handoffUrl: 'https://example.test/cart' },
          ],
          snapshot: { location: { postalCode: 'C1425' } },
          cart,
          handoffUrl: 'https://example.test/cart',
          receipt: null,
        };
        localStorage.setItem('changuito:onboarding:v1', '1');
        localStorage.setItem('changuito:owner', owner);
        localStorage.setItem('changuito:chats', JSON.stringify([
          { id: chatId, title: 'Leche', createdAt: now, updatedAt: now, orderState: 'open' },
        ]));
        localStorage.setItem(`changuito:chat:${chatId}`, JSON.stringify(chat));
      },
      { chatId: CHAT_ID, owner: E2E_CHECKOUT_ADDRESS },
    );

    await page.goto('/');
    await expect(page.getByTestId('composer').or(page.getByTestId('human-gate'))).toBeVisible();
    await expect(page.getByTestId('composer')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('chat-row').click();
    await page.getByRole('button', { name: 'Proceder al pago' }).click();

    await expect(page.getByTestId('checkout-modal')).toBeVisible();
    await expect(page.getByTestId('checkout-demo-note')).toBeVisible();
    await expect(page.getByTestId('checkout-amount')).toHaveText('1.00 USDC');
    await expect(page.getByTestId('checkout-lock')).toBeEnabled();
    expect(calls.quote).toBeGreaterThan(0);
    expect(calls.networks.every((network) => network === 'testnet')).toBe(true);

    await page.getByTestId('checkout-lock').click();
    await expect(page.getByTestId('checkout-done-step')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('checkout-done-step')).toContainText('Llegamos hasta el pago');
    expect(calls.open).toBeGreaterThan(0);
    expect(calls.start).toBeGreaterThan(0);
    expect(calls.status).toBeGreaterThan(0);

    await page.getByTestId('checkout-modal').getByRole('button', { name: 'Listo' }).click();
    await expect(page.getByRole('button', { name: 'Proceder al pago' })).toHaveCount(0);
    await expect(page.getByTestId('receipt')).toContainText('1.00 USDC de prueba');

    expect(external, 'checkout contacted something other than the dev server').toEqual([]);
    expectNoPageErrors(errors);
  });

  test('the fixture store says it is not the supermarket', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/dev/checkout?retailer=dia&total=$1.800,00');
    await expect(page.getByText('Página de prueba. No es el súper y no cobra nada.')).toBeVisible();
    await page.getByTestId('fixture-pay').click();
    await expect(page.getByTestId('fixture-paid')).toBeVisible();
    expectNoPageErrors(errors);
  });
});
