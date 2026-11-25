/**
 * Who gets demo USDC, how much, and when they have had enough.
 *
 * Pure, because this is the part worth being sure about: the mint is
 * admin-gated, which means every call to it is signed by our one hot key, and
 * "how often can a stranger make that key sign something" should not be a
 * question answered inside an HTTP handler.
 *
 * One rule only: +100 USDC chunks, balance capped at 1000 USDC. No leftover
 * target-balance mint. The route rejects chunks outside 1..10 before calling
 * faucetMint / faucetVerdict.
 */

/** 100.00 USDC per chunk (7 decimals). */
export const CHUNK_UNITS = 1_000_000_000n;

/** 1000.00 USDC balance cap (7 decimals). */
export const CAP_UNITS = 10_000_000_000n;

/** One grant (one POST) per address per minute. */
export const COOLDOWN_MS = 60_000;

/** Body `{ chunks }` must be an integer in this inclusive range. */
export const MIN_CHUNKS = 1;
export const MAX_CHUNKS = 10;

export type FaucetDenyReason = 'cap' | 'cooldown';

export type FaucetVerdict =
  | { allow: true; amount: bigint }
  | { allow: false; reason: string; reasonKind: FaucetDenyReason; retryInMs?: number };

export interface FaucetRequest {
  /** The address's current demo USDC, in token units. */
  balanceUnits: bigint;
  /** When this address was last granted, or undefined if never. */
  lastGrantAt?: number;
  now: number;
  /** Chunks requested; the route already clamped to 1..10. */
  chunks?: number;
}

/**
 * Units to mint for this balance and chunk count.
 * Zero when the balance is already at the cap. Clips the last chunk so the
 * balance never crosses CAP (950 + one chunk → +50, not +100).
 */
export function faucetMint(balanceUnits: bigint, chunks = 1): bigint {
  const balance = balanceUnits > 0n ? balanceUnits : 0n;
  if (balance >= CAP_UNITS) return 0n;
  const n = BigInt(chunks);
  const want = n * CHUNK_UNITS;
  const room = CAP_UNITS - balance;
  return want < room ? want : room;
}

/** How many chunks (1..10) cover a lock shortfall, or 0 when already funded. */
export function chunksForShortfall(balanceUnits: bigint, lockUnits: bigint): number {
  const balance = balanceUnits > 0n ? balanceUnits : 0n;
  if (lockUnits <= balance) return 0;
  const need = lockUnits - balance;
  const raw = Number((need + CHUNK_UNITS - 1n) / CHUNK_UNITS);
  if (!Number.isFinite(raw) || raw < 1) return 0;
  return Math.min(MAX_CHUNKS, raw);
}

export function faucetVerdict({
  balanceUnits,
  lastGrantAt,
  now,
  chunks = 1,
}: FaucetRequest): FaucetVerdict {
  if (balanceUnits >= CAP_UNITS) {
    return {
      allow: false,
      reasonKind: 'cap',
      reason: 'Ya tenés el máximo de USDC de prueba (1000). Gastá un poco y volvé a cargar.',
    };
  }

  if (lastGrantAt !== undefined) {
    const elapsed = now - lastGrantAt;
    // A clock that went backwards (a redeploy, a different machine) is treated
    // as "too soon" rather than as permission.
    if (elapsed < COOLDOWN_MS) {
      return {
        allow: false,
        reasonKind: 'cooldown',
        reason: 'Esperá un momento antes de volver a pedir fondos.',
        retryInMs: Math.max(0, COOLDOWN_MS - Math.max(elapsed, 0)),
      };
    }
  }

  const amount = faucetMint(balanceUnits, chunks);
  if (amount === 0n) {
    return {
      allow: false,
      reasonKind: 'cap',
      reason: 'Ya tenés el máximo de USDC de prueba (1000). Gastá un poco y volvé a cargar.',
    };
  }

  return { allow: true, amount };
}
