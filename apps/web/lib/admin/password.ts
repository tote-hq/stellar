import { argon2Verify } from 'hash-wasm';

/** Public dummy. Unknown users still run a verify so the branch is not a fast reject. */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=16384,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$CqYqe/77QHPNOD2kaRvLyCOd4y3+sAKWlx8zGLoDDLY';

export type PasswordMatch =
  | { ok: true }
  | { ok: false; reason: 'mismatch' }
  | { ok: false; reason: 'threw'; errorName: string };

/** The name only. The message from hash-wasm can echo the hash string. */
export async function passwordMatches(password: string, hash: string): Promise<PasswordMatch> {
  try {
    const ok = await argon2Verify({ password, hash });
    return ok ? { ok: true } : { ok: false, reason: 'mismatch' };
  } catch (err) {
    const errorName = err instanceof Error && err.name ? err.name : 'Error';
    return { ok: false, reason: 'threw', errorName };
  }
}
