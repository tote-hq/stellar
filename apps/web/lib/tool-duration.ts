/**
 * How long a tool-trail row says a call took.
 *
 * The row only has room for tenths of a second. Under a tenth,
 * `(ms / 1000).toFixed(1)` rounds to "0.0s", which reads as a call that never
 * finished. Say it was shorter than that instead.
 */
export function formatTrailMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 100) return '<0.1s';
  return `${(ms / 1000).toFixed(1)}s`;
}
