import { expect, test, type Page } from '@playwright/test';

import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

/**
 * Opt-in proof of the dual mock pay cards under the Día vs Coto card.
 *
 * One stored chat, no model call, no config flip. `npm run test:e2e` leaves
 * `DUAL_CHECKOUT_E2E` unset and this test skips.
 */

const CHAT_ID = 'e2e-checkout-105';
const TITLE = 'Leche';
const HANDOFF =
  'https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=e2e-cart-105#/cart';

const DIA_LABEL = 'Pagar el changuito completo de Día';
const COTO_LABEL = 'Pagar las líneas que coinciden en Coto';

const CART_BLOCK = {
  kind: 'cart',
  id: 'b-cart',
  dualCheckout: true,
  handoffUrl: HANDOFF,
  cart: {
    retailer: 'dia',
    cartId: 'e2e-cart-105',
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
  },
};

const COMPARE_BLOCK = {
  kind: 'compare',
  id: 'b-compare',
  status: 'ok',
  checkoutDemo: true,
  cartId: 'e2e-cart-105',
  handoffUrl: HANDOFF,
  matched: 1,
  lines: 1,
  gap: { diaSubtotalCentavos: 180_000, cotoSubtotalCentavos: 155_000, gapCentavos: 25_000 },
  rows: [
    {
      skuId: 'sku-leche',
      name: 'Leche entera 1 L',
      quantity: 2,
      diaLineCentavos: 180_000,
      confidence: 'ean',
      coto: {
        id: 'coto-leche',
        name: 'Leche entera Coto',
        shelfCentavos: 77_500,
        lineCentavos: 155_000,
        available: true,
        url: 'https://www.coto.com.ar/product/leche',
      },
    },
  ],
};

async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    ({ chatId, title, handoff, cart, compare }) => {
      const now = Date.now();
      const index = [{ id: chatId, title, createdAt: now, updatedAt: now, orderState: 'open' }];
      const chat = {
        v: 1,
        id: chatId,
        title,
        createdAt: now,
        updatedAt: now,
        orderState: 'open',
        sessionId: 'e2e-session-105',
        blocks: [{ kind: 'user', id: 'b-user', text: title }, cart, compare],
        snapshot: null,
        cart: cart.cart,
        handoffUrl: handoff,
        dualCheckout: true,
        receipt: null,
      };
      localStorage.setItem('changuito:onboarding:v1', '1');
      localStorage.setItem('changuito:chats', JSON.stringify(index));
      localStorage.setItem(`changuito:chat:${chatId}`, JSON.stringify(chat));
    },
    { chatId: CHAT_ID, title: TITLE, handoff: HANDOFF, cart: CART_BLOCK, compare: COMPARE_BLOCK },
  );
}

async function openChat(page: Page): Promise<void> {
  await page.route(/\/api\/human(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, mode: 'open', siteKey: '' }),
    });
  });
  await seed(page);
  await page.goto('/');
  await page.getByTestId('chat-row').click();
  await expect(page.getByTestId('pay-card-dia')).toBeVisible();
  await expect(page.getByTestId('pay-card-coto')).toBeVisible();
}

test.describe('dual mock pay cards', () => {
  test('shows both pays, quotes Coto without an amount, and disables the other', async ({ page }) => {
    test.skip(!process.env.DUAL_CHECKOUT_E2E?.trim(), 'DUAL_CHECKOUT_E2E is not set');
    const errors = collectPageErrors(page);

    let quoted: Record<string, unknown> | null = null;
    await page.route('**/api/checkout/quote', async (route) => {
      if (route.request().method() === 'POST') {
        quoted = route.request().postDataJSON() as Record<string, unknown>;
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Iniciá sesión para pagar.' }),
      });
    });

    await openChat(page);
    const thread = page.getByTestId('chat-thread');
    await expect(thread).not.toContainText('20%');
    await expect(page.getByTestId('checkout-compare')).toHaveCount(0);
    await expect(page.getByTestId('rail-pay')).toHaveCount(0);

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [testId, label] of [
        ['pay-card-dia', DIA_LABEL],
        ['pay-card-coto', COTO_LABEL],
      ] as const) {
        const card = page.getByTestId(testId);
        await expect(card.getByRole('heading', { level: 3 })).toBeVisible();
        const button = card.getByRole('button', { name: label });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box, `${label} at ${width}px`).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }

    await page.getByRole('button', { name: COTO_LABEL }).click();
    await expect.poll(() => quoted).not.toBeNull();
    expect(quoted!.payRetailer).toBe('coto');
    expect(quoted).not.toHaveProperty('amount');
    expect(quoted).not.toHaveProperty('compare');
    await expect(page.getByRole('button', { name: DIA_LABEL })).toBeDisabled();

    expectNoPageErrors(errors);
  });
});
