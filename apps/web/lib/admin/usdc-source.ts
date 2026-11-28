/**
 * The two balance-line flags, with `updated_at`.
 *
 * `getConfig()` does not select the timestamp, and the operator screen needs
 * it. Each function touches exactly the rows it names. A missing row is
 * `null`, which the screen shows as the mock default. No database is the
 * same shape: nothing to read, and a write does not pretend it landed.
 */
import type { UsdcSource } from '../config.ts';
import { db, hasDatabase } from '../db.ts';

export const USDC_SOURCE_KEYS = ['usdc_source_guest', 'usdc_source_signed_in'] as const;
export type UsdcSourceKey = (typeof USDC_SOURCE_KEYS)[number];

export interface UsdcSourceRow {
  value: unknown;
  updatedAt: string;
}

export interface UsdcSourceRows {
  usdc_source_guest: UsdcSourceRow | null;
  usdc_source_signed_in: UsdcSourceRow | null;
}

const EMPTY: UsdcSourceRows = { usdc_source_guest: null, usdc_source_signed_in: null };

/** Test stand-in. `null` uses the database (or the empty reading). */
let memory: Map<string, UsdcSourceRow> | null = null;

export function __setUsdcSourceMemoryForTests(rows: Map<string, UsdcSourceRow> | null): void {
  memory = rows;
}

export function isUsdcSourceKey(value: unknown): value is UsdcSourceKey {
  return value === 'usdc_source_guest' || value === 'usdc_source_signed_in';
}

export function isUsdcSourceValue(value: unknown): value is UsdcSource {
  return value === 'mock' || value === 'circle';
}

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : String(value ?? '');
}

function fromMemory(): UsdcSourceRows {
  return {
    usdc_source_guest: memory?.get('usdc_source_guest') ?? null,
    usdc_source_signed_in: memory?.get('usdc_source_signed_in') ?? null,
  };
}

export async function readUsdcSources(): Promise<UsdcSourceRows> {
  if (memory) return fromMemory();
  if (!hasDatabase()) return EMPTY;
  const rows = await db()`
    select key, value, updated_at from config
     where key in ('usdc_source_guest', 'usdc_source_signed_in')`;
  const out: UsdcSourceRows = { ...EMPTY };
  for (const row of rows) {
    const key = row.key as string;
    if (!isUsdcSourceKey(key)) continue;
    out[key] = { value: row.value, updatedAt: stamp(row.updated_at) };
  }
  return out;
}

/** Upserts one key. Returns null when there is no database to write. */
export async function writeUsdcSource(key: UsdcSourceKey, value: UsdcSource): Promise<UsdcSourceRow | null> {
  if (memory) {
    const row = { value, updatedAt: new Date().toISOString() };
    memory.set(key, row);
    return row;
  }
  if (!hasDatabase()) return null;
  const sql = db();
  const rows = await sql`
    insert into config (key, value) values (${key}, ${sql.json(value as never)})
    on conflict (key) do update set value = excluded.value
    returning value, updated_at`;
  const row = rows[0] as { value: unknown; updated_at: unknown } | undefined;
  if (!row) return null;
  return { value: row.value, updatedAt: stamp(row.updated_at) };
}
