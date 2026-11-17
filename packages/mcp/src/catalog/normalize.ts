/**
 * Brand, pack size, and unit, read the same way for every chain.
 *
 * Pack size is the net content written in the product name. Día's
 * `unitMultiplier` / `measurementUnit` and Coto's `product_format` are the
 * unit a reference price is quoted per. They are not the pack size.
 */

export type CanonicalUnit = 'g' | 'ml' | 'u' | 'm';

export interface SizeEach {
  quantity: number;
  unit: CanonicalUnit;
}

/**
 * Net content taken from a product name.
 * A multipack also carries `count` and `each`, so `4x30 M` and `30 M 4 Un`
 * compare equal. `quantity` / `unit` repeat `each` on a multipack, and are
 * the whole pack when `count` is absent.
 */
export interface NameSize {
  quantity: number;
  unit: CanonicalUnit;
  source: 'name';
  /** Matched text, whitespace collapsed, original spelling kept. */
  text: string;
  count?: number;
  each?: SizeEach;
}

/**
 * Units a pack line actually uses. `kilo` is accepted by the canonicalizer;
 * the pattern itself is the one the probe already matched, so a re-run still
 * sees the same spans.
 */
export const NET_UNIT =
  'kilogramos?|kilos?|kgm|kgs?|gramos?|grs?|gr|g|mililitros?|mls?|ml|litros?|ltrs?|lts?|lt|l|metros?|mts?|mt|m|rollos?|unidades?|un|u|cc';

const NET_CONTENT_SOURCE =
  `\\b(?:\\d+(?:[.,]\\d+)?\\s*[x×]\\s*\\d+(?:[.,]\\d+)?\\s*(?:${NET_UNIT})|\\d+(?:[.,]\\d+)?\\s*(?:${NET_UNIT}))(?![a-z])`;

/** Fresh instance. The global flag is stateful, so callers must not share one. */
export function netContentRe(): RegExp {
  return new RegExp(NET_CONTENT_SOURCE, 'gi');
}

const PACK_RE = new RegExp(
  `^(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${NET_UNIT})$`,
  'i',
);
const SINGLE_RE = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${NET_UNIT})$`, 'i');

interface Parsed {
  kind: 'inline' | 'measure';
  count?: number;
  quantity: number;
  unit: CanonicalUnit;
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function parseAmount(raw: string): number {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** kg/kgm/kilo → g, l/lt/ltr/litro → ml, cc → ml, un/u → u, m → m. */
function canonUnit(amount: number, unitRaw: string): SizeEach | null {
  if (!(amount > 0)) return null;
  const u = unitRaw.toLowerCase();
  let unit: CanonicalUnit;
  let factor: number;
  switch (u) {
    case 'kg':
    case 'kgs':
    case 'kgm':
    case 'kilo':
    case 'kilos':
    case 'kilogramo':
    case 'kilogramos':
      unit = 'g';
      factor = 1000;
      break;
    case 'g':
    case 'gr':
    case 'grs':
    case 'gramo':
    case 'gramos':
      unit = 'g';
      factor = 1;
      break;
    case 'l':
    case 'lt':
    case 'lts':
    case 'ltr':
    case 'ltrs':
    case 'litro':
    case 'litros':
      unit = 'ml';
      factor = 1000;
      break;
    case 'ml':
    case 'mls':
    case 'mililitro':
    case 'mililitros':
    case 'cc':
      unit = 'ml';
      factor = 1;
      break;
    case 'u':
    case 'un':
    case 'unidad':
    case 'unidades':
    case 'unidade':
    // A roll is a count. The canonical set has no separate roll unit.
    case 'rollo':
    case 'rollos':
      unit = 'u';
      factor = 1;
      break;
    case 'm':
    case 'mt':
    case 'mts':
    case 'metro':
    case 'metros':
      unit = 'm';
      factor = 1;
      break;
    default:
      return null;
  }
  return { quantity: roundQty(amount * factor), unit };
}

function parseMatch(raw: string): Parsed | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const pack = PACK_RE.exec(text);
  if (pack?.[1] && pack[2] && pack[3]) {
    const count = roundQty(parseAmount(pack[1]));
    const each = canonUnit(parseAmount(pack[2]), pack[3]);
    if (count > 0 && each) {
      return { kind: 'inline', count, quantity: each.quantity, unit: each.unit };
    }
  }
  const one = SINGLE_RE.exec(text);
  if (one?.[1] && one[2]) {
    const measured = canonUnit(parseAmount(one[1]), one[2]);
    if (measured) return { kind: 'measure', quantity: measured.quantity, unit: measured.unit };
  }
  return null;
}

export function sizeFromName(name: string): NameSize | null {
  const matches = [...name.matchAll(netContentRe())];
  if (!matches.length) return null;
  const text = matches.map((m) => m[0].replace(/\s+/g, ' ').trim()).join(' ');
  const parsed = matches.map((m) => parseMatch(m[0])).filter((p): p is Parsed => p != null);
  if (!parsed.length) return null;

  const inline = parsed.find((p) => p.kind === 'inline');
  if (inline?.count != null) {
    return {
      quantity: inline.quantity,
      unit: inline.unit,
      source: 'name',
      text,
      count: inline.count,
      each: { quantity: inline.quantity, unit: inline.unit },
    };
  }

  const counts = parsed.filter((p) => p.unit === 'u');
  const contents = parsed.filter((p) => p.unit !== 'u');
  const content = contents[0];
  const count = counts[0];
  if (content && count && count.quantity > 0) {
    return {
      quantity: content.quantity,
      unit: content.unit,
      source: 'name',
      text,
      count: count.quantity,
      each: { quantity: content.quantity, unit: content.unit },
    };
  }

  const simple = content ?? count ?? parsed[0];
  if (!simple) return null;
  return { quantity: simple.quantity, unit: simple.unit, source: 'name', text };
}

/** Same pack: both multipacks with the same count and each, or both single packs. */
export function sizesEqual(a: NameSize, b: NameSize): boolean {
  const aPack = a.count != null && a.each != null;
  const bPack = b.count != null && b.each != null;
  if (aPack !== bPack) return false;
  if (aPack && bPack && a.each && b.each) {
    return a.count === b.count && a.each.quantity === b.each.quantity && a.each.unit === b.each.unit;
  }
  return a.quantity === b.quantity && a.unit === b.unit;
}

/** The name with every net-content span removed. */
export function nameWithoutSize(name: string): string {
  return name.replace(netContentRe(), ' ').replace(/\s+/g, ' ').trim();
}

/**
 * `LA SERENÍSIMA`, `La Serenisima`, and `la   serenisima` are one brand.
 * Punctuation collapses to a space. The empty string stays empty.
 */
export function normalizeBrand(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/ +/g, ' ');
}

/** Digits only, leading zeros removed. `0659…` and `659…` are the same EAN. */
export function normalizeEan(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    value = Number.isInteger(value) ? String(value) : '';
  }
  if (typeof value !== 'string') return '';
  const digits = value.trim().replace(/\D/g, '').replace(/^0+/, '');
  return digits;
}
