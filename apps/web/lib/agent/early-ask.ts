/**
 * The one reply that does not need a model.
 *
 * Every basket starts with the same question. The prompt tells the model that
 * without a supermarket and a postal code it must ask for them before
 * anything else, and it does — but on the local model that single sentence
 * took 41.7s on production, most of it prompt evaluation over twelve tool
 * schemas, with nothing on screen. A guest tapping a starter chip is the
 * common first turn, so the common first impression was a stalled spinner.
 *
 * So the first message of a conversation that names no postal code is
 * answered here, instantly, with the question the model would have asked.
 * It is written into history like any other reply, so the next turn's model
 * sees the user's original request, then this question, then their answer.
 *
 * Deliberately narrow: only the first message, only with no location set,
 * and only when nothing in it looks like a postal code. Anything else — a
 * follow-up, "no sé", a CPA, a number that might be one — goes to the model,
 * which is what happened before for every message.
 *
 * Only a type import, which `--experimental-strip-types` erases outright, so
 * this still loads with nothing to resolve at runtime.
 */

import type { Lang } from '../lang.ts';

/** Four digits on their own (1414, CP1414, "1414 Día"), or a CPA (C1414ABC). */
const POSTAL_CODE = /(^|\D)\d{4}(?!\d)|(^|[^A-Za-z])[A-Za-z]\d{4}[A-Za-z]{3}(?![A-Za-z])/;

export function mentionsPostalCode(text: string): boolean {
  return POSTAL_CODE.test(text);
}

export const EARLY_LOCATION_ASK =
  'Para buscar precios reales en Día necesito tu **código postal**. ¿Cuál es?';

/**
 * The same question for a reader who set the footer to English.
 *
 * The store name stays Día — it is the sign above a real shop. "Código postal"
 * becomes "postcode" because that is the thing being asked for.
 */
export const EARLY_LOCATION_ASK_EN =
  'To look up real prices at Día I need your **postcode**. What is it?';

export function earlyLocationAsk(args: {
  hasLocation: boolean;
  /** No message has been exchanged in this conversation yet. */
  firstMessage: boolean;
  text: string;
  lang?: Lang;
}): string | null {
  if (args.hasLocation || !args.firstMessage) return null;
  if (mentionsPostalCode(args.text)) return null;
  return args.lang === 'en' ? EARLY_LOCATION_ASK_EN : EARLY_LOCATION_ASK;
}

export const CITY_ASK = '¿En qué ciudad o localidad está ese código postal?';

export const CITY_ASK_EN = 'Which city or locality is that postcode in?';

export function isCityQuestion(text: string | null | undefined): boolean {
  const trimmed = text?.trim();
  return trimmed === CITY_ASK || trimmed === CITY_ASK_EN;
}

const LIST_WORD = /\b(leche|pan|yerba|arroz|fideos|carne|queso|huevos|aceite|azúcar|azucar)\b/i;

/**
 * The name stored for the city.
 * Lowercase, strip accents, drop dots, collapse spaces. `caba`, `c.a.b.a.`
 * and `ciudad de buenos aires` become `Ciudad de Buenos Aires`. Anything else
 * comes back trimmed, with its original casing.
 */
export function canonicalCity(text: string): string {
  const folded = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (folded === 'caba' || folded === 'ciudad de buenos aires') return 'Ciudad de Buenos Aires';
  return text.trim().replace(/\s+/g, ' ');
}

/** The whole trimmed reply, or null when it reads as a shopping list. */
export function cityFromAnswer(text: string): string | null {
  const city = text.trim().replace(/\s+/g, ' ');
  if (!city || city.length > 80) return null;
  if (/[,;\n]/.test(city)) return null;
  if (city.split(' ').length > 6) return null;
  if (LIST_WORD.test(city)) return null;
  if (/https?:/i.test(city)) return null;
  return canonicalCity(city);
}

export function earlyCityAsk(args: {
  hasLocation: boolean;
  hasCity: boolean;
  knownPostal: boolean;
}): string | null {
  if (args.hasLocation || args.hasCity || !args.knownPostal) return null;
  return CITY_ASK;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text ?? '') : ''))
    .join('\n');
}

export function lastAssistantText(messages: readonly { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant') return messageText(message.content);
  }
  return '';
}

export function transcriptHasPostal(messages: readonly { role?: string; content?: unknown }[], text: string): boolean {
  if (mentionsPostalCode(text)) return true;
  return messages.some((message) => message.role === 'user' && mentionsPostalCode(messageText(message.content)));
}

const CITY_WORD = /ciudad|localidad|city|locality/i;

/** The last assistant text asked for a city, in the fixed question or in its own words. */
export function assistantAskedCity(text: string | null | undefined): boolean {
  if (isCityQuestion(text)) return true;
  return CITY_WORD.test(text ?? '');
}

/**
 * Stores the city when the previous message was the fixed question, or when
 * the snapshot says `CITY_ASK` already went out, or when the whole reply is
 * the CABA alias, or when a postal code is already known and the reply
 * answers a city question the model worded itself.
 * `getCityAsked` is the snapshot's record that `CITY_ASK` went out. It
 * survives an empty turn store, which is what dropped the first locality
 * and made the chat ask again. The alias needs nothing else: `pendingPostal`
 * is not in the snapshot either. `prior` is the browser's earlier lines,
 * which still hold the postal code. `cityFromAnswer` still rejects a
 * shopping list. No flag means the same behavior as before the flag existed.
 */
export function rememberCity(
  state: {
    getCity?: () => string | undefined;
    setCity?: (city: string) => void;
    getPendingPostal?: () => string | undefined;
    getCityAsked?: () => boolean;
  },
  messages: readonly { role?: string; content?: unknown }[],
  text: string,
  prior: readonly string[] = [],
): void {
  if (state.getCity?.()) return;
  const city = cityFromAnswer(text);
  if (!city) return;
  if (
    city === 'Ciudad de Buenos Aires' ||
    state.getCityAsked?.() ||
    isCityQuestion(lastAssistantText(messages))
  ) {
    state.setCity?.(city);
    return;
  }
  const postalKnown =
    Boolean(state.getPendingPostal?.()) ||
    transcriptHasPostal(messages, text) ||
    prior.some((line) => mentionsPostalCode(line));
  if (postalKnown && assistantAskedCity(lastAssistantText(messages))) state.setCity?.(city);
}
