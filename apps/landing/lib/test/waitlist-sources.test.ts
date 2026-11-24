import assert from 'node:assert/strict';
import { test } from 'node:test';

import { waitlistWebhookPayload } from '../waitlist/persist.ts';
import { submitWaitlist } from '../waitlist/submit.ts';
import {
  PERSON_SOURCES,
  SOURCE_QUESTION,
  allowedSources,
  canonicalSource,
  sourceLabel,
} from '../waitlist/options.ts';
import { SOURCE_MISSING } from '../waitlist/messages.ts';
import { validateWaitlist, type WaitlistInput } from '../waitlist/validate.ts';

const CREATED_AT = '2026-11-24T20:00:00.000Z';

const EVENT_NAMES = [
  'Nerdearla',
  'AI Founder Marketplace',
  'Astra Commons: Buenos Aires',
  'BrowserStack Meetup Buenos Aires: Master Accessibility & AI in QA',
  'Founders Fit Club — Edición 03',
  'SideQuest - LOVE.exe',
  'Eventos',
];

function input(source: string, extra: Partial<WaitlistInput> = {}): WaitlistInput {
  return {
    name: 'Ana Perez',
    email: 'ana@example.com',
    source,
    otherDetail: '',
    whatsapp: '11 5555 1234',
    whatsappGroup: 'si',
    ...extra,
  };
}

test('source question has Spanish (tú) and English copy', () => {
  assert.equal(SOURCE_QUESTION.es, '¿Dónde te enteraste de nosotros?');
  assert.equal(SOURCE_QUESTION.en, 'How did you hear about us?');
});

test('the list has team referrals and no event options', () => {
  const allowed = allowedSources();
  assert.deepEqual([...PERSON_SOURCES], ['Por Fabio', 'Por Simoneth']);
  assert.equal(allowed.has('Por Fabio'), true);
  assert.equal(allowed.has('Por Simoneth'), true);
  assert.equal(allowed.has('Through Fabio'), true);
  assert.equal(allowed.has('Through Simoneth'), true);
  assert.equal(allowed.has('Instagram'), true);
  assert.equal(allowed.has('Otros'), true);
  for (const name of EVENT_NAMES) {
    assert.equal(allowed.has(name), false, name);
    assert.equal(canonicalSource(name), undefined, name);
  }
});

test('English referral answers store the Spanish value', () => {
  assert.equal(canonicalSource('Through Fabio'), 'Por Fabio');
  assert.equal(canonicalSource('Through Simoneth'), 'Por Simoneth');
  assert.equal(canonicalSource('Other'), 'Otros');
  assert.equal(canonicalSource('Por Fabio'), 'Por Fabio');
  assert.equal(sourceLabel('Por Fabio', 'en'), 'Through Fabio');
  assert.equal(sourceLabel('Por Simoneth', 'en'), 'Through Simoneth');
});

test('validateWaitlist accepts team referrals and rejects former events', () => {
  const fabio = validateWaitlist(input('Por Fabio'), CREATED_AT);
  assert.equal(fabio.ok, true);
  if (fabio.ok) assert.equal(fabio.entry.source, 'Por Fabio');

  const through = validateWaitlist(input('Through Simoneth'), CREATED_AT);
  assert.equal(through.ok, true);
  if (through.ok) assert.equal(through.entry.source, 'Por Simoneth');

  const event = validateWaitlist(input('Nerdearla'), CREATED_AT);
  assert.equal(event.ok, false);
  if (!event.ok) assert.equal(event.errors.source, SOURCE_MISSING);

  const other = validateWaitlist(input('Other', { otherDetail: 'A friend' }), CREATED_AT);
  assert.equal(other.ok, true);
  if (other.ok) {
    assert.equal(other.entry.source, 'Otros');
    assert.equal(other.entry.otherDetail, 'A friend');
  }
});

test('the webhook payload carries the stored Spanish source', () => {
  const checked = validateWaitlist(input('Through Fabio'), CREATED_AT);
  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  const payload = waitlistWebhookPayload(checked.entry, 'test-secret');
  assert.equal(payload.kind, 'waitlist');
  assert.equal(payload.source, 'Por Fabio');
  assert.equal(payload.webhookSecret, 'test-secret');
  assert.equal('Nerdearla' in (payload as object), false);
});

test('submitWaitlist accepts a team referral end to end', async () => {
  const lines: string[] = [];
  const result = await submitWaitlist(
    {
      name: 'Ana Perez',
      email: 'ana@example.com',
      source: 'Through Fabio',
      otherDetail: '',
      whatsapp: '11 5555 1234',
      whatsappGroup: 'si',
      company: '',
      turnstileToken: '',
    },
    {
      ip: '127.0.0.1',
      now: Date.parse(CREATED_AT),
      env: { NODE_ENV: 'test' },
      fetch: async () => {
        throw new Error('fetch should not run in this test');
      },
      appendLine: async (line) => {
        lines.push(line);
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(lines.length, 1);
  const saved = JSON.parse(lines[0] ?? '{}') as { source?: string };
  assert.equal(saved.source, 'Por Fabio');
});
