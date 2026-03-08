/**
 * Dashboard Components Index
 */

// Existing components
export { KPICard } from './KPICard';
export type { KPICardProps } from './KPICard';

export { ProjectNavigation } from './ProjectNavigation';
export type { ProjectNavigationProps, NavItem } from './ProjectNavigation';

export { ActivityTimeline } from './ActivityTimeline';
export type { ActivityTimelineProps, ActivityItem } from './ActivityTimeline';

// Cost & Limit Dashboard components (Epic C1)
export { CostDashboardPage } from './CostDashboardPage';
export type { CostDashboardPageProps } from './CostDashboardPage';

export { TrendChart } from './TrendChart';
export type { TrendChartProps } from './TrendChart';

export { TopResourcesList } from './TopResourcesList';
export type { TopResourcesListProps, ResourceUsageRank } from './TopResourcesList';

export { TopUsersList } from './TopUsersList';
export type { TopUsersListProps, UserUsageRank } from './TopUsersList';

export { AnomalyAlertsPanel } from './AnomalyAlertsPanel';
export type {
  AnomalyAlertsPanelProps,
  AnomalyAlert,
  AnomalySeverity,
  AnomalyType,
} from './AnomalyAlertsPanel';

export { DashboardKPICards } from './DashboardKPICards';
export type { DashboardKPICardsProps } from './DashboardKPICards';

export { DashboardFilters } from './DashboardFilters';
export type { DashboardFiltersProps } from './DashboardFilters';
