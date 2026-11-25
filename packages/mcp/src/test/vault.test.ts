import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { decryptJson, encryptJson, writeVault } from '../secure/vault.js';

const PASS = 'correct horse battery staple';
const dir = join(tmpdir(), `vault-test-${process.pid}`);
after(() => fs.rm(dir, { recursive: true, force: true }));

describe('vault round trip', () => {
  it('returns exactly what went in', async () => {
    const data = { cookies: [{ name: 'VtexIdclientAutCookie', value: 'abc' }], origins: [] };
    assert.deepEqual(await decryptJson(await encryptJson(data, PASS), PASS), data);
  });
});

describe('vault fails closed', () => {
  it('rejects the wrong passphrase', async () => {
    const blob = await encryptJson({ x: 1 }, PASS);
    await assert.rejects(() => decryptJson(blob, 'wrong passphrase entirely'), /Could not decrypt/);
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    const file = JSON.parse(await encryptJson({ x: 1 }, PASS));
    const ct = Buffer.from(file.ct, 'base64');
    ct[0] ^= 0xff;
    file.ct = ct.toString('base64');
    await assert.rejects(() => decryptJson(JSON.stringify(file), PASS), /Could not decrypt/);
  });

  it('refuses to encrypt or decrypt with an empty passphrase', async () => {
    await assert.rejects(() => encryptJson({ x: 1 }, ''), /passphrase is required/);
    await assert.rejects(() => decryptJson('{}', ''), /passphrase is required/);
  });
});

describe('vault on disk', () => {
  it('writes owner-only, because the file is a live login', async () => {
    const path = join(dir, 'perms.enc');
    await writeVault(path, { x: 1 }, PASS);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  });
});
