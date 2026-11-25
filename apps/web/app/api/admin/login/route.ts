import { adminSetCookie, issueAdminCookie } from '../../../../lib/admin/cookie.ts';
import { LOGIN_COPY } from '../../../../lib/admin/login-html.ts';
import { DUMMY_PASSWORD_HASH, passwordMatches } from '../../../../lib/admin/password.ts';
import { adminSessionSecret } from '../../../../lib/admin/secret.ts';
import { adminStore } from '../../../../lib/admin/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const PRIVATE = { 'cache-control': 'private, no-store' };

export async function POST(req: Request): Promise<Response> {
  if (!adminSessionSecret()) {
    return Response.json({ error: LOGIN_COPY }, { status: 401, headers: PRIVATE });
  }
  const ip = req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
  let username = '';
  let password = '';
  try {
    const body = (await req.json()) as { username?: unknown; password?: unknown };
    username = typeof body.username === 'string' ? body.username.trim() : '';
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    username = '';
    password = '';
  }
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  let count = 0;
  try {
    count = await adminStore().failureCount(ip, since);
  } catch (err) {
    console.error('[admin/login]', err instanceof Error ? err.name : 'query');
    return Response.json({ error: 'No pudimos entrar.' }, { status: 503, headers: PRIVATE });
  }
  if (count >= MAX_FAILURES) {
    return Response.json({ error: LOGIN_COPY }, { status: 401, headers: PRIVATE });
  }
  let user: { id: string; passwordHash: string } | null = null;
  try {
    user = username ? await adminStore().userByName(username) : null;
  } catch (err) {
    console.error('[admin/login]', err instanceof Error ? err.name : 'query');
    return Response.json({ error: 'No pudimos entrar.' }, { status: 503, headers: PRIVATE });
  }
  const check = await passwordMatches(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !check.ok) {
    // The failure row already proves the other 401s did not run. Name only.
    let branch = 'verify_false';
    if (!user) branch = 'user_missing';
    else if (!check.ok && check.reason === 'threw') branch = `verify_threw:${check.errorName}`;
    console.error('[admin/login] 401', branch);
    try {
      await adminStore().recordFailure(ip);
    } catch (err) {
      console.error('[admin/login]', err instanceof Error ? err.name : 'insert');
    }
    return Response.json({ error: LOGIN_COPY }, { status: 401, headers: PRIVATE });
  }
  const issued = await issueAdminCookie();
  if (!issued) return Response.json({ error: LOGIN_COPY }, { status: 401, headers: PRIVATE });
  try {
    await adminStore().saveSession(user.id, issued.hash, new Date(issued.payload.exp).toISOString());
  } catch (err) {
    console.error('[admin/login]', err instanceof Error ? err.name : 'insert');
    return Response.json({ error: 'No pudimos entrar.' }, { status: 503, headers: PRIVATE });
  }
  return Response.json(
    { csrf: issued.payload.csrf },
    { headers: { ...PRIVATE, 'set-cookie': adminSetCookie(issued.token) } },
  );
}
