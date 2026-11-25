import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigError, bool, describeConfig, loadConfig, requirePassphrase } from '../config.js';

const MIN = { SECRETS_DIR: '/tmp/secrets-test' };

describe('bool', () => {
  it('refuses a value it cannot interpret rather than guessing', () => {
    // "maybe" silently meaning false is how a live-spending guard gets bypassed.
    assert.throws(() => bool({ X: 'maybe' }, 'X', false), ConfigError);
  });
});

describe('loadConfig', () => {
  it('defaults to Día and derives its host', () => {
    const c = loadConfig(MIN);
    assert.equal(c.retailer, 'dia');
    assert.equal(c.host, 'diaonline.supermercadosdia.com.ar');
  });

  it('rejects a retailer it has no host for', () => {
    assert.throws(() => loadConfig({ ...MIN, RETAILER: 'coto' }), /Unknown retailer/);
  });

  it('only accepts an FX override inside the sane-rate window', () => {
    assert.equal(loadConfig({ ...MIN, ARS_PER_USD: '1450' }).fx.override, 1450);
    assert.throws(() => loadConfig({ ...MIN, ARS_PER_USD: '1.5' }), /ARS_PER_USD/);
  });
});

describe('describeConfig', () => {
  it('names the retailer and never a secret', () => {
    const text = describeConfig(loadConfig({ ...MIN, TYPESAFE_API_KEY: 'ts_secret_value' }));
    assert.ok(!text.includes('ts_secret_value'), text);
    assert.match(text, /retailer:\s+dia/);
  });
});

describe('requirePassphrase', () => {
  it('returns the passphrase when it is long enough', () => {
    assert.equal(requirePassphrase('SESSION_PASSPHRASE', { SESSION_PASSPHRASE: 'longenough' }), 'longenough');
  });

  it('refuses a short one, naming what it protects', () => {
    assert.throws(
      () => requirePassphrase('SESSION_PASSPHRASE', { SESSION_PASSPHRASE: 'abc' }),
      /supermarket session/,
    );
    assert.throws(() => requirePassphrase('SESSION_PASSPHRASE', {}), /SESSION_PASSPHRASE/);
  });
});
