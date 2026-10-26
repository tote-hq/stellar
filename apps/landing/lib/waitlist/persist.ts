import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { WaitlistEntry } from './validate.ts';

/**
 * Durable sink for a whitelist signup.
 *
 * Production stores the signup by POSTing `WAITLIST_WEBHOOK_URL`. With that
 * unset, production refuses to pretend the signup was stored. Local dev
 * appends a JSON line under `.data/` so the form can be tried without a
 * destination.
 */

export type SaveResult =
  | { ok: true; sink: 'webhook' | 'file' }
  | { ok: false; reason: 'unconfigured' | 'upstream' };

export type SaveDeps = {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  appendLine?: (line: string) => Promise<void>;
};

export async function saveWaitlistEntry(entry: WaitlistEntry, deps: SaveDeps): Promise<SaveResult> {
  const webhook = webhookTarget(deps.env);

  if (webhook) {
    const notified = await postWebhook(webhook, entry, deps.fetch);
    return notified ? { ok: true, sink: 'webhook' } : { ok: false, reason: 'upstream' };
  }

  if (deps.env.NODE_ENV === 'production') {
    console.error('[waitlist] no sink configured. Set WAITLIST_WEBHOOK_URL.');
    return { ok: false, reason: 'unconfigured' };
  }

  try {
    const write = deps.appendLine ?? defaultAppend;
    await write(`${JSON.stringify(entry)}\n`);
    return { ok: true, sink: 'file' };
  } catch (error) {
    console.error('[waitlist] local file save failed', error instanceof Error ? error.message : 'unknown');
    return { ok: false, reason: 'upstream' };
  }
}

type WebhookAuth = { url: string; secret?: string };

function webhookTarget(env: NodeJS.ProcessEnv): WebhookAuth | undefined {
  const raw = (env.WAITLIST_WEBHOOK_URL || '').trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) {
    const secret = (env.WAITLIST_WEBHOOK_SECRET || '').trim();
    return { url: url.toString(), secret: secret || undefined };
  }
  return undefined;
}

/**
 * JSON `appendWaitlist_` already reads. The script is not in this repo.
 * `kind` keeps the row on the waitlist sheet. `whatsappGroup` is the beta-group
 * answer (sheet column `grupo_whatsapp`). `feedback` is not sent.
 *
 * `webhookSecret` is auth only. Google Apps Script web apps do not reliably
 * copy `Authorization` into `e.headers`, so the same secret rides in the body.
 * The script must read it for auth and must not write it onto the sheet row.
 */
export function waitlistWebhookPayload(entry: WaitlistEntry, secret?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    kind: 'waitlist',
    name: entry.name,
    email: entry.email,
    source: entry.source,
    otherDetail: entry.otherDetail ?? null,
    whatsapp: entry.whatsapp,
    whatsappGroup: entry.whatsappGroup,
    createdAt: entry.createdAt,
  };
  if (entry.userAgent) payload.userAgent = entry.userAgent;
  if (secret) payload.webhookSecret = secret;
  return payload;
}

async function postWebhook(target: WebhookAuth, entry: WaitlistEntry, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Changuito-Waitlist': '1',
    };
    if (target.secret) headers.Authorization = `Bearer ${target.secret}`;
    // fetch follows redirects by default. Apps Script answers 302 and then 200;
    // the body after that redirect is what decides success.
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(waitlistWebhookPayload(entry, target.secret)),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`[waitlist] webhook status ${response.status}`);
      return false;
    }
    const verdict = await webhookBodyVerdict(response);
    if (!verdict.ok) {
      logWebhookRejection(verdict.detail);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[waitlist] webhook failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

function logWebhookRejection(detail: string): void {
  if (detail === 'unauthorized') {
    console.error(
      '[waitlist] webhook unauthorized. Apps Script did not accept the secret. WAITLIST_WEBHOOK_SECRET must match the script, and doPost must read webhookSecret from the JSON body (Authorization is not delivered). Redeploy a new version.',
    );
    return;
  }
  console.error(`[waitlist] webhook upstream rejected the signup (${detail})`);
}

/**
 * HTTP 200 is not enough. Apps Script returns 200 with `{ ok: false }` when
 * the secret is rejected or the sheet write fails. Success is `ok !== false`.
 * A non-JSON body (204, Slack's plain "ok") still counts.
 */
async function webhookBodyVerdict(response: Response): Promise<{ ok: true } | { ok: false; detail: string }> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const body = (await response.text()).replace(/^\uFEFF/, '').trim();
  if (!body) return { ok: true };
  const typedJson = contentType.includes('json');
  const shapedJson = body.startsWith('{') || body.startsWith('[');
  if (!typedJson && !shapedJson) return { ok: true };

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, detail: 'invalid json' };
  }
  const detail = webhookRejectionDetail(payload);
  if (detail) return { ok: false, detail };
  return { ok: true };
}

function webhookRejectionDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as { ok?: unknown; error?: unknown };
  if (record.ok !== false) return undefined;
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  return 'upstream';
}

async function defaultAppend(line: string): Promise<void> {
  const file = join(process.cwd(), '.data', 'waitlist.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, line, 'utf8');
}
