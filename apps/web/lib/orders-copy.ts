import type { OrderStatus } from './db.ts';
import { DEFAULT_LANG, INTL_LOCALE, type Lang } from './lang.ts';
import { PREVIEW_MASTHEAD, PREVIEW_MASTHEAD_EN } from './mode-copy.ts';

/**
 * The words on the Mis compras tab of the profile, and the two numbers on
 * every line.
 *
 * A module rather than strings in the JSX for the reason mode-copy.ts gives:
 * the chrome obeys the same rule as the agent, so none of these may name a
 * network, a chain or a wallet, and a test iterates the lot to check. The
 * shopper reads "compras", "código" and "pesos" here and nothing else.
 *
 * `pesos` and `dollars` live here too because they are the same decision as
 * the wording. An order carries both figures deliberately — `arsQuoted` is
 * what the shopper actually read on screen, `amountCents` is what was sent —
 * and the rate moves between the two, so the page shows the one they saw and
 * falls back only when there is no such figure.
 */

export interface PurchasesCopy {
  title: string;
  lead: string;
  /** Signed out, which is to say preview: nothing is kept, and that is fine. */
  guestTitle: string;
  guestBody: string;
  /** The same words the masthead uses, so the crossing reads the same twice. */
  guestAction: string;
  /**
   * Above the button. It says "puede que" because usually it will not: the
   * session answers this read, and a signature is the fallback for a cookie
   * that is missing or thirty days old. It still warns, because the one time
   * it does happen is the time somebody should not be surprised by their
   * wallet opening.
   */
  signLead: string;
  loadCta: string;
  loading: string;
  signRefused: string;
  error: string;
  empty: string;
  codeLabel: string;
}

export const PURCHASES: PurchasesCopy = {
  title: 'Mis compras',
  lead: 'Lo que compraste con Changuito, desde cualquier dispositivo.',
  guestTitle: 'Acá no hay nada guardado',
  guestBody:
    'En modo prueba no guardamos nada: probás el pago entero y no queda registro. Entrá con tu cuenta y tus compras quedan acá.',
  guestAction: PREVIEW_MASTHEAD.action,
  signLead: 'Si hace mucho que no entrás puede que te pidamos una firma para confirmar que sos vos. Es gratis y no mueve plata.',
  loadCta: 'Ver mis compras',
  loading: 'Buscando tus compras…',
  signRefused: 'No pudimos confirmar que sos vos. Probá de nuevo.',
  error: 'No pudimos traer tus compras ahora. Probá de nuevo en un rato.',
  empty: 'Todavía no compraste nada con esta cuenta.',
  codeLabel: 'Código',
};

/**
 * What each status is called in front of the person who owns the order.
 *
 * `paid` and `carded` read the same on purpose. `carded` is a status the
 * table still has; it is not a step the shopper took.
 *
 * `quoted` says "sin pagar" rather than "esperando", because an order can sit
 * there for ever: the shopper was given a código and never sent anything, and
 * a word that implies we are still waiting would be a promise to keep looking.
 */
export const ORDER_STATUS: Record<OrderStatus, string> = {
  quoted: 'Sin pagar',
  paid: 'Pagada',
  carded: 'Pagada',
  done: 'Terminada',
  failed: 'No se completó',
};

/** Everything the copy test iterates. One place to add to. */
export const PURCHASES_COPY: readonly string[] = [
  ...Object.values(PURCHASES),
  ...Object.values(ORDER_STATUS),
];

/**
 * Pesos, grouped the way the reader groups numbers.
 *
 * The currency never changes — the shopper is buying in Argentina in either
 * language — but the separators do, because "$12.345,67" read as English is off
 * by a factor of a hundred thousand. Both formatters are built once, at module
 * load, the way the single one always was.
 */
const ARS: Record<Lang, Intl.NumberFormat> = {
  es: new Intl.NumberFormat(INTL_LOCALE.es, {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }),
  en: new Intl.NumberFormat(INTL_LOCALE.en, {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }),
};

/** Centavos as the shopper read them. */
export function pesos(centavos: number, lang: Lang = DEFAULT_LANG): string {
  return ARS[lang].format(centavos / 100);
}

/**
 * US cents, for an order quoted before `ars_quoted` was a column — and for
 * one where the pesos figure was lost to a database that was briefly down.
 * Hand-formatted rather than `Intl`, which writes "US$ 12,34" on some
 * runtimes and "$US 12,34" on others; this is a fallback and it should not
 * be the interesting part of the line.
 */
export function dollars(cents: number, lang: Lang = DEFAULT_LANG): string {
  const figure = (cents / 100).toFixed(2);
  return `US$ ${lang === 'en' ? figure : figure.replace('.', ',')}`;
}

const DAY: Record<Lang, Intl.DateTimeFormat> = {
  es: new Intl.DateTimeFormat(INTL_LOCALE.es, { day: 'numeric', month: 'short', year: 'numeric' }),
  en: new Intl.DateTimeFormat(INTL_LOCALE.en, { day: 'numeric', month: 'short', year: 'numeric' }),
};

/** An ISO string from the API, as a date. Invalid input reads as empty. */
export function purchaseDate(iso: string, lang: Lang = DEFAULT_LANG): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : DAY[lang].format(at);
}

/* ------------------------------------------------------------------------- *
 * English
 *
 * `PURCHASES`, `ORDER_STATUS` and `PURCHASES_COPY` above are the Spanish
 * originals. `paid` and `carded` are still the same word.
 * ------------------------------------------------------------------------- */

const PURCHASES_EN: PurchasesCopy = {
  title: 'My purchases',
  lead: "What you've bought with Changuito, from any device.",
  guestTitle: 'Nothing is saved here',
  guestBody:
    "In practice mode we save nothing: you can try the whole payment and no record is kept. Sign in with your account and your purchases will be here.",
  guestAction: PREVIEW_MASTHEAD_EN.action,
  signLead:
    "If it's been a while, we may ask you for a signature to confirm it's you. It's free and it doesn't move any money.",
  loadCta: 'See my purchases',
  loading: 'Looking for your purchases…',
  signRefused: "We couldn't confirm it's you. Try again.",
  error: "We couldn't fetch your purchases just now. Try again in a bit.",
  empty: "You haven't bought anything with this account yet.",
  codeLabel: 'Code',
};

const ORDER_STATUS_EN: Record<OrderStatus, string> = {
  // "Unpaid", not "Waiting": an order can sit here for ever.
  quoted: 'Unpaid',
  // The same word for both, because the card is machinery.
  paid: 'Paid',
  carded: 'Paid',
  done: 'Complete',
  failed: "Didn't go through",
};

export function purchasesCopy(lang: Lang): PurchasesCopy {
  return lang === 'en' ? PURCHASES_EN : PURCHASES;
}

export function orderStatus(lang: Lang): Record<OrderStatus, string> {
  return lang === 'en' ? ORDER_STATUS_EN : ORDER_STATUS;
}
