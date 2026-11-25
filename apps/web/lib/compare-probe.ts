import { timingSafeEqual } from 'node:crypto';

/** The probe route. GET only. Anything else stays on the human gate. */
export function isCompareProbe(pathname: string, method: string): boolean {
  return pathname === '/api/compare/probe' && method === 'GET';
}

/**
 * Bearer match for the probe. Unset token, missing header, or a mismatch
 * are all "not authorized". A different length returns false and does not throw.
 */
export function probeAuthorized(header: string | null, token: string | undefined): boolean {
  if (!token || !header) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
