import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { archiveChat, type ArchiveDeps } from '../chat-archive.ts';

import type { Turn } from '../agent/loop.ts';

const WALLET = `G${'A'.repeat(55)}`;

/**
 * A turn built by hand rather than with `newTurnState()`: importing loop.ts
 * would drag the MCP bridge in behind it, and this file has to load under
 * `--experimental-strip-types` with nothing reachable.
 */
function turnWith(text: string): Turn {
  return {
    messages: [{ role: 'user', content: text }],
    cache: { products: new Map([['sku-1', { sku: 'sku-1' } as never]]) },
  } as Turn;
}

function spy(): ArchiveDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    hasDatabase: () => true,
    saveChat: async (c) => {
      calls.push(c);
    },
  };
}

describe('archiving a conversation', () => {
  it('RULE: a guest is never written down', async () => {
    const deps = spy();
    const outcome = await archiveChat(
      { id: 'c1', network: 'testnet', address: null, turn: turnWith('hola'), title: 'hola' },
      deps,
    );
    assert.equal(outcome, 'guest');
    assert.deepEqual(deps.calls, [], 'a guest transcript reached the database');
  });

  it('RULE: a signed-in session on testnet is archived', async () => {
    // `address` comes from the `chg_user` cookie — a signed-in session.
    // Production keeps records; the DB is keyed `(network, address)`, so a
    // testnet transcript cannot collide with a mainnet one.
    const deps = spy();
    const outcome = await archiveChat(
      { id: 'c1', network: 'testnet', address: WALLET, turn: turnWith('hola'), title: 'hola' },
      deps,
    );
    assert.equal(outcome, 'saved');
    assert.equal(deps.calls.length, 1);
    const saved = deps.calls[0] as { id: string; network: string; address: string; title: string | null };
    assert.equal(saved.id, 'c1');
    assert.equal(saved.network, 'testnet');
    assert.equal(saved.address, WALLET);
    assert.equal(saved.title, 'hola');
  });

  it('RULE: the mode is checked before the database, so preview never dials one', async () => {
    // Ordering, not pedantry: a deployment always has DATABASE_URL set, so
    // asking `hasDatabase` first would answer 'no-database' for nobody and
    // hide the reason preview writes nothing. Mode is passed explicitly —
    // an address alone is now a signed-in session and would keep records.
    const deps = { ...spy(), hasDatabase: () => false };
    assert.equal(
      await archiveChat(
        {
          id: 'c1',
          network: 'testnet',
          address: WALLET,
          mode: 'preview',
          turn: turnWith('hola'),
          title: 'hola',
        },
        deps,
      ),
      'preview',
    );
  });

  it('writes nothing with no database configured', async () => {
    const deps = { ...spy(), hasDatabase: () => false };
    assert.equal(
      await archiveChat(
        { id: 'c1', network: 'mainnet', address: WALLET, turn: turnWith('hola'), title: 'hola' },
        deps,
      ),
      'no-database',
    );
  });

  it('RULE: the render cache survives the trip, because a Map does not stringify', async () => {
    const deps = spy();
    await archiveChat(
      { id: 'c1', network: 'mainnet', address: WALLET, turn: turnWith('hola'), title: null },
      deps,
    );
    const saved = deps.calls[0] as { transcript: { v: number; products: [string, unknown][] } };
    // The whole reason encodeTurn exists: JSON.stringify renders a Map as `{}`
    // with no error, so a spread here would store an empty cache silently.
    assert.equal(saved.transcript.v, 1);
    assert.deepEqual(
      saved.transcript.products.map(([sku]) => sku),
      ['sku-1'],
    );
    assert.ok(JSON.stringify(saved.transcript).includes('sku-1'));
  });

  it('RULE: a database that is down costs the archive, never the turn', async () => {
    const deps: ArchiveDeps = {
      hasDatabase: () => true,
      saveChat: async () => {
        throw new Error('connection refused');
      },
    };
    assert.equal(
      await archiveChat(
        { id: 'c1', network: 'mainnet', address: WALLET, turn: turnWith('hola'), title: null },
        deps,
      ),
      'failed',
    );
  });
});

describe('RULE: a chat never changes hands', () => {
  it('the save upsert only updates a row the same wallet owns', () => {
    // No database in unit tests, so this pins the SQL itself: a chat id is a
    // UUID, not a capability, and must not let one wallet overwrite another's.
    const db = readFileSync(new URL('../db.ts', import.meta.url), 'utf8');
    assert.match(db, /on conflict \(id\) do update[\s\S]*?where chat\.address = excluded\.address/);
  });
});
