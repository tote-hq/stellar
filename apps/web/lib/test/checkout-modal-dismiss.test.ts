import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('CheckoutModal dismiss rules', () => {
  it('does not close on backdrop click or Escape; traps focus', () => {
    const comp = readFileSync(new URL('../../components/CheckoutModal.tsx', import.meta.url), 'utf8');
    assert.match(comp, /role="dialog"/);
    assert.match(comp, /aria-modal="true"/);
    assert.match(comp, /data-testid="checkout-modal-backdrop"/);
    const backdrop = comp.slice(
      comp.indexOf('data-testid="checkout-modal-backdrop"'),
      comp.indexOf('data-testid="checkout-modal"'),
    );
    assert.doesNotMatch(backdrop, /onClick=\{close\}/);
    assert.match(comp, /event\.key === 'Escape'/);
    const escape = comp.slice(comp.indexOf("event.key === 'Escape'"), comp.indexOf("event.key !== 'Tab'"));
    assert.doesNotMatch(escape, /\bclose\b|onClose\(/);
    assert.match(comp, /FOCUSABLE/);
    assert.match(comp, /ck-close/);
  });
});
