import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import manifest from '../../app/manifest.ts';
import { appContentSecurityPolicy } from '../security-headers.ts';

describe('web app manifest', () => {
  it('names the app, the icons and a standalone start', () => {
    const doc = manifest();
    assert.equal(doc.name, 'Changuito');
    assert.equal(doc.short_name, 'Changuito');
    assert.equal(doc.start_url, '/');
    assert.equal(doc.display, 'standalone');
    assert.equal(doc.theme_color, '#FAFAF7');
    assert.equal(doc.background_color, '#FAFAF7');
    const icons = doc.icons ?? [];
    assert.ok(icons.some((icon) => icon.sizes === '192x192' && icon.src === '/icons/icon-192.png'));
    assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.src === '/icons/icon-512.png'));
  });

  it('refuses framing and eval, and names the wallet host', () => {
    const csp = appContentSecurityPolicy('production', { ga: '', meta: '', clarity: '', posthog: false });
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /sdk\.api\.pollar\.xyz/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.doesNotMatch(csp, /ws:\/\/localhost:\*/);
  });
});
