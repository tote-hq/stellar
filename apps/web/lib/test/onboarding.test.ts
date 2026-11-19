import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  dismissOnboarding,
  ONBOARDING_KEY,
  OPEN_FAUCET_EVENT,
  requestFaucet,
  shouldShowOnboarding,
} from '../onboarding.ts';

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('beta onboarding', () => {
  it('shows once, then stays dismissed, and does not nag when storage throws', () => {
    const s = mem();
    assert.equal(shouldShowOnboarding(s), true);
    dismissOnboarding(s);
    assert.ok(s.getItem(ONBOARDING_KEY));
    assert.equal(shouldShowOnboarding(s), false);

    assert.equal(shouldShowOnboarding(null), false);
    const broken = { getItem: () => { throw new Error('denied'); } };
    assert.equal(shouldShowOnboarding(broken), false);
    assert.doesNotThrow(() => dismissOnboarding({ setItem: () => { throw new Error('denied'); } }));
  });

  it('the link asks for the faucet with a window event, and nothing else', () => {
    const target = new EventTarget();
    const seen: Event[] = [];
    target.addEventListener(OPEN_FAUCET_EVENT, (e) => void seen.push(e));
    requestFaucet(target);
    assert.equal(seen.length, 1);
    assert.equal(OPEN_FAUCET_EVENT, 'changuito:open-faucet');
    assert.equal((seen[0] as CustomEvent).detail, null, 'carries no address or destination');
    assert.doesNotThrow(() => requestFaucet(null));
  });

  it('is a modal the backdrop and Escape cannot dismiss', () => {
    const comp = readFileSync(new URL('../../components/BetaOnboarding.tsx', import.meta.url), 'utf8');
    assert.match(comp, /role="dialog"/);
    assert.match(comp, /aria-modal="true"/);
    assert.match(comp, /className="onb-backdrop"/);
    assert.match(comp, /event\.key === 'Escape'/);
    const backdrop = comp.slice(comp.indexOf('className="onb-backdrop"'), comp.indexOf('role="dialog"'));
    assert.doesNotMatch(backdrop, /dismissOnboarding/);
    const escape = comp.slice(comp.indexOf("event.key === 'Escape'"), comp.indexOf("event.key !== 'Tab'"));
    assert.doesNotMatch(escape, /dismissOnboarding|setShow\(false\)/);
    assert.equal(comp.match(/dismissOnboarding\(window\.localStorage\)/g)?.length, 1);
  });
});
