import type { Metadata } from 'next';

import { StatsDashboard } from '../../components/stats/stats-dashboard';
import { JsonLd } from '../../components/seo/json-ld';
import { getStatsSnapshot } from '../../lib/stats/load';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/stats');

export const metadata: Metadata = pageMetadata(page);

/**
 * Render on the request. getStatsSnapshot returns a cached snapshot or a
 * live read that always finishes inside its deadline, so this document is
 * not a prerender the build can omit and the build does not call the RPCs.
 * The Worker sets Cache-Control on the way out (s-maxage and
 * stale-while-revalidate) for the HTML. Flight requests are left uncached.
 */
export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const snapshot = await getStatsSnapshot();
  return (
    <>
      <JsonLd data={subpageJsonLd(page)} />
      <StatsDashboard snapshot={snapshot} />
    </>
  );
}
