import type { Metadata } from 'next';

import { StatsDashboard } from '../../components/stats/stats-dashboard';
import { JsonLd } from '../../components/seo/json-ld';
import { getStatsSnapshot } from '../../lib/stats/load';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/stats');

export const metadata: Metadata = pageMetadata(page);

/**
 * Render on the request. The live read is cached for five minutes inside
 * getStatsSnapshot. The Worker that is live today answers 404 for /stats
 * and 200 for the force-static pages, so this document is not a prerender
 * the build can omit, and the build does not call the public RPCs.
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
