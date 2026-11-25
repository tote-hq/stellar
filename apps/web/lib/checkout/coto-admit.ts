/**
 * Coto admission is a row, not an environment list.
 * A failed read admits nobody. There is no COTO_REAL_ALLOWLIST fallback.
 */

import { db, hasDatabase } from '../db.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';
import { admitCotoReal } from './coto-real.ts';
import type { SandboxCard } from './sandbox.ts';

export interface SharedCard extends SandboxCard {}

type FlagReader = (address: string) => Promise<boolean>;
type CardReader = () => Promise<SharedCard | null>;
type PresentReader = () => Promise<boolean>;

let flags: FlagReader | null = null;
let card: CardReader | null = null;
let present: PresentReader | null = null;

export function __setCotoAdmitForTests(next: { flags?: FlagReader | null; card?: CardReader | null; present?: PresentReader | null }): void {
  if ('flags' in next) flags = next.flags ?? null;
  if ('card' in next) card = next.card ?? null;
  if ('present' in next) present = next.present ?? null;
}

export async function cotoSandboxEnabled(address: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (flags) return flags(address);
  if (!hasDatabase(env)) return false;
  try {
    const rows = await db(env)`
      select 1 from allowlist
       where network = ${DEFAULT_NETWORK}
         and user_id = ${address}
         and coto_sandbox_enabled`;
    return rows.length > 0;
  } catch (err) {
    console.error('[checkout/coto] allowlist unreadable', err instanceof Error ? err.name : 'query');
    return false;
  }
}

export async function admitCotoRequest(address: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const enabled = env.COTO_REAL_ENABLED === '1';
  if (!enabled) return admitCotoReal({ enabled: false, sandboxEnabled: false });
  return admitCotoReal({ enabled: true, sandboxEnabled: await cotoSandboxEnabled(address, env) });
}

export async function sharedCardPresent(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (present) return present();
  if (!hasDatabase(env)) return false;
  try {
    const rows = await db(env)`select 1 from shared_card where network = ${DEFAULT_NETWORK}`;
    return rows.length > 0;
  } catch (err) {
    console.error('[checkout/coto] card presence unreadable', err instanceof Error ? err.name : 'query');
    return false;
  }
}

/** The ops card for the sandbox channel. Never log the return value. */
export async function loadSharedCard(env: NodeJS.ProcessEnv = process.env): Promise<SharedCard | null> {
  if (card) return card();
  if (!hasDatabase(env)) return null;
  try {
    const rows = await db(env)`
      select pan, cvv, exp_month, exp_year, holder
        from shared_card where network = ${DEFAULT_NETWORK}`;
    const row = rows[0] as
      | { pan: string; cvv: string; exp_month: string; exp_year: string; holder: string }
      | undefined;
    if (!row) return null;
    return {
      pan: row.pan,
      cvv: row.cvv,
      exp_month: row.exp_month,
      exp_year: row.exp_year,
      holder: row.holder,
      kind: 'debit',
    };
  } catch (err) {
    console.error('[checkout/coto] card unreadable', err instanceof Error ? err.name : 'query');
    return null;
  }
}
