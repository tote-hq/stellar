import { adminSessionSecret } from './secret.ts';
import { readAdminCookie, tokenHash, verifyAdminCookie, type AdminPayload } from './cookie.ts';
import { adminStore } from './store.ts';

const PRIVATE = { 'cache-control': 'private, no-store' };

export function empty401(): Response {
  return new Response(null, { status: 401, headers: PRIVATE });
}

export async function requireAdmin(req: Request): Promise<{ payload: AdminPayload; hash: string } | Response> {
  const payload = await verifyAdminCookie(readAdminCookie(req.headers.get('cookie')), adminSessionSecret());
  if (!payload) return empty401();
  const hash = await tokenHash(payload.jti);
  const row = await adminStore().sessionByHash(hash);
  if (!row) return empty401();
  return { payload, hash };
}

export function isAdmin(value: { payload: AdminPayload; hash: string } | Response): value is {
  payload: AdminPayload;
  hash: string;
} {
  return !(value instanceof Response);
}

export function csrfOk(req: Request, payload: AdminPayload): boolean {
  return req.headers.get('x-csrf-token') === payload.csrf;
}
