/**
 * Catalog evidence for the Coto source. Prints to stdout and writes nothing.
 * The Constructor key is read by CotoCatalog and is never printed.
 *
 *   node dist/catalog-search.js
 *   node dist/catalog-search.js "leche entera"
 *   node dist/catalog-search.js --match-dia "leche entera"
 */
import { getAdapter } from './adapters/registry.js';
import { CotoCatalog, type CatalogItem } from './catalog/coto.js';
import { matchDiaToCoto, type MatchConfidence } from './catalog/match.js';
import { CATALOG_QUERIES } from './catalog/queries.js';
import { sizeFromName, type NameSize } from './catalog/normalize.js';
import { RetailerError, type Money, type Product } from './types.js';

const DIA_POSTAL = '1425';
const LIMIT = 5;

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

function pesos(money: Money | undefined): string {
  if (!money) return '—';
  const value = money.centavos / 100;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function plain(n: number): string {
  return String(n);
}

function canonical(size: NameSize): string {
  if (size.count != null && size.each) {
    return `${plain(size.count)} × ${plain(size.each.quantity)} ${size.each.unit}`;
  }
  return `${plain(size.quantity)} ${size.unit}`;
}

function sizeCell(size: NameSize | undefined): string {
  if (!size) return '—';
  return `from name: ${size.text} → ${canonical(size)}`;
}

function basisCell(item: CatalogItem): string {
  const basis = item.unitBasis;
  if (!basis) return '—';
  const qty = basis.quantity != null ? `${plain(basis.quantity)} ` : '';
  const format = basis.format ?? '';
  return `${qty}${format}`.trim() + ' (unit price basis, not pack size)';
}

function errorText(e: unknown): string {
  if (e instanceof RetailerError) return `${e.code}: ${e.message}`;
  return 'request failed';
}

function catalogTable(query: string, items: readonly CatalogItem[]): string {
  const head = [
    `## ${query}`,
    '',
    '| Name | Shelf price (ARS) | List price | EAN | Brand | Size | Unit basis | Available |',
    '|---|---|---|---|---|---|---|---|',
  ];
  if (!items.length) {
    return [...head, '| — | — | — | — | — | — | — | — |', '', 'no results', ''].join('\n');
  }
  const body = items.map((item) =>
    `| ${cell(item.name)} | ${cell(pesos(item.shelfPrice))} | ${cell(pesos(item.listPrice))} | ${cell(item.ean ?? '—')} | ${cell(item.brand ?? '—')} | ${cell(sizeCell(item.size))} | ${cell(basisCell(item))} | ${item.available ? 'yes' : 'no'} |`,
  );
  return [...head, ...body, ''].join('\n');
}

function matchTable(query: string, rows: Array<{ dia: Product; coto: CatalogItem | null; confidence: MatchConfidence }>): string {
  const head = [
    `# Día → Coto`,
    '',
    `Query: ${query}`,
    `Día postal: ${DIA_POSTAL}`,
    '',
    '| Día name | Día price | Día EAN | Día brand | Día size | Coto name | Coto shelf | Coto EAN | Coto size | Confidence |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  if (!rows.length) {
    return [...head, '| — | — | — | — | — | — | — | — | — | — |', '', 'Día returned no products', ''].join('\n');
  }
  const body = rows.map(({ dia, coto, confidence }) =>
    `| ${cell(dia.name)} | ${cell(pesos(dia.price))} | ${cell(dia.ean?.trim() || '—')} | ${cell(dia.brand?.trim() || '—')} | ${cell(sizeCell(sizeFromName(dia.name) ?? undefined))} | ${cell(coto?.name ?? '—')} | ${cell(coto ? pesos(coto.shelfPrice) : '—')} | ${cell(coto?.ean ?? '—')} | ${cell(coto ? sizeCell(coto.size) : '—')} | ${confidence} |`,
  );
  return [...head, ...body, ''].join('\n');
}

async function searchQueries(queries: readonly string[]): Promise<void> {
  const catalog = new CotoCatalog();
  for (const query of queries) {
    try {
      const items = await catalog.search(query, { limit: LIMIT });
      process.stdout.write(`${catalogTable(query, items)}\n`);
    } catch (e) {
      process.stdout.write(`## ${query}\n\n${errorText(e)}\n\n`);
      process.exitCode = 1;
    }
  }
}

async function matchDia(query: string): Promise<void> {
  const dia = getAdapter('dia');
  const ctx = await dia.resolveLocation(DIA_POSTAL);
  const products = await dia.search(query, ctx, { limit: LIMIT });
  const coto = new CotoCatalog();
  const rows: Array<{ dia: Product; coto: CatalogItem | null; confidence: MatchConfidence }> = [];
  for (const product of products) {
    const result = await matchDiaToCoto(product, coto);
    rows.push({ dia: product, coto: result.match, confidence: result.confidence });
  }
  process.stdout.write(`${matchTable(query, rows)}\n`);
}

function parseArgs(argv: readonly string[]): { matchDia?: string; queries: string[] } | null {
  const args = argv.slice(2);
  const flag = args.indexOf('--match-dia');
  if (flag >= 0) {
    const query = args[flag + 1];
    if (!query || query.startsWith('--')) return null;
    return { matchDia: query, queries: [] };
  }
  const queries = args.filter((arg) => !arg.startsWith('--'));
  return { queries: queries.length ? queries : [...CATALOG_QUERIES] };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    process.stderr.write('Usage: catalog-search [query ...] | catalog-search --match-dia "<query>"\n');
    process.exitCode = 1;
    return;
  }
  if (parsed.matchDia) {
    await matchDia(parsed.matchDia);
    return;
  }
  await searchQueries(parsed.queries);
}

try {
  await main();
} catch (e) {
  process.stderr.write(`${errorText(e)}\n`);
  process.exitCode = 1;
}
