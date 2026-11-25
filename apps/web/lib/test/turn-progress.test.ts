import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { applyEvent, initialState, resetIds, sendUser, type ChatState } from '../chat-state.ts';
import type { UiEvent } from '../protocol.ts';
import { pendingTool, progressCopy } from '../turn-progress.ts';

const run = (events: UiEvent[], from: ChatState = sendUser(initialState, 'leche 1414 día')) =>
  events.reduce(applyEvent, from);

beforeEach(resetIds);

describe('progressCopy stage', () => {
  it('follows the stage order from send through the reply', () => {
    assert.equal(progressCopy(run([]), 0).stage, 'Enviando tu mensaje…');
    assert.equal(progressCopy(run([{ t: 'status', stage: 'received' }]), 0).stage, 'Recibido. Preparando la búsqueda…');
    assert.equal(progressCopy(run([{ t: 'status', stage: 'thinking', hop: 0 }]), 0).stage, 'Pensando qué buscar…');
    assert.equal(progressCopy(run([{ t: 'status', stage: 'thinking', hop: 3 }]), 0).stage, 'Revisando lo que encontré…');
    const writing = run([{ t: 'status', stage: 'thinking', hop: 0 }, { t: 'text', delta: 'Te' }]);
    assert.equal(progressCopy(writing, 0).stage, 'Escribiendo la respuesta…');
  });

  it('names the tool that is still running, then stops once it reported back', () => {
    const running = run([
      { t: 'status', stage: 'thinking', hop: 0 },
      { t: 'tool_start', id: 't1', name: 'search_products' },
    ]);
    assert.equal(pendingTool(running), 'search_products');
    assert.equal(progressCopy(running, 0).stage, 'Buscando productos…');

    const done = run([
      { t: 'tool_start', id: 't1', name: 'search_products' },
      { t: 'tool_end', id: 't1', ok: true, ms: 900 },
      { t: 'status', stage: 'thinking', hop: 1 },
    ]);
    assert.equal(pendingTool(done), undefined);
    assert.equal(progressCopy(done, 0).stage, 'Revisando lo que encontré…');
  });

  it('never reports a tool from an earlier turn', () => {
    // A tool that never got its tool_end, left in the transcript by a turn
    // that was stopped. It is history, not something running now.
    const old = run([{ t: 'tool_start', id: 't1', name: 'search_products' }]);
    const next = sendUser({ ...old, streaming: false }, 'otra cosa');
    assert.equal(pendingTool(next), undefined);
  });
});

describe('progressCopy hint and clock', () => {
  const s = run([{ t: 'status', stage: 'thinking', hop: 0 }]);

  it('counts whole seconds and never goes negative', () => {
    assert.equal(progressCopy(s, 12_999).seconds, 12);
    assert.equal(progressCopy(s, -50).seconds, 0);
  });
});
