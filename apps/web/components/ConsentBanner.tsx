'use client';

import { useEffect, useState } from 'react';

import { CONSENT_COPY, readConsent, subscribeConsent, writeConsent } from '../lib/consent.ts';
import type { Lang } from '../lib/lang.ts';

/**
 * Thin bar at the bottom of the first visit. Hidden once `chg_consent` is set.
 *
 * The server already knows the language (`initialLang`). Analytics sits above
 * `LangProvider`, so a later toggle is read from `documentElement.lang`, which
 * is the attribute that provider writes. The first client render matches the
 * server (the bar stays unmounted until the cookie is read) so a shopper who
 * already chose does not see it flash.
 */
export function ConsentBanner({ initialLang }: { initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setOpen(readConsent(document.cookie) === null);
    sync();
    const stop = subscribeConsent(sync);
    const root = document.documentElement;
    const watch = new MutationObserver(() => {
      setLang(root.lang.toLowerCase().startsWith('en') ? 'en' : 'es');
    });
    watch.observe(root, { attributes: true, attributeFilter: ['lang'] });
    return () => {
      stop();
      watch.disconnect();
    };
  }, []);

  if (!open) return null;
  const copy = CONSENT_COPY[lang];

  return (
    <div className="consent-banner" role="region" aria-label={copy.region} data-testid="consent-banner">
      <p>{copy.message}</p>
      <div className="consent-banner-actions">
        <button type="button" className="btn" data-testid="consent-accept" onClick={() => writeConsent('granted')}>
          {copy.accept}
        </button>
        <button type="button" className="consent-decline" data-testid="consent-decline" onClick={() => writeConsent('denied')}>
          {copy.decline}
        </button>
        <a className="consent-more" href="/privacidad" data-testid="consent-more">
          {copy.more}
        </a>
      </div>
    </div>
  );
}
