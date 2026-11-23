/**
 * Twenty serial hits against GET /api/compare/probe.
 *
 *   COMPARE_PROBE_TOKEN=… npm run smoke:compare
 *   COMPARE_BASE_URL=http://localhost:3102 COMPARE_PROBE_TOKEN=… npm run smoke:compare
 *
 * The token is required and is never printed. Exits non-zero on any non-200
 * or when the client-side p95 wall time is over COMPARE_P95_MS (default 10s).
 */
const base = (process.env.COMPARE_BASE_URL || 'https://app.changuito.me').replace(/\/$/, '');
const token = process.env.COMPARE_PROBE_TOKEN;
const runs = positiveInt(process.env.COMPARE_RUNS, 20);
const p95Budget = positiveNumber(process.env.COMPARE_P95_MS, 10_000);

if (!token) {
  console.error('COMPARE_PROBE_TOKEN is required');
  process.exit(1);
}

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Nearest rank. For 20 samples, p95 is the 19th wall time. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

const walls = [];
const rates = [];
let failures503 = 0;
let otherNon200 = 0;

for (let i = 1; i <= runs; i += 1) {
  const started = Date.now();
  let status = 0;
  let body = {};
  try {
    const res = await fetch(`${base}/api/compare/probe`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch (err) {
    status = 0;
    body = { message: err instanceof Error ? err.name : 'error' };
  }
  const wall = Date.now() - started;
  walls.push(wall);
  const stats = body.stats ?? {};
  const serverMs = body.ok ? stats.durationMs : body.durationMs;
  const match = body.ok ? `${stats.eanMatches}/${stats.lines} ${stats.matchRate}` : '-';
  console.log(`run ${i} status=${status} wall=${wall}ms server=${serverMs ?? '-'}ms match=${match}`);
  if (body.ok && typeof stats.matchRate === 'number') rates.push(stats.matchRate);
  if (status === 503) failures503 += 1;
  else if (status !== 200) otherNon200 += 1;
}

const sorted = [...walls].sort((a, b) => a - b);
const p50 = percentile(sorted, 50);
const p95 = percentile(sorted, 95);
const max = sorted[sorted.length - 1] ?? 0;
const meanMatchRate = rates.length === 0 ? 0 : rates.reduce((sum, n) => sum + n, 0) / rates.length;
console.log(
  `summary 503=${failures503} other=${otherNon200} p50=${p50} p95=${p95} max=${max} meanMatchRate=${meanMatchRate}`,
);

if (failures503 > 0 || otherNon200 > 0 || p95 > p95Budget) process.exit(1);
