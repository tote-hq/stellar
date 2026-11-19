import { POSTHOG_PROXY_PATH } from './posthog-path.ts';

const INGEST_ORIGIN = 'https://us.i.posthog.com';
const ASSET_ORIGIN = 'https://us-assets.i.posthog.com';

/** `fetch` with the outbound URL and headers the proxy built. Tests pass a stand-in. */
export type PostHogFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Same-origin proxy for PostHog.
 *
 * The browser only talks to this origin (`script-src 'self'`). `/s7k/static`
 * is the recorder bundle; everything else under `/s7k` is ingestion. The
 * shopper's `chg_user` cookie must not leave, and an upstream `set-cookie`
 * must not come back and sit next to it.
 *
 * Returns null for every other path, including `/s7kx`, so the Worker can
 * fall through. Does not import `cloudflare:workers`.
 */
export function proxyPostHog(request: Request, fetchImpl: PostHogFetch = fetch): Promise<Response> | null {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== POSTHOG_PROXY_PATH && !path.startsWith(`${POSTHOG_PROXY_PATH}/`)) return null;

  const suffix = path.slice(POSTHOG_PROXY_PATH.length);
  const asset = suffix === '/static' || suffix.startsWith('/static/');
  const origin = asset ? ASSET_ORIGIN : INGEST_ORIGIN;
  const target = `${origin}${suffix || '/'}${url.search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === 'cookie' || name === 'host' || name === 'content-length' || name === 'connection') return;
    headers[key] = value;
  });
  headers.host = new URL(origin).host;

  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = 'half';
  }

  return fetchImpl(target, init).then((res) => {
    const out = new Headers();
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      out.append(key, value);
    });
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  });
}
