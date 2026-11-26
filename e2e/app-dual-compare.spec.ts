import { expect, test } from '@playwright/test';

import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

/**
 * Opt-in proof of the in-chat Día vs Coto card.
 *
 * The card is a record the browser already stores. This spec writes one
 * guest chat into localStorage and opens it from the history column. It
 * does not shop, does not call the model, and does not change
 * `chat_dual_compare` or the sandbox flags. Those modes only differ inside
 * `startJob`. The close table is drawn from the stored gap. `npm run test:e2e`
 * leaves `COMPARE_E2E` unset and this test skips.
 */

const CHAT_ID = 'e2e-compare-104';
const TITLE = 'Leche y yerba';
const CREATED_AT = 1_700_000_000_000;
const HANDOFF =
  'https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=e2e-cart-104#/cart';
const COTO_URL = 'https://www.coto.com.ar/product/leche';

/**
 * Fields `packCompare` writes and `asCompare` reads back. A Coto price of
 * zero is dropped on load, so the unmatched row omits `coto` instead of
 * storing one.
 */
const COMPARE_BLOCK = {
  kind: 'compare',
  id: 'b-compare',
  status: 'ok',
  cartId: 'e2e-cart-104',
  handoffUrl: HANDOFF,
  matched: 2,
  lines: 3,
  gap: { diaSubtotalCentavos: 450_000, cotoSubtotalCentavos: 310_000, gapCentavos: 140_000 },
  rows: [
    {
      skuId: 'sku-leche',
      name: 'Leche entera 1 L',
      quantity: 1,
      diaLineCentavos: 180_000,
      confidence: 'ean',
      coto: {
        id: 'coto-leche',
        name: 'Leche entera Coto',
        shelfCentavos: 155_000,
        lineCentavos: 155_000,
        available: true,
        url: COTO_URL,
      },
    },
    {
      skuId: 'sku-yerba',
      name: 'Yerba 1 kg',
      quantity: 1,
      diaLineCentavos: 270_000,
      confidence: 'none',
    },
  ],
};

test.describe('día vs coto card', () => {
  test('restores a stored compare block as the close table', async ({ page }) => {
    test.skip(!process.env.COMPARE_E2E?.trim(), 'COMPARE_E2E is not set');

    const errors = collectPageErrors(page);

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

    await page.addInitScript(
      ({ chatId, title, createdAt, compare }) => {
        const index = [
          { id: chatId, title, createdAt, updatedAt: createdAt, orderState: 'open' },
        ];
        const chat = {
          v: 1,
          id: chatId,
          title,
          createdAt,
          updatedAt: createdAt,
          orderState: 'open',
          sessionId: null,
          blocks: [{ kind: 'user', id: 'b-user', text: title }, compare],
          snapshot: null,
          cart: null,
          handoffUrl: null,
          receipt: null,
        };
        localStorage.setItem('changuito:onboarding:v1', '1');
        localStorage.setItem('changuito:chats', JSON.stringify(index));
        localStorage.setItem(`changuito:chat:${chatId}`, JSON.stringify(chat));
      },
      { chatId: CHAT_ID, title: TITLE, createdAt: CREATED_AT, compare: COMPARE_BLOCK },
    );

    await page.goto('/');

    // Desktop Chrome is 1280px wide, so the history column is already open.
    // `open-history` is the narrow-window control and stays hidden here.
    await page.getByTestId('chat-row').click();

    const card = page.getByTestId('compare-close');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Comparación');
    await expect(card).toContainText('20%');
    await expect(card).toContainText('Fee Changuito');
    await expect(card.getByRole('button', { name: 'Seguir en Día' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Seguir en Coto' })).toBeVisible();
    await expect(card.getByRole('link')).toHaveCount(0);

    expectNoPageErrors(errors);
  });
});
