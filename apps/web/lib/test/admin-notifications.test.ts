import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { withBuyers } from '../admin/notes.ts';

const SENTENCE = 'Hay que firmar el pedido.';
const ORDER_A = '3774c025db373842af59288fd34b0f042a06351993145e40e8c10aee076e4677';
const ORDER_B = 'ab'.repeat(32);

describe('admin Pedidos rows', () => {
  it('gives each order its own buyer and skips a note with no order', async () => {
    const looked: string[] = [];
    const notes = await withBuyers(
      [
        { id: '1', orderId: ORDER_A, body: SENTENCE },
        { id: '2', orderId: ORDER_B, body: SENTENCE },
        { id: '3', orderId: ORDER_A, body: SENTENCE },
        { id: '4', orderId: null, body: SENTENCE },
      ],
      async (orderId) => {
        looked.push(orderId);
        if (orderId === ORDER_A) return { buyer: 'Ana' };
        if (orderId === ORDER_B) return { buyer: 'Luis' };
        return undefined;
      },
    );
    assert.deepEqual(looked.slice().sort(), [ORDER_A, ORDER_B].sort());
    assert.equal(notes[0]?.orderId, ORDER_A);
    assert.equal(notes[0]?.buyer, 'Ana');
    assert.equal(notes[1]?.orderId, ORDER_B);
    assert.equal(notes[1]?.buyer, 'Luis');
    assert.equal(notes[2]?.buyer, 'Ana');
    assert.equal(notes[3]?.buyer, null);
    assert.equal(looked.includes(''), false);
  });

  it('leaves buyer null when the record is missing or the lookup throws', async () => {
    const missing = await withBuyers([{ id: '5', orderId: ORDER_A, body: SENTENCE }], async () => undefined);
    assert.equal(missing[0]?.buyer, null);
    const thrown = await withBuyers([{ id: '6', orderId: ORDER_A, body: SENTENCE }], async () => {
      throw new Error('db');
    });
    assert.equal(thrown[0]?.buyer, null);
    const rest = await withBuyers(
      [
        { id: '7', orderId: ORDER_A, body: SENTENCE },
        { id: '8', orderId: ORDER_B, body: SENTENCE },
      ],
      async (orderId) => {
        if (orderId === ORDER_A) throw new Error('db');
        return { buyer: 'Luis' };
      },
    );
    assert.equal(rest[0]?.buyer, null);
    assert.equal(rest[1]?.buyer, 'Luis');
  });

  it('shows the Pedidos table in a scroll region, and Listo still marks one read', () => {
    const page = readFileSync(new URL('../../app/admin-portal/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /<table/);
    assert.match(page, />Estado</);
    assert.match(page, />Pedido</);
    assert.match(page, />Cliente</);
    assert.match(page, />Hora</);
    assert.match(page, />Listo</);
    assert.match(page, /data-testid="admin-notifications-scroll"/);
    assert.match(page, /overflowY: 'auto'/);
    assert.match(page, /maxHeight: 'calc\(100dvh - 8rem\)'/);
    assert.match(page, /2px solid var\(--chg-sunflower\)/);
    assert.match(page, /2px solid var\(--ok\)/);
    assert.doesNotMatch(page, /note\.readAt \? null/);
    assert.match(page, /data-testid="admin-notification"/);
    assert.match(page, /data-testid="admin-notification-order"/);
    assert.match(page, /data-testid="admin-notification-client"/);
    assert.match(page, /data-testid="admin-notification-time"/);
    assert.doesNotMatch(page, /sin cliente/);
    assert.match(page, /overflowWrap: 'anywhere'/);
    assert.match(page, /timeZone: 'America\/Argentina\/Buenos_Aires'/);
    assert.match(page, /'es-AR'/);
    assert.match(page, /dateTime=\{note\.createdAt\}/);
    assert.match(page, /data-testid="admin-notification-read"/);
    assert.match(page, /Listo/);
    assert.match(page, /\/api\/admin\/notifications\/\$\{note\.id\}\/read/);
    const readRoute = readFileSync(
      new URL('../../app/api/admin/notifications/[id]/read/route.ts', import.meta.url),
      'utf8',
    );
    assert.match(readRoute, /markRead/);
  });
});
