import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { qrPicture } from '../qr.ts';

/** A real Stellar address: 56 characters, base32, its own CRC16 at the end. */
const ADDRESS = 'GDVSFA5SYQ2K7PUQ5JXKYL4XHHHM2A7T3ZTPXYQWFZGDIZ3ZHFHMNEZK';

/** Every `M<x> <y>h<len>` in the path, as numbers. */
function runs(d: string): { x: number; y: number; len: number }[] {
  return [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    len: Number(m[3]),
  }));
}

describe('qrPicture', () => {
  it('RULE: the quiet zone is inside the picture, not left to the caller', () => {
    // A code bled to the edge of its box does not scan at all, so the margin
    // cannot be something a component remembers to add.
    const { size, d } = qrPicture(ADDRESS);
    const all = runs(d);
    const minX = Math.min(...all.map((r) => r.x));
    const minY = Math.min(...all.map((r) => r.y));
    const maxX = Math.max(...all.map((r) => r.x + r.len));
    const maxY = Math.max(...all.map((r) => r.y));

    assert.equal(minX, 4);
    assert.equal(minY, 4);
    assert.equal(maxX, size - 4);
    assert.equal(maxY, size - 4 - 1);
  });

  it('is deterministic, so the same address always draws the same picture', () => {
    assert.equal(qrPicture(ADDRESS).d, qrPicture(ADDRESS).d);
  });
});
