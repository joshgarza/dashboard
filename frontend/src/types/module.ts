import type { FC } from 'react';

export interface DashboardModule {
  id: string;
  title: string;
  component: FC;
  refreshInterval?: number;
}
