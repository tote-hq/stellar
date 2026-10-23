import type { Metadata } from 'next';

import { StatsDashboard } from '../../components/stats/stats-dashboard';
import { STATS_DESCRIPTION, STATS_TITLE } from '../../lib/stats/metrics';

export const metadata: Metadata = {
  title: STATS_TITLE,
  description: STATS_DESCRIPTION,
  alternates: { canonical: 'https://www.changuito.me/stats' },
};

export default function StatsPage() {
  return <StatsDashboard />;
}
