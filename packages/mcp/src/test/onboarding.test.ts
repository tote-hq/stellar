import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  CATALOG_INSTRUCTIONS,
  SERVER_INSTRUCTIONS,
  setupGuidePath,
} from '../onboarding.js';

describe('setupGuidePath', () => {
  it('points at a file that actually exists', () => {
    // The whole reason this function exists is that "see SETUP.md" is useless
    // to someone who never cloned the repo. A path that does not resolve is
    // worse than no path at all.
    assert.ok(existsSync(setupGuidePath()), `${setupGuidePath()} does not exist`);
  });
});

describe('CATALOG_INSTRUCTIONS', () => {
  it('names no checkout tool, because a catalog server registers none', () => {
    for (const tool of ['link_marketplace_account', 'review_order', 'build_cart', 'diagnose']) {
      assert.ok(!CATALOG_INSTRUCTIONS.includes(tool), `promises ${tool}, which is not registered`);
    }
  });

  it('keeps the two rules that protect the user', () => {
    assert.match(CATALOG_INSTRUCTIONS, /never ask for a password/i);
    assert.match(CATALOG_INSTRUCTIONS, /name or a DNI/i);
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  it('carries the two rules that protect the user, in the model-facing slot', () => {
    // These are the only two places the model could cause real harm by being
    // helpful, so they belong where the model reads them, not only in a doc.
    assert.match(SERVER_INSTRUCTIONS, /[Nn]ever ask .*password/);
    assert.match(SERVER_INSTRUCTIONS, /[Nn]ever ask .*name or DNI/);
  });
});

describe('RULE: the server tells the client how to use it', () => {
  it('server.ts declares instructions and a version matching package.json', async () => {
    const src = await readFile(new URL('../../src/server.ts', import.meta.url), 'utf8');
    assert.match(
      src,
      /instructions:\s*opts\.instructions \?\? CATALOG_INSTRUCTIONS/,
      'the MCP instructions slot is empty, or no longer defaults to the catalog half',
    );

    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    // Tolerates the factory's override default (`version: opts.version ?? 'x'`).
    // A host may rename the server; the version it falls back to is still ours.
    const declared = new RegExp(`version:[^,\\n]*'${pkg.version.replace(/\./g, '\\.')}'`);
    assert.match(
      src,
      declared,
      `server.ts reports a different version than package.json (${pkg.version})`,
    );
  });

  it('no error message points at a bare "SETUP.md" the user cannot find', async () => {
    const files = ['config.ts', 'tools.ts', 'checkout/purchase.ts', 'checkout/driver.ts'];
    for (const f of files) {
      const src = await readFile(new URL(`../../src/${f}`, import.meta.url), 'utf8');
      for (const line of src.split('\n')) {
        if (/^\s*(\*|\/\/)/.test(line)) continue; // comments may say SETUP.md
        assert.ok(
          !/["'`][^"'`]*\bSETUP\.md\b/.test(line),
          `${f} hardcodes a bare SETUP.md in a message — use setupRef(): ${line.trim()}`,
        );
      }
    }
  });
});
