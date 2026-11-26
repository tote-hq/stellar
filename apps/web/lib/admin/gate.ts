/**
 * Hostname is the switch. Middleware calls this before the probe and the
 * human gate, and does not query Postgres from here.
 */

import { adminSessionSecret } from './secret.ts';
import { readAdminCookie, verifyAdminCookie, type AdminPayload } from './cookie.ts';
import { LOGIN_HEADERS, loginDocument } from './login-html.ts';

export type AdminKind = 'admin' | 'blocked-local' | 'shopper';

export function adminHostKind(hostname: string, nodeEnv: string | undefined): AdminKind {
  const host = hostname.split(':')[0]?.toLowerCase() ?? '';
  if (host === 'admin.localhost' && nodeEnv === 'production') return 'blocked-local';
  if (host === 'admin.changuito.me') return 'admin';
  if (host === 'admin.localhost' && nodeEnv !== 'production') return 'admin';
  return 'shopper';
}

function asset(path: string): boolean {
  return (
    path.startsWith('/_next/static') ||
    path.startsWith('/_next/image') ||
    path === '/favicon.ico' ||
    path === '/icon.png' ||
    path === '/apple-icon.png' ||
    path.startsWith('/brand/') ||
    path === '/s7k' ||
    path.startsWith('/s7k/')
  );
}

export interface AdminDecision {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  rewrite?: string;
  /** Skip the rest of middleware, including the human gate. */
  handled: boolean;
}

const EMPTY: AdminDecision = {
  status: 401,
  body: '',
  headers: { 'cache-control': 'private, no-store' },
  handled: true,
};

function login(failed: boolean): AdminDecision {
  return { status: 401, body: loginDocument(failed), headers: LOGIN_HEADERS, handled: true };
}

export async function decideAdmin(req: {
  url: string;
  method: string;
  headers: { get(name: string): string | null };
  nodeEnv?: string;
}): Promise<AdminDecision | null> {
  const url = new URL(req.url);
  const kind = adminHostKind(url.hostname, req.nodeEnv ?? process.env.NODE_ENV);
  const path = url.pathname;
  if (kind === 'blocked-local') {
    return { status: 404, body: '', headers: { 'cache-control': 'private, no-store' }, handled: true };
  }
  if (kind === 'shopper') {
    if (path.startsWith('/api/admin') || path === '/admin-portal' || path.startsWith('/admin-portal/')) {
      return { status: 404, body: '', headers: { 'cache-control': 'private, no-store' }, handled: true };
    }
    return null;
  }

  if (asset(path)) return null;

  if (path === '/admin-portal' || path.startsWith('/admin-portal/')) {
    return { status: 404, body: '', headers: { 'cache-control': 'private, no-store' }, handled: true };
  }

  const secret = adminSessionSecret();
  const cookie = readAdminCookie(req.headers.get('cookie'));
  const session: AdminPayload | null = await verifyAdminCookie(cookie, secret);

  if (path === '/api/admin/login' && req.method === 'POST') {
    return { status: 200, handled: true };
  }
  if (path.startsWith('/api/admin')) {
    if (!session) return EMPTY;
    return { status: 200, handled: true };
  }

  // `/orders` and `/orders/` are the desk: a note without an order id used to
  // link there, and an empty 404 is what Chrome showed the operator.
  const order = path.match(/^\/orders\/([^/]+)$/);
  const desk = path === '/' || path === '/orders' || path === '/orders/';
  const document = (req.method === 'GET' || req.method === 'HEAD') && (desk || order);
  if (document) {
    if (!session) return login(url.searchParams.get('login') === 'failed');
    const rewrite = desk ? '/admin-portal' : `/admin-portal/orders/${order?.[1]}`;
    return { status: 200, rewrite, handled: true };
  }

  return { status: 404, body: '', headers: { 'cache-control': 'private, no-store' }, handled: true };
}
