import { timingSafeEqual } from 'node:crypto';

/**
 * Temporary admin check. argon2id at the stored node-argon2 defaults took
 * about ten seconds on the Worker, long enough that a login looked dead.
 * WebCrypto PBKDF2-HMAC-SHA256 at 100,000 iterations is the most Workers
 * will run, takes milliseconds, and does not compile WebAssembly. Old
 * argon2 password_hash rows do not verify and have to be replaced.
 */

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DK_BYTES = 32;

/**
 * Public dummy, same cost as a real hash. Unknown users still run a verify
 * so the branch is not a fast reject.
 */
export const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$100000$ZHVtbXktc2FsdC0xNmJ5dA$eRP0nlw0AxbUGEThH0v-VfPXaNjQcJ2oHU8fyxkZcpc';

export type PasswordMatch =
  | { ok: true }
  | { ok: false; reason: 'mismatch' }
  | { ok: false; reason: 'threw'; errorName: string };

const PHC = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function b64decode(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, 'base64url'));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const subtleEq = (crypto.subtle as { timingSafeEqual?: (left: Uint8Array, right: Uint8Array) => boolean })
    .timingSafeEqual;
  if (typeof subtleEq === 'function') return subtleEq(a, b);
  return timingSafeEqual(a, b);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBytes = new Uint8Array(salt.byteLength);
  saltBytes.set(salt);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    DK_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** A new password_hash line. The salt is random. The password is not stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await derive(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(dk)}`;
}

/** The name only. A verifier message can echo the hash string. */
export async function passwordMatches(password: string, hash: string): Promise<PasswordMatch> {
  try {
    const match = PHC.exec(hash);
    const iterations = match ? Number(match[1]) : 0;
    const saltEnc = match?.[2];
    const hashEnc = match?.[3];
    if (!match || !saltEnc || !hashEnc || iterations !== ITERATIONS) throw new Error('bad phc');
    const salt = b64decode(saltEnc);
    const expected = b64decode(hashEnc);
    if (salt.length < 8 || expected.length !== DK_BYTES) throw new Error('bad phc');
    const digest = await derive(password, salt, iterations);
    return sameBytes(digest, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
  } catch (err) {
    const errorName = err instanceof Error && err.name ? err.name : 'Error';
    return { ok: false, reason: 'threw', errorName };
  }
}
