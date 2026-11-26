/**
 * Coto admission is a row, not an environment list.
 * A failed read admits nobody. There is no COTO_REAL_ALLOWLIST fallback.
 * This path does not read a card. Payment uses the card saved on the Coto account.
 */

import { db, hasDatabase } from '../db.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';
import { admitCotoReal } from './coto-real.ts';

type FlagReader = (address: string) => Promise<boolean>;

let flags: FlagReader | null = null;

export function __setCotoAdmitForTests(next: { flags?: FlagReader | null }): void {
  if ('flags' in next) flags = next.flags ?? null;
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
