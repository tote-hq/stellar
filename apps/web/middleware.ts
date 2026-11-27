import { NextResponse, type NextRequest } from 'next/server';

import { adminDocumentCsp, decideAdmin } from './lib/admin/gate';
import {
  AI_BOT_UA,
  hasBrowserFetchHints,
  HUMAN_COOKIE,
  readCookie,
  resolveHumanGateMode,
  turnstileSecret,
  verifyHumanToken,
} from './lib/human-gate';

/** APIs carry a session, a balance or a payment. Nothing here is reusable. */
const PRIVATE_NO_STORE = { 'cache-control': 'private, no-store' };

function humansOnly(message: string) {
  return NextResponse.json({ error: 'solo_humanos', message }, { status: 403, headers: PRIVATE_NO_STORE });
}

/** One CSP on the admin document. next.config skips its own CSP for this host. */
function withAdminCsp(res: NextResponse): NextResponse {
  res.headers.set('Content-Security-Policy', adminDocumentCsp());
  return res;
}

export async function middleware(req: NextRequest) {
  const admin = await decideAdmin(req);
  if (admin?.handled) {
    if (admin.rewrite) {
      const url = req.nextUrl.clone();
      url.pathname = admin.rewrite;
      return withAdminCsp(NextResponse.rewrite(url));
    }
    if (admin.status === 200 && admin.body === undefined) return NextResponse.next();
    return withAdminCsp(new NextResponse(admin.body ?? null, { status: admin.status, headers: admin.headers }));
  }

  const path = req.nextUrl.pathname;
  // The probe authenticates with its own bearer and answers 404 without it.
  // The smoke script has no Turnstile cookie and no browser hints.
  // Kept inline so this edge middleware does not import node:crypto.
  if (path === '/api/compare/probe' && req.method === 'GET') {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const ua = req.headers.get('user-agent') ?? '';
  if (AI_BOT_UA.test(ua)) {
    return new NextResponse('Solo humanos.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...PRIVATE_NO_STORE },
    });
  }

  // Conservative non-browser reject on APIs (keep UI fetch working).
  if (path.startsWith('/api/') && path !== '/api/human') {
    if (!hasBrowserFetchHints(req)) {
      return humansOnly('Changuito es solo para personas.');
    }

    // Early cookie check when enforcing (route handlers re-check).
    const mode = await resolveHumanGateMode(process.env);
    if (mode === 'closed') {
      return humansOnly('Changuito es solo para personas. Completá la verificación.');
    }
    if (mode === 'enforce') {
      const secret = turnstileSecret();
      // Prefer the framework parser. Fall back to the header so a quoted or
      // encoded value still counts. Both have to agree with requireHuman.
      const token =
        req.cookies.get(HUMAN_COOKIE)?.value ||
        readCookie(req.headers.get('cookie'), HUMAN_COOKIE);
      const ok = await verifyHumanToken(token, secret);
      if (!ok) {
        return humansOnly('Changuito es solo para personas. Completá la verificación.');
      }
    }
  }

  const res = NextResponse.next();
  if (path.startsWith('/api/')) res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export const config = {
  // Skip static assets / next internals; gate pages + APIs for bots.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)'],
};
