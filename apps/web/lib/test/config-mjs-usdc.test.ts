import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * `scripts/config.mjs` rejects anything but mock or circle before it talks
 * to the database. `circle` is allowed, so a closed port is a connection
 * failure (exit 1), not the validator (exit 2).
 */

const script = new URL('../../../../scripts/config.mjs', import.meta.url);
const dead = 'postgres://127.0.0.1:1/config_mjs_usdc_test';

function run(args: string[]) {
  return spawnSync(process.execPath, [script.pathname, ...args], {
    env: { ...process.env, DIRECT_URL: dead, DATABASE_URL: dead },
    encoding: 'utf8',
  });
}

describe('config.mjs usdc source', () => {
  it('set usdc_source_guest circle is accepted, and yes exits 2', () => {
    const yes = run(['set', 'usdc_source_guest', 'yes']);
    assert.equal(yes.status, 2);
    assert.match(yes.stderr, /must be mock or circle/);
    assert.equal(yes.stderr.includes(dead), false);

    const circle = run(['set', 'usdc_source_guest', 'circle']);
    assert.notEqual(circle.status, 2);
    assert.equal(circle.status, 1);
    assert.doesNotMatch(circle.stderr, /must be mock or circle/);

    const signed = run(['set', 'usdc_source_signed_in', 'Circle']);
    assert.equal(signed.status, 2);

    const src = readFileSync(script, 'utf8');
    assert.match(src, /USDC_SOURCE_KEYS\.has\(key\)\s*\n\s*\? 'reads as mock'/);
  });
});
