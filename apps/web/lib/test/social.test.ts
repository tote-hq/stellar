import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SOCIAL } from '../social.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('shopper footer social profiles match the landing accounts', () => {
  assert.deepEqual(
    SOCIAL.map((link) => ({ id: link.id, href: link.href, ariaLabel: link.ariaLabel })),
    [
      {
        id: 'instagram',
        href: 'https://instagram.com/appchanguito',
        ariaLabel: 'Changuito en Instagram',
      },
      {
        id: 'x',
        href: 'https://x.com/appchanguito',
        ariaLabel: 'Changuito en X',
      },
    ],
  );
  assert.equal(SOCIAL.filter((link) => link.href.includes('twitter.com')).length, 0);
  for (const link of SOCIAL) {
    assert.equal(link.ariaLabel.includes('\u2014'), false);
    assert.equal(link.ariaLabel.includes('\u2013'), false);
    assert.equal(link.href.includes('\u2014'), false);
    assert.equal(link.href.includes('\u2013'), false);
  }

  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const footerStart = page.indexOf('<footer className="app-footer">');
  const footerEnd = page.indexOf('</footer>', footerStart);
  const footer = page.slice(footerStart, footerEnd);
  assert.equal(footer.includes('FooterSocial'), false);
  assert.equal(footer.includes('FooterPoweredBy'), false);
  assert.equal(footer.includes('FounderTrust'), false);
  assert.equal(page.includes('https://x.com/appchanguito'), false);
  assert.equal(page.includes('instagram.com'), false);

  const icons = readFileSync(join(root, 'components/icons.tsx'), 'utf8');
  assert.equal(icons.includes('export function InstagramIcon'), true);
  assert.equal(icons.includes('export function XIcon'), true);
  assert.equal(icons.includes('aria-hidden'), true);

  const bug = readFileSync(join(root, 'components/ReportBug.tsx'), 'utf8');
  assert.equal(bug.includes('Reportar un bug'), true);
  assert.equal(bug.includes('https://www.changuito.me/reportarbug'), true);

  const trust = readFileSync(join(root, 'components/FounderTrust.tsx'), 'utf8');
  assert.equal(trust.includes('simoneth.href'), true);
  assert.equal(trust.includes('fabio.href'), true);
  assert.equal(trust.includes('app-social'), false);
});
