import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { NEW_TAB_HINT } from '../../../../packages/trust/src/copy.ts';
import { PARTNERS } from '../partners.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function contrast(foreground: string, background: string): number {
  const channel = (hex: string, index: number) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const raw = hex.replace('#', '');
    return 0.2126 * channel(raw, 0) + 0.7152 * channel(raw, 2) + 0.0722 * channel(raw, 4);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('the landing footer carries the partner lockup, the icons and the founder line', () => {
  assert.deepEqual(
    PARTNERS.map((partner) => ({ id: partner.id, href: partner.href, label: partner.label, mono: partner.mono })),
    [
      { id: 'academiaqa', href: 'https://academiaqa.com', label: 'AcademiaQA', mono: true },
      {
        id: 'superteam',
        href: 'https://superteam.fun/earn/regions/argentina/',
        label: 'Superteam Argentina',
        mono: false,
      },
      { id: 'baf', href: 'https://blockchainacceleration.org', label: 'BAF Network', mono: true },
    ],
  );
  assert.equal(NEW_TAB_HINT, 'se abre en una pestaña nueva');

  const footer = readFileSync(join(root, 'components/landing/site-footer.tsx'), 'utf8');
  assert.equal(footer.includes('Powered by'), true);
  assert.equal(footer.includes('PARTNERS.map'), true);
  assert.equal(footer.includes('target="_blank"'), true);
  assert.equal(footer.includes('noopener noreferrer'), true);
  assert.equal(footer.includes('aria-label={`${partner.label} (${NEW_TAB_HINT})`}'), true);
  assert.equal(footer.includes('alt=""'), true);
  assert.equal(footer.includes('InstagramIcon'), true);
  assert.equal(footer.includes('XIcon'), true);
  assert.equal(footer.includes('LinkedInIcon'), true);
  assert.equal(footer.includes('href="/reportarbug"'), true);
  assert.equal(footer.includes('Reportar un bug'), true);
  assert.match(footer, /trust \? <FounderTrust/);
  assert.equal(footer.includes('Hecho en'), false);
  assert.equal(footer.includes('©'), false);

  for (const partner of PARTNERS) {
    assert.equal(existsSync(join(root, 'public', partner.src)), true);
  }

  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  const powered = css.slice(css.indexOf('.poweredLink {'));
  const poweredBody = powered.slice(0, powered.indexOf('}'));
  assert.match(poweredBody, /min-width:\s*44px/);
  assert.match(poweredBody, /min-height:\s*44px/);
  assert.match(css, /\.mono img\s*\{[^}]*opacity:\s*0\.75/s);
  assert.match(css, /\.color img\s*\{[^}]*border-radius:\s*6px/s);

  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  assert.match(dark, /background:\s*#241812/);
  assert.match(dark, /color:\s*#fafaf7/);
  assert.match(dark, /color:\s*#efe6df/);
  assert.match(dark, /outline:\s*3px solid #f4b942/);
  assert.match(dark, /\.mono img\s*\{[^}]*invert\(1\)/s);
  assert.ok(contrast('#fafaf7', '#241812') >= 4.5);
  assert.ok(contrast('#efe6df', '#241812') >= 4.5);
  assert.ok(contrast('#e7ddd6', '#241812') >= 4.5);
  assert.ok(contrast('#f4b942', '#241812') >= 3);
  assert.ok(contrast('#2a1a14', '#fafaf7') >= 4.5);
  assert.ok(contrast('#5c534c', '#fafaf7') >= 4.5);
});
