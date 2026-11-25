import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Idle is only the reduced-motion stand-in for the search animation.
 */

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

test('reduced motion swaps the search GIF for the idle pose', () => {
  const css = source(join(web, 'app/globals.css'));
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.length > 0, 'prefers-reduced-motion block is missing');
  assert.match(reduced, /\.thinking-mascot-motion\s*\{[^}]*display:\s*none/);
  assert.match(reduced, /\.thinking-mascot-still\s*\{[^}]*display:\s*block/);

  const stillRule = css.slice(css.indexOf('.thinking-mascot-still {'));
  assert.match(stillRule.slice(0, 80), /display:\s*none/);
});
