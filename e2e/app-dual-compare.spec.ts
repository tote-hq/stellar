import { expect, test, type Locator, type Page } from '@playwright/test';

import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

/**
 * Opt-in proof of the in-chat Día vs Coto card.
 *
 * The card is a record the browser already stores. This spec writes one
 * guest chat into localStorage and opens it from the history column. It
 * does not shop, does not call the model, and does not change
 * `chat_dual_compare` or the sandbox flags. Those modes only differ inside
 * `startJob`; these controls are plain anchors, so one guest click covers
 * them. `npm run test:e2e` leaves `COMPARE_E2E` unset and this test skips.
 */

const CHAT_ID = 'e2e-compare-104';
const TITLE = 'Leche y yerba';
const CREATED_AT = 1_700_000_000_000;
const HANDOFF =
  'https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=e2e-cart-104#/cart';
const COTO_URL = 'https://www.coto.com.ar/product/leche';

const CHECKOUT_PATHS = [
  '/api/checkout/quote',
  '/api/checkout/start',
  '/api/checkout/open',
  '/api/checkout/channels',
] as const;

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

function checkoutPath(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    return CHECKOUT_PATHS.find((item) => path === item || path.startsWith(`${item}/`)) ?? null;
  } catch {
    return null;
  }
}

/** The link is `target=_blank`. Close the popup without waiting for the store. */
async function clickAndClose(page: Page, link: Locator): Promise<void> {
  const popup = page.waitForEvent('popup', { timeout: 8_000 }).catch(() => null);
  await link.click({ noWaitAfter: true });
  const opened = await popup;
  if (!opened) return;
  await opened.route('**/*', (route) => route.abort()).catch(() => {});
  await opened.close().catch(() => {});
}

/**
 * Armed before the click so a synchronous checkout call cannot land between
 * the click and the assertion. The timeout is the window in which that call
 * would have been seen.
 */
async function expectNoCheckout(page: Page, link: Locator, which: string): Promise<void> {
  const hit = page
    .waitForRequest((req) => checkoutPath(req.url()) !== null, { timeout: 1_500 })
    .then((req) => checkoutPath(req.url()))
    .catch(() => null);
  await clickAndClose(page, link);
  expect(await hit, `${which} opened a checkout route`).toBeNull();
}

test.describe('día vs coto card', () => {
  test('restores a stored card and its links do not call checkout', async ({ page }) => {
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

    const card = page.getByTestId('compare-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('2 de 3 productos coinciden');
    for (const banned of ['20%', 'Comisión', 'Savings', 'Ahorro', 'Fee']) {
      await expect(card).not.toContainText(banned);
    }

    const dia = card.getByRole('link', { name: 'Abrir el carrito en Día' });
    await expect(dia).toHaveCount(1);
    await expect(dia).toHaveAttribute('href', HANDOFF);

    const coto = card.getByRole('link', { name: /Ver en Coto/ });
    await expect(coto).toHaveCount(1);
    await expect(coto).toHaveAttribute('href', /^https:\/\/www\.coto\.com\.ar\//);
    await expect(coto).toHaveAttribute('target', '_blank');

    await expectNoCheckout(page, coto, 'Coto');
    await expectNoCheckout(page, dia, 'Día');

    expectNoPageErrors(errors);
  });
});
