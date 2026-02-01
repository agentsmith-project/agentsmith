/**
 * Project Navigation Component
 *
 * Quick navigation cards for main project features.
 */

import Link from 'next/link';
import { MessageSquare, Wrench, Bot, Server, Users, BarChart3, Settings, ChevronRight } from 'lucide-react';

export interface NavItem {
  /** Icon component */
  icon: React.ComponentType<{ className?: string }>;
  /** Navigation label */
  label: string;
  /** Route path */
  href: string;
  /** Optional description */
  description?: string;
  /** Whether item requires specific permissions */
  requiresPermission?: string;
}

const defaultNavItems: NavItem[] = [
  {
    icon: MessageSquare,
    label: 'Chat',
    href: '/chat',
    description: 'AI chat conversations',
  },
  {
    icon: Wrench,
    label: 'Workbench',
    href: '/workbench',
    description: 'Multi-turn agent threads',
  },
  {
    icon: Bot,
    label: 'Agents',
    href: '/agents',
    description: 'Manage AI agents',
  },
  {
    icon: Server,
    label: 'Endpoints',
    href: '/endpoints',
    description: 'Model endpoints',
  },
  {
    icon: Users,
    label: 'Members',
    href: '/members',
    description: 'Team management',
  },
  {
    icon: BarChart3,
    label: 'Usage',
    href: '/usage',
    description: 'Usage statistics',
  },
  {
    icon: Settings,
    label: 'Settings',
    href: '/settings',
    description: 'Project configuration',
    requiresPermission: 'project:settings:edit',
  },
];

export interface ProjectNavigationProps {
  /** Base path for navigation (workspace/project context) */
  basePath: string;
  /** Custom navigation items (overrides default) */
  items?: NavItem[];
  /** Number of columns in grid layout */
  columns?: 2 | 3 | 4;
}

/**
 * Display navigation cards for quick access to project features
 *
 * @example
 * ```tsx
 * <ProjectNavigation
 *   basePath="/workspaces/ws_default/projects/proj_001"
 *   columns={3}
 * />
 * ```
 */
export function ProjectNavigation({ basePath, items, columns = 3 }: ProjectNavigationProps) {
  const navItems = items || defaultNavItems;

  return (
    <div className={`grid grid-cols-1 ${columns === 2 ? 'md:grid-cols-2' : columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4`}>
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={`${basePath}${item.href}`}
            className="bg-surface border border-border rounded-md p-5 hover:bg-surface-high transition-colors duration-200 group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-sm bg-surface-high flex items-center justify-center group-hover:bg-hover transition-colors">
                  <Icon className="w-5 h-5 text-icon-default group-hover:text-accent" />
                </div>
                <div>
                  <div className="text-foreground font-medium">{item.label}</div>
                  {item.description && (
                    <div className="text-xs text-tertiary mt-0.5">{item.description}</div>
                  )}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-tertiary group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
