'use client';

import { useRouter } from 'next/navigation';

import { LANG_SWITCH } from '../lib/lang.ts';
import { GlobeIcon } from './icons';
import { useLang, useSetLang } from './LangProvider';

/**
 * The way out of a language you do not read.
 *
 * It is in the footer with the social icons rather than the masthead on
 * purpose: the masthead is already two controls wide at 360px next to a
 * wordmark that shrinks, and a language switch is a thing you look for once
 * and then never again. The footer is where the "about this site" furniture
 * lives, which is what this is.
 *
 * ## The visible label is the destination's short code
 *
 * The footer row is one line, so the control shows **EN** when the page is
 * Spanish and **ES** when it is English — the language you would get, not the
 * one you are in. The accessible name starts with those same letters (so the
 * visible label is in the name) and then says the destination in full, in
 * that destination's language: "EN, Switch to English".
 *
 * `lang` on the element tells a screen reader to switch voice for that name.
 *
 * ## Two things have to move, and only one of them is React state
 *
 * Almost every word on screen comes from a client component reading the copy
 * modules off this context, so setting the state re-renders the page in the
 * other language in one commit, with no round trip. The cookie write is for the
 * *next* request, so a reload or a second tab agrees with the toggle rather
 * than snapping back.
 *
 * But the tagline and the document metadata are rendered on the *server*, from
 * the cookie, and client state cannot reach them. `router.refresh()` re-runs
 * the server render against the cookie just written and merges the payload
 * without losing client state, which is why the order here is cookie first,
 * then refresh. It is a round trip the visible copy does not wait for.
 */
export function LangToggle() {
  const lang = useLang();
  const setLang = useSetLang();
  const router = useRouter();
  const next = LANG_SWITCH[lang];
  const short = next.to === 'en' ? 'EN' : 'ES';

  const flip = () => {
    setLang(next.to);
    router.refresh();
  };

  return (
    <button
      type="button"
      className="app-lang"
      lang={next.to}
      aria-label={`${short}, ${next.aria}`}
      data-testid="app-lang"
      onClick={flip}
    >
      <GlobeIcon />
      <span className="app-lang-label">{short}</span>
    </button>
  );
}
