/**
 * The `wallet` table: one row per address that has signed in.
 *
 * Written at login, after the SEP-53 proof and before the cookie. A missing
 * database, or a migration that has not been applied yet, does not refuse
 * the login: the row is how an operator manages the wallet afterwards, and
 * a shop that cannot reach Postgres still has to let a proven wallet in.
 * A row that says `banned` does refuse the cookie.
 *
 * Its relative imports name their extension, so the module loads under
 * `node --experimental-strip-types`.
 */
import type { NetworkId } from './deployments.ts';
import { DEFAULT_NETWORK } from './deployments.ts';
import { db, hasDatabase } from './db.ts';
import { loginNetwork } from './pollar.ts';

export interface WalletStanding {
  network: NetworkId;
  faucetAllowed: boolean;
  banned: boolean;
  /** False when this process did not read or write a row. */
  stored: boolean;
  /**
   * Random id PostHog may use as a distinct id. Null when this process did
   * not read a row, or the row has none yet. Never the wallet address.
   */
  analyticsId: string | null;
}

const OPEN = { faucetAllowed: false, banned: false, stored: false, analyticsId: null } as const;

export function walletNetwork(env: NodeJS.ProcessEnv = process.env): NetworkId {
  return (
    loginNetwork({
      testnet: env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
      mainnet: env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
    }) ?? DEFAULT_NETWORK
  );
}

function standingOf(
  network: NetworkId,
  row: { faucet_allowed: boolean; banned: boolean; analytics_id?: string | null },
): WalletStanding {
  const analyticsId = typeof row.analytics_id === 'string' && row.analytics_id.length > 0 ? row.analytics_id : null;
  return {
    network,
    faucetAllowed: row.faucet_allowed === true,
    banned: row.banned === true,
    stored: true,
    analyticsId,
  };
}

/**
 * A stand-in for the table, so a test can ban a wallet without Postgres.
 * Production leaves it unset and talks to the database.
 */
export interface WalletDirectory {
  register(network: NetworkId, address: string): Promise<WalletStanding>;
  standing(network: NetworkId, address: string): Promise<WalletStanding>;
  openToAll(): Promise<boolean>;
}

/**
 * Insert the wallet the first time it signs in. An existing row is returned
 * unchanged, including a ban or a faucet grant written before this login.
 *
 * `analytics_id` is a random UUID, set on insert and filled in on a later
 * login only when it is still null. An unconditional `on conflict do update`
 * would also fire `wallet_touch` and rewrite `updated_at` on every login.
 */
export async function registerWallet(
  address: string,
  env: NodeJS.ProcessEnv = process.env,
  network: NetworkId = walletNetwork(env),
  directory?: WalletDirectory,
): Promise<WalletStanding> {
  const standIn = directoryOf(directory);
  if (standIn) return standIn.register(network, address);
  if (!hasDatabase(env)) return { network, ...OPEN };
  try {
    const inserted = await db(env)`
      insert into wallet (network, address, analytics_id)
      values (${network}, ${address}, gen_random_uuid())
      on conflict (network, address) do nothing
      returning faucet_allowed, banned, analytics_id`;
    if (inserted.length > 0) return standingOf(network, inserted[0] as { faucet_allowed: boolean; banned: boolean; analytics_id: string | null });
    const filled = await db(env)`
      update wallet
      set analytics_id = gen_random_uuid()
      where network = ${network} and address = ${address} and analytics_id is null
      returning faucet_allowed, banned, analytics_id`;
    if (filled.length > 0) return standingOf(network, filled[0] as { faucet_allowed: boolean; banned: boolean; analytics_id: string | null });
    const existing = await db(env)`
      select faucet_allowed, banned, analytics_id from wallet
      where network = ${network} and address = ${address}`;
    const row = existing[0] as { faucet_allowed: boolean; banned: boolean; analytics_id: string | null } | undefined;
    if (!row) return { network, ...OPEN };
    return standingOf(network, row);
  } catch (err) {
    console.warn('[wallet] register failed; login continues:', err instanceof Error ? err.message : err);
    return { network, ...OPEN };
  }
}

/**
 * Read the row without creating one. The faucet uses this: a request that
 * has not proved the address must not insert it.
 */
export async function walletStanding(
  address: string,
  env: NodeJS.ProcessEnv = process.env,
  network: NetworkId = walletNetwork(env),
  directory?: WalletDirectory,
): Promise<WalletStanding> {
  const standIn = directoryOf(directory);
  if (standIn) return standIn.standing(network, address);
  if (!hasDatabase(env)) return { network, ...OPEN };
  try {
    const rows = await db(env)`
      select faucet_allowed, banned, analytics_id from wallet
      where network = ${network} and address = ${address}`;
    const row = rows[0] as { faucet_allowed: boolean; banned: boolean; analytics_id: string | null } | undefined;
    if (!row) return { network, ...OPEN };
    return standingOf(network, row);
  } catch (err) {
    console.warn('[wallet] read failed; treating the wallet as unbanned:', err instanceof Error ? err.message : err);
    return { network, ...OPEN };
  }
}

/** `config.faucet_open_to_all`. Missing row, missing table and no database are false. */
export async function faucetOpenToAll(env: NodeJS.ProcessEnv = process.env, directory?: WalletDirectory): Promise<boolean> {
  const standIn = directoryOf(directory);
  if (standIn) return standIn.openToAll();
  if (!hasDatabase(env)) return false;
  try {
    const rows = await db(env)`select value from config where key = 'faucet_open_to_all'`;
    const value = rows[0]?.value;
    return value === true || value === 'true';
  } catch {
    return false;
  }
}

/** The database is the only faucet list. A ban wins over both flags. */
export function faucetAdmitted(standing: Pick<WalletStanding, 'banned' | 'faucetAllowed'>, openToAll: boolean): boolean {
  if (standing.banned) return false;
  return openToAll || standing.faucetAllowed;
}

let testDirectory: WalletDirectory | undefined;

/** Route tests install a stand-in. Production never calls this. */
export function __setWalletDirectoryForTests(next?: WalletDirectory): void {
  testDirectory = next;
}

function directoryOf(passed?: WalletDirectory): WalletDirectory | undefined {
  return passed ?? testDirectory;
}
