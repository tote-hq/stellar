import { getStatsSnapshot } from '../../../lib/stats/load';
import { statsCsv, parseMode, parseNetwork, parseRange } from '../../../lib/stats/view';

/** Same reason as the page: the export is a request-time read, not a prerender. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = await getStatsSnapshot();
  const body = statsCsv(
    parseNetwork(url.searchParams.get('network')),
    parseRange(url.searchParams.get('range')),
    parseMode(url.searchParams.get('mode')),
    snapshot,
  );
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="changuito-stats.csv"',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'x-stats-updated-at': snapshot.updatedAt ?? snapshot.asOf,
    },
  });
}
