import { statsCsv, parseMode, parseNetwork, parseRange } from '../../../lib/stats/view';

export function GET(request: Request) {
  const url = new URL(request.url);
  const body = statsCsv(
    parseNetwork(url.searchParams.get('network')),
    parseRange(url.searchParams.get('range')),
    parseMode(url.searchParams.get('mode')),
  );
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="changuito-stats.csv"',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
