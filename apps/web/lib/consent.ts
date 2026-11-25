/**
 * The first-party choice for measurement.
 *
 * `granted` and `denied` are the only values that count. Anything else,
 * including a missing cookie, is "has not chosen": the banner stays up and
 * nothing is sent. 180 days, because a measurement choice is not a session
 * and not a language preference either.
 */

export type ConsentChoice = 'granted' | 'denied';

export const CONSENT_COOKIE = 'chg_consent';

/** 180 days, in seconds. */
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60;

export const CONSENT_COPY = {
  es: {
    region: 'Aviso de cookies',
    message: 'Usamos cookies para mejorar la app.',
    accept: 'Aceptar',
    decline: 'Rechazar',
    more: 'Más info',
  },
  en: {
    region: 'Cookie notice',
    message: 'We use cookies to improve the app.',
    accept: 'Accept',
    decline: 'Decline',
    more: 'Learn more',
  },
} as const;

type Listener = (choice: ConsentChoice) => void;

const listeners = new Set<Listener>();

export function readConsent(cookieString: string | null | undefined): ConsentChoice | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== CONSENT_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // A broken escape is not a choice.
    }
    if (value === 'granted' || value === 'denied') return value;
    return null;
  }
  return null;
}

/** `Secure` when `secure` is true. Production passes that; local http does not, or the browser drops the cookie. */
export function consentCookie(choice: ConsentChoice, secure = process.env.NODE_ENV === 'production'): string {
  const parts = [`${CONSENT_COOKIE}=${choice}`, 'Path=/', 'SameSite=Lax', `Max-Age=${CONSENT_MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writeConsent(choice: ConsentChoice): void {
  const host = globalThis as { document?: { cookie: string }; location?: { protocol: string } };
  if (host.document) {
    host.document.cookie = consentCookie(choice, host.location?.protocol === 'https:');
  }
  for (const listener of listeners) listener(choice);
}
