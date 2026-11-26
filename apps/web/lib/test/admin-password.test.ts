import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DUMMY_PASSWORD_HASH, hashPassword, passwordMatches } from '../admin/password.ts';

describe('passwordMatches', () => {
  it('accepts a hash it just made', async () => {
    const hash = await hashPassword('benchmark-password');
    assert.deepEqual(await passwordMatches('benchmark-password', hash), { ok: true });
  });

  it('rejects a different password', async () => {
    const hash = await hashPassword('benchmark-password');
    assert.deepEqual(await passwordMatches('wrong-probe', hash), { ok: false, reason: 'mismatch' });
  });

  it('accepts the published dummy for its fixture password', async () => {
    assert.deepEqual(await passwordMatches('not-a-password', DUMMY_PASSWORD_HASH), { ok: true });
  });

  it('rejects the dummy hash instead of throwing', async () => {
    assert.deepEqual(await passwordMatches('wrong-probe', DUMMY_PASSWORD_HASH), {
      ok: false,
      reason: 'mismatch',
    });
  });

  it('names an old argon2 string as a throw and does not echo it', async () => {
    const bad =
      '$argon2id$v=19$m=65536,t=3,p=4$UFdWPYubAWq97fLhhoCv5Q$HCLmGmzduptdJbWua5BSEgaShOHmkfQ5Zq6+NqtQtmg';
    const res = await passwordMatches('x', bad);
    assert.deepEqual(res, { ok: false, reason: 'threw', errorName: 'Error' });
    assert.equal(JSON.stringify(res).includes(bad), false);
  });
});
