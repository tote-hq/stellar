'use client';

import { newTabHint } from '../lib/founder-trust-copy';
import { useLang } from './LangProvider';

/**
 * Partner marks under the composer. Identifiers and files only: the visible
 * grey / color treatment lives in CSS, and the words of each name live on the
 * link so a price or a tagline cannot be drawn from the image.
 *
 * AcademiaQA and BAF are the mono lockups. Superteam Argentina stays in color.
 * Each link opens a new tab and says so, the same way the founder names do.
 */
const PARTNERS = [
  {
    id: 'academiaqa',
    href: 'https://academiaqa.com',
    label: 'AcademiaQA',
    src: '/brand/partners/academiaqa-mono.png',
    width: 418,
    height: 96,
    mono: true,
  },
  {
    id: 'superteam',
    href: 'https://superteam.fun/earn/regions/argentina/',
    label: 'Superteam Argentina',
    src: '/brand/partners/superteam-ar-color.png',
    width: 96,
    height: 96,
    mono: false,
  },
  {
    id: 'baf',
    href: 'https://blockchainacceleration.org',
    label: 'BAF Network',
    src: '/brand/partners/baf-mono.svg',
    width: 85,
    height: 26,
    mono: true,
  },
] as const;

export function FooterPoweredBy() {
  const lang = useLang();
  const hint = newTabHint(lang);

  return (
    <div className="app-powered" role="group" aria-labelledby="app-powered-label" data-testid="app-powered">
      <span id="app-powered-label" className="app-powered-label" lang="en">
        Powered by
      </span>
      {PARTNERS.map((partner) => (
        <a
          key={partner.id}
          className={partner.mono ? 'app-powered-link is-mono' : 'app-powered-link is-color'}
          href={partner.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${partner.label} (${hint})`}
          data-testid={`app-powered-${partner.id}`}
        >
          <img src={partner.src} alt="" width={partner.width} height={partner.height} />
        </a>
      ))}
    </div>
  );
}
