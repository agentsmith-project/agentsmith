/**
 * KPI Card Component
 *
 * Displays a key performance indicator with icon, value, and trend.
 * Used in Overview dashboard.
 */

import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

export interface KPICardProps {
  /** Icon component to display */
  icon: LucideIcon;
  /** Label for the KPI */
  label: string;
  /** Primary value to display */
  value: string | number;
  /** Optional trend indicator */
  trend?: {
    /** Trend value (e.g., "+12%", "-5%") */
    value: string;
    /** Whether trend is positive (good) or negative (bad) */
    direction: 'up' | 'down';
  };
  /** Optional click handler */
  onClick?: () => void;
  /** Label for "vs last period" text */
  vsLastPeriodLabel?: string;
}

/**
 * Display a KPI card with icon, value, and optional trend
 *
 * @example
 * ```tsx
 * <KPICard
 *   icon={Activity}
 *   label="Total Turns"
 *   value="1,234"
 *   trend={{ value: "+12%", direction: "up" }}
 * />
 * ```
 */
export function KPICard({ icon: Icon, label, value, trend, onClick, vsLastPeriodLabel }: KPICardProps) {
  return (
    <div
      className={`bg-panel border border-subtle rounded-xl p-6 ${onClick ? 'cursor-pointer hover:bg-hover transition-colors' : ''}`}
      onClick={onClick}
    >
      {/* Header: Icon + Label */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-hover flex items-center justify-center">
          <Icon className="w-5 h-5 text-tertiary" />
        </div>
        <span className="text-sm text-secondary font-medium">{label}</span>
      </div>

      {/* Value */}
      <div className="text-3xl font-semibold text-primary mb-2">{value}</div>

      {/* Trend */}
      {trend && (
        <div className="flex items-center gap-1.5 text-sm">
          {trend.direction === 'up' ? (
            <TrendingUp className="w-4 h-4 text-success" />
          ) : (
            <TrendingDown className="w-4 h-4 text-error" />
          )}
          <span className={trend.direction === 'up' ? 'text-success' : 'text-error'}>
            {trend.value}
          </span>
          <span className="text-tertiary">{vsLastPeriodLabel || 'vs last period'}</span>
        </div>
      )}
    </div>
  );
}
