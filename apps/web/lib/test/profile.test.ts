import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isComplete, mergeProfile, ProfileInputError, publicProfile } from '../profile.ts';

const SAVED = { email: 'ana@b.com', password: 'secret', dni: '30123456', postcode: '1425' };

describe('the profile', () => {
  it('never shows the password to a browser', () => {
    const pub = publicProfile(SAVED);
    assert.equal(JSON.stringify(pub).includes('secret'), false);
    assert.deepEqual(pub, { email: 'ana@b.com', dni: '30123456', postcode: '1425', hasPassword: true, complete: true });
    assert.equal(mergeProfile(SAVED, { email: 'ana@b.com', password: '' }).password, 'secret');
    assert.equal(mergeProfile(SAVED, { password: 'new one' }).password, 'new one');
    assert.equal(isComplete({ email: 'a@b.com', dni: '30123456' }), false);
    assert.equal(isComplete(SAVED), true);
  });

  it('normalises the DNI and the postcode', () => {
    const p = mergeProfile(undefined, { dni: '30.123.456', postcode: 'c1425abc' });
    assert.equal(p.dni, '30123456');
    assert.equal(p.postcode, 'C1425ABC');
  });

  it('refuses what the sandbox could not use', () => {
    assert.throws(() => mergeProfile(undefined, { email: 'nope' }), ProfileInputError);
    assert.throws(() => mergeProfile(undefined, { dni: '12' }), ProfileInputError);
    assert.throws(() => mergeProfile(undefined, { postcode: '1' }), ProfileInputError);
  });
});
