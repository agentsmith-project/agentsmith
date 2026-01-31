/**
 * Activity Timeline Component
 *
 * Displays recent activity events in a vertical timeline.
 */

import { LucideIcon } from 'lucide-react';

export interface ActivityItem {
  /** Unique identifier */
  id: string;
  /** Icon component for the activity */
  icon: LucideIcon;
  /** Activity title */
  title: string;
  /** Optional description */
  description?: string;
  /** Relative timestamp (e.g., "2 hours ago") */
  timestamp: string;
  /** Optional ID that can be copied */
  copyableId?: string;
  /** Click handler */
  onClick?: () => void;
}

export interface ActivityTimelineProps {
  /** Array of activity items */
  items: ActivityItem[];
  /** Maximum items to display */
  maxItems?: number;
  /** Link to view all activities */
  viewAllLink?: string;
}

/**
 * Display recent activity in a vertical timeline
 *
 * @example
 * ```tsx
 * <ActivityTimeline
 *   items={activities}
 *   maxItems={5}
 *   viewAllLink="/audit"
 * />
 * ```
 */
export function ActivityTimeline({ items, maxItems = 5, viewAllLink }: ActivityTimelineProps) {
  const displayItems = items.slice(0, maxItems);

  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      // Could show a toast here
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="bg-panel border border-subtle rounded-xl">
      {/* Header */}
      <div className="px-6 py-4 border-b border-subtle">
        <h3 className="text-lg font-semibold text-primary">Recent Activity</h3>
      </div>

      {/* Timeline Items */}
      <div className="divide-y divide-subtle">
        {displayItems.length === 0 ? (
          <div className="px-6 py-8 text-center text-tertiary">
            No recent activity
          </div>
        ) : (
          displayItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className={`px-6 py-4 flex items-start gap-4 ${item.onClick ? 'cursor-pointer hover:bg-hover transition-colors' : ''}`}
                onClick={item.onClick}
              >
                {/* Icon */}
                <div className="w-8 h-8 rounded-full bg-hover flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-secondary" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-primary font-medium">{item.title}</div>
                  {item.description && (
                    <div className="text-xs text-tertiary mt-0.5">{item.description}</div>
                  )}
                  {item.copyableId && (
                    <button
                      onClick={(e) => handleCopy(item.copyableId!, e)}
                      className="text-xs text-accent hover:underline mt-1"
                      title="Click to copy ID"
                    >
                      {item.copyableId}
                    </button>
                  )}
                </div>

                {/* Timestamp */}
                <div className="text-xs text-tertiary whitespace-nowrap">{item.timestamp}</div>
              </div>
            );
          })
        )}
      </div>

      {/* View All Link */}
      {viewAllLink && items.length > maxItems && (
        <div className="px-6 py-3 border-t border-subtle">
          <a
            href={viewAllLink}
            className="text-sm text-accent hover:underline"
          >
            View all activity →
          </a>
        </div>
      )}
    </div>
  );
}
