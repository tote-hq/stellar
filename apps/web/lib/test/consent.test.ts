import assert from 'node:assert/strict';
import { test } from 'node:test';

import { consentCookie, CONSENT_MAX_AGE, readConsent, subscribeConsent, writeConsent } from '../consent.ts';

test('readConsent only accepts the two choices', () => {
  assert.equal(readConsent(''), null);
  assert.equal(readConsent(undefined), null);
  assert.equal(readConsent('chg_consent=granted'), 'granted');
  assert.equal(readConsent('chg_lang=en; chg_consent=denied'), 'denied');
  assert.equal(readConsent('chg_consent=maybe'), null);
  assert.equal(readConsent('chg_consent=Granted'), null);
  assert.equal(readConsent('other=granted'), null);
});

test('the cookie is first-party, lax, and lasts 180 days', () => {
  const granted = consentCookie('granted');
  assert.match(granted, /^chg_consent=granted;/);
  assert.match(granted, /Path=\//);
  assert.match(granted, /SameSite=Lax/);
  assert.match(granted, new RegExp(`Max-Age=${CONSENT_MAX_AGE}`));
  assert.equal(CONSENT_MAX_AGE, 60 * 60 * 24 * 180);
  if (process.env.NODE_ENV === 'production') assert.match(granted, /Secure/);
  else assert.equal(granted.includes('Secure'), false);
  assert.match(consentCookie('denied'), /^chg_consent=denied;/);
});

test('a choice notifies subscribers and unsubscribing stops that', () => {
  let seen = 0;
  const stop = subscribeConsent(() => {
    seen += 1;
  });
  writeConsent('denied');
  assert.equal(seen, 1);
  stop();
  writeConsent('granted');
  assert.equal(seen, 1);
});
