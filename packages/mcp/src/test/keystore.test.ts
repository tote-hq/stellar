import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { forgetAllSecrets } from '../secure/redact.js';
import { createKeystore, withSigner } from '../wallet/keystore.js';

/**
 * Hardhat's account #0. This key is printed in Hardhat's README and is in every
 * public test fixture on earth — it is deliberately NOT a real key, and it must
 * never hold real funds.
 */
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PASS = 'a sufficiently long passphrase';

const dir = join(tmpdir(), `keystore-test-${process.pid}`);
const path = join(dir, 'wallet.keystore.json');

// One keystore for the whole suite: ethers uses scrypt N=2^18, so each
// encrypt/decrypt is ~1s. Creating one per test would make the suite crawl.
before(async () => {
  await createKeystore(TEST_KEY, PASS, path);
});
after(async () => {
  forgetAllSecrets();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createKeystore', () => {
  it('never writes the plaintext key to disk', async () => {
    const raw = await fs.readFile(path, 'utf8');
    assert.ok(!raw.includes(TEST_KEY));
    assert.ok(!raw.includes(TEST_KEY.slice(2)));
  });
});

describe('withSigner', () => {
  it('unlocks and yields a signer for the right address', async () => {
    const addr = await withSigner({ path, passphrase: PASS }, async (w) => w.address);
    assert.equal(addr, TEST_ADDR);
  });

  it('fails closed on the wrong passphrase', async () => {
    await assert.rejects(
      () => withSigner({ path, passphrase: 'definitely not it' }, async () => 1),
      /wrong passphrase, or the file is corrupt/,
    );
  });
});
