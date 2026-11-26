import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DUMMY_PASSWORD_HASH, passwordMatches } from '../admin/password.ts';

/**
 * Produced by node-argon2@0.44.0 with its defaults: argon2id, v=19,
 * m=65536, t=3, p=4. The password is a fixture, not an account.
 */
const NODE_ARGON2_DEFAULT =
  '$argon2id$v=19$m=65536,t=3,p=4$UFdWPYubAWq97fLhhoCv5Q$HCLmGmzduptdJbWua5BSEgaShOHmkfQ5Zq6+NqtQtmg';

describe('passwordMatches', () => {
  it('accepts a node-argon2 0.44.0 default hash', async () => {
    assert.deepEqual(await passwordMatches('benchmark-password', NODE_ARGON2_DEFAULT), { ok: true });
  });

  it('rejects a different password for that hash', async () => {
    assert.deepEqual(await passwordMatches('wrong-probe', NODE_ARGON2_DEFAULT), {
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects the same-cost dummy hash instead of throwing', async () => {
    assert.deepEqual(await passwordMatches('wrong-probe', DUMMY_PASSWORD_HASH), {
      ok: false,
      reason: 'mismatch',
    });
  });

  it('names a bad string as a throw and does not echo it', async () => {
    const bad = 'not-a-phc-secret-string';
    const res = await passwordMatches('x', bad);
    assert.deepEqual(res, { ok: false, reason: 'threw', errorName: 'Error' });
    assert.equal(JSON.stringify(res).includes(bad), false);
  });
});
