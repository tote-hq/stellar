/**
 * Whether a catalog hit is the food the shopper asked for.
 *
 * A type is one search query. The head is its first content word, and a hit
 * counts when that word, a listed synonym, or another content word of the
 * same query appears in the name. Pet food never counts. Prices are not read.
 */
import { normalizeBrand } from './normalize.js';

const PET_PHRASES = [
  'pedigree',
  'dog chow',
  'cat chow',
  'whiskas',
  'purina',
  'pro plan',
  'excellent',
  'eukanuba',
  'royal canin',
  'vital can',
  'dogui',
  'gati',
  'sabrositos',
  'perro',
  'perros',
  'gato',
  'gatos',
  'mascota',
  'mascotas',
  'cachorro',
  'cachorros',
];

const STOP = new Set(['de', 'con', 'sin', 'y', 'la', 'el', 'los', 'las', 'x', 'para']);

/**
 * Shelf words that do not contain the head. Only `carne` needs this.
 * A wider taxonomy is out of scope.
 */
const HEAD_SYNONYMS: Record<string, readonly string[]> = {
  carne: [
    'picada',
    'bife',
    'asado',
    'vacio',
    'nalga',
    'cuadril',
    'peceto',
    'osobuco',
    'matambre',
    'roast beef',
    'carnaza',
    'paleta',
    'tapa de asado',
  ],
};

export interface FoodName {
  name: string;
  brand?: string;
}

function plain(value: string): string {
  return normalizeBrand(value).toLowerCase();
}

function tokens(value: string): string[] {
  const text = plain(value);
  return text ? text.split(' ') : [];
}

/**
 * Drop one trailing plural `s`. `nuggets` becomes `nugget` and `proteinas`
 * becomes `proteina`. A word that does not end in `s` stays as it is.
 */
function stem(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function contentTokens(query: string): string[] {
  const out: string[] = [];
  for (const token of tokens(query)) {
    if (STOP.has(token)) continue;
    out.push(stem(token));
  }
  return out;
}

/** The first content word of the query, plural stripped. Empty when there is none. */
export function queryHead(query: string): string {
  return contentTokens(query)[0] ?? '';
}

function padded(words: readonly string[]): string {
  return ` ${words.join(' ')} `;
}

/**
 * A name word meets a query word when they are the same stem, or when one
 * is a prefix of the other and the shorter has at least six letters.
 * That second case is how `protein` meets `proteinas` on «leche con proteinas».
 */
function wordMeets(nameWords: readonly string[], needle: string): boolean {
  if (!needle) return false;
  if (needle.includes(' ')) return padded(nameWords).includes(` ${needle} `);
  for (const word of nameWords) {
    const stemmed = stem(word);
    if (word === needle || stemmed === needle) return true;
    const shorter = word.length < needle.length ? word : needle;
    const longer = word.length < needle.length ? needle : word;
    if (shorter.length >= 6 && longer.startsWith(shorter)) return true;
    const shortStem = stemmed.length < needle.length ? stemmed : needle;
    const longStem = stemmed.length < needle.length ? needle : stemmed;
    if (shortStem.length >= 6 && longStem.startsWith(shortStem)) return true;
  }
  return false;
}

/** Whole-word pet brands and pet words, on the name and the brand together. */
export function isPetFood(name: string, brand?: string): boolean {
  const words = tokens(`${brand ?? ''} ${name}`);
  const text = padded(words);
  for (const phrase of PET_PHRASES) {
    if (phrase.includes(' ')) {
      if (text.includes(` ${phrase} `)) return true;
    } else if (words.includes(phrase)) return true;
  }
  return false;
}

/**
 * True when the hit is not pet food and its name carries the query.
 * The head and its synonyms count, and so does any later content word,
 * so «La Serenísima Protein» is «leche con proteinas» through `protein`
 * while «Leche Las Tres Niñas» is the same query through `leche`.
 * An empty query matches nothing.
 */
export function ofQueryType(query: string, item: FoodName): boolean {
  if (isPetFood(item.name, item.brand)) return false;
  const parts = contentTokens(query);
  const head = parts[0];
  if (!head) return false;
  const nameWords = tokens(item.name);
  if (wordMeets(nameWords, head)) return true;
  for (const synonym of HEAD_SYNONYMS[head] ?? []) {
    if (wordMeets(nameWords, synonym)) return true;
  }
  for (const part of parts.slice(1)) {
    if (wordMeets(nameWords, part)) return true;
  }
  return false;
}
