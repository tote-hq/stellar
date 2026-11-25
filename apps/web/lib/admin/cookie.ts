/**
 * HMAC-SHA256 admin cookie. crypto.subtle only: middleware must not import
 * node:crypto. An empty secret returns before importKey.
 */

import { adminSessionSecret } from './secret.ts';

export const ADMIN_COOKIE = 'chg_admin';
export const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();

export interface AdminPayload {
  exp: number;
  csrf: string;
  jti: string;
}

function bytesToB64url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function b64urlToBytes(value: string): Uint8Array | null {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/') + pad;
  try {
    const raw = atob(normalized);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function tokenHash(jti: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(jti));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

export async function signAdminCookie(payload: AdminPayload, secret: string): Promise<string | null> {
  if (!secret.trim()) return null;
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return `${body}.${bytesToB64url(sig)}`;
}

/** Bad signature, expired exp, or an empty secret. Does not import a key when the secret is blank. */
export async function verifyAdminCookie(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<AdminPayload | null> {
  if (!secret.trim() || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = b64urlToBytes(token.slice(dot + 1));
  if (!sig) return null;
  const key = await hmacKey(secret);
  const sigBuf = new ArrayBuffer(sig.byteLength);
  new Uint8Array(sigBuf).set(sig);
  const ok = await crypto.subtle.verify('HMAC', key, sigBuf, enc.encode(body));
  if (!ok) return null;
  const raw = b64urlToBytes(body);
  if (!raw) return null;
  let parsed: Partial<AdminPayload>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<AdminPayload>;
  } catch {
    return null;
  }
  if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null;
  if (typeof parsed.csrf !== 'string' || !parsed.csrf) return null;
  if (typeof parsed.jti !== 'string' || !parsed.jti) return null;
  return { exp: parsed.exp, csrf: parsed.csrf, jti: parsed.jti };
}

export function readAdminCookie(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ADMIN_COOKIE) return rest.join('=');
  }
  return undefined;
}

/** Host-only. No Domain attribute. SameSite=Strict does not isolate sibling hosts. */
export function adminSetCookie(token: string): string {
  const maxAge = Math.floor(ADMIN_TTL_MS / 1000);
  return `${ADMIN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function adminClearCookie(): string {
  return `${ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function issueAdminCookie(env: NodeJS.ProcessEnv = process.env): Promise<{
  token: string;
  payload: AdminPayload;
  hash: string;
} | null> {
  const secret = adminSessionSecret(env);
  if (!secret) return null;
  const payload: AdminPayload = {
    exp: Date.now() + ADMIN_TTL_MS,
    csrf: randomToken(),
    jti: randomToken(),
  };
  const token = await signAdminCookie(payload, secret);
  if (!token) return null;
  return { token, payload, hash: await tokenHash(payload.jti) };
}
