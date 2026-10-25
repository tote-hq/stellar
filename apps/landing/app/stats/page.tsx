import type { Metadata } from 'next';

import { StatsDashboard } from '../../components/stats/stats-dashboard';
import { JsonLd } from '../../components/seo/json-ld';
import { getStatsSnapshot } from '../../lib/stats/load';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/stats');

export const metadata: Metadata = pageMetadata(page);

/** Regenerated in the background at most every 5 minutes. */
export const revalidate = 300;

export default async function StatsPage() {
  const snapshot = await getStatsSnapshot();
  return (
    <>
      <JsonLd data={subpageJsonLd(page)} />
      <StatsDashboard snapshot={snapshot} />
    </>
  );
}
