import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Session replay after Amendment 6: chat and catalogue text are recorded,
 * and the surfaces that must stay out of the recording still carry the block.
 * Sources are read as text so this file does not import React components.
 */

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string): string {
  return readFileSync(join(web, path), 'utf8');
}

/** The JSX opening tag that contains `marker`. */
function openingTag(text: string, marker: string): string {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `${marker} is missing`);
  const start = text.lastIndexOf('<', at);
  const end = text.indexOf('>', at);
  assert.ok(start >= 0 && end > start, `${marker} is not inside a tag`);
  return text.slice(start, end + 1);
}

function openingTags(text: string, marker: string): string[] {
  const tags: string[] = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(marker, from);
    if (at < 0) break;
    const start = text.lastIndexOf('<', at);
    const end = text.indexOf('>', at);
    assert.ok(start >= 0 && end > start, `${marker} is not inside a tag`);
    tags.push(text.slice(start, end + 1));
    from = end + 1;
  }
  return tags;
}

function section(block: string, id: string): string {
  const start = block.indexOf(`id: '${id}'`);
  assert.ok(start >= 0, id);
  const next = block.indexOf("id: '", start + 4);
  return next === -1 ? block.slice(start) : block.slice(start, next);
}

test('chat replay blocks images and the receipt, and leaves the thread readable', () => {
  const chat = source('components/Chat.tsx');
  const thread = chat.match(/className="thread[^"]*"/);
  assert.ok(thread, 'thread class is missing');
  assert.equal(thread[0].includes('ph-no-capture'), false);

  for (const marker of [
    'data-testid="user-photo"',
    'data-testid="composer-image-preview"',
    'data-testid="camera-sheet"',
    'data-testid="receipt"',
  ]) {
    assert.match(openingTag(chat, marker), /ph-no-capture/, marker);
  }

  const files = openingTags(chat, 'className="composer-file');
  assert.equal(files.length, 2);
  for (const tag of files) assert.match(tag, /ph-no-capture/);
});

test('wallet and checkout stay out of the recording', () => {
  for (const path of [
    'components/WalletWidget.tsx',
    'components/PaymentModal.tsx',
    'components/CheckoutModal.tsx',
    'components/ManualPaymentPanel.tsx',
    'components/GuidedCheckout.tsx',
  ]) {
    assert.match(source(path), /ph-no-capture/, path);
  }
});

test('privacy copy matches what the recording shows', () => {
  const privacy = source('lib/privacy-copy.ts');
  for (const gone of [
    'los campos y el texto van enmascarados',
    'la conversación',
    'inputs and text are masked',
    'the conversation',
  ]) {
    assert.equal(privacy.includes(gone), false, gone);
  }

  const es = section(privacy.slice(0, privacy.indexOf('const EN')), 'medicion');
  const en = section(privacy.slice(privacy.indexOf('const EN')), 'medicion');

  for (const claim of [
    'queda enmascarado',
    'el pago',
    'el modal de pago',
    'la billetera',
    'el iframe de la tienda',
    'Estados Unidos',
    'La cookie de sesión no se reenvía',
    'identificador al azar',
    'no tu dirección',
    'Después de Aceptar',
    'mensajes del chat',
    'texto de productos y del carrito',
    'nombres, precios y cantidades',
    'código postal',
  ]) {
    assert.ok(es.includes(claim), claim);
  }

  for (const claim of [
    'stays masked',
    'checkout',
    'the payment modal',
    'the wallet',
    'the store iframe',
    'United States',
    'The session cookie is not forwarded',
    'random identifier',
    'not your address',
    'After Accept',
    'chat messages',
    'product and cart text',
    'names, prices and quantities',
    'postal code already written in a message',
  ]) {
    assert.ok(en.includes(claim), claim);
  }
});
