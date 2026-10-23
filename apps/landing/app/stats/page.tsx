import type { Metadata } from 'next';

import { StatsDashboard } from '../../components/stats/stats-dashboard';
import { JsonLd } from '../../components/seo/json-ld';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/stats');

export const metadata: Metadata = pageMetadata(page);

export default function StatsPage() {
  return (
    <>
      <JsonLd data={subpageJsonLd(page)} />
      <StatsDashboard />
    </>
  );
}
