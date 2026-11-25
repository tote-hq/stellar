import { argon2id } from '@noble/hashes/argon2';
import { timingSafeEqual } from 'node:crypto';

/**
 * hash-wasm compiles its argon2 module from a base64 blob on the first call.
 * Workers reject that compile, so every login threw CompileError before the
 * password was compared. noble is plain JavaScript and checks the stored PHC
 * as written, including the node-argon2 defaults (m=65536, t=3, p=4). That
 * pass takes about a second.
 */

/**
 * Public dummy. Unknown users still run a verify, at the same cost as a
 * stored hash (argon2id, m=65536, t=3, p=4). A cheaper dummy would say which
 * usernames exist.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$/QAKzAkRf+6lkfyq4PCaSg$waxKyVAsGotfwWXm6uJzRv2bUk+P80F1qWWvii1oCdk';

export type PasswordMatch =
  | { ok: true }
  | { ok: false; reason: 'mismatch' }
  | { ok: false; reason: 'threw'; errorName: string };

const PHC =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function phcBytes(encoded: string): Buffer {
  const pad = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
  return Buffer.from(encoded + pad, 'base64');
}

/** PHC writes 19 and 16. noble wants the raw version byte. */
function argonVersion(v: number): number {
  if (v === 19) return 0x13;
  if (v === 16) return 0x10;
  throw new Error('bad phc');
}

/** The name only. A verifier message can echo the hash string. */
export async function passwordMatches(password: string, hash: string): Promise<PasswordMatch> {
  try {
    const match = PHC.exec(hash);
    const saltEnc = match?.[5];
    const hashEnc = match?.[6];
    if (!match || !saltEnc || !hashEnc) throw new Error('bad phc');
    const memory = Number(match[2]);
    const time = Number(match[3]);
    const parallelism = Number(match[4]);
    if (memory < 1 || time < 1 || parallelism < 1) throw new Error('bad phc');
    const salt = phcBytes(saltEnc);
    const expected = phcBytes(hashEnc);
    if (salt.length < 8 || expected.length < 1) throw new Error('bad phc');
    const digest = argon2id(new TextEncoder().encode(password), salt, {
      t: time,
      m: memory,
      p: parallelism,
      dkLen: expected.length,
      version: argonVersion(Number(match[1])),
    });
    const same = digest.length === expected.length && timingSafeEqual(digest, expected);
    return same ? { ok: true } : { ok: false, reason: 'mismatch' };
  } catch (err) {
    const errorName = err instanceof Error && err.name ? err.name : 'Error';
    return { ok: false, reason: 'threw', errorName };
  }
}
