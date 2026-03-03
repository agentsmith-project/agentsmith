/**
 * Project Navigation Component
 *
 * Quick navigation cards for main project features.
 */

import Link from 'next/link';
import { MessageSquare, Wrench, Bot, Server, Users, BarChart3, Settings, ChevronRight, LucideIcon } from 'lucide-react';

export interface NavItem {
  /** Icon component */
  icon: LucideIcon;
  /** Navigation label */
  label: string;
  /** Route path */
  href: string;
  /** Optional description */
  description?: string;
  /** Whether item requires specific permissions */
  requiresPermission?: string;
}

export interface ProjectNavigationProps {
  /** Base path for navigation (workspace/project context) */
  basePath: string;
  /** Custom navigation items (overrides default) */
  items?: NavItem[];
  /** Number of columns in grid layout */
  columns?: 2 | 3 | 4;
  /** Translation function */
  translations?: (key: string) => string;
  /** User's current permissions - items with requiresPermission not in this list are hidden */
  userPermissions?: string[];
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
export function ProjectNavigation({ basePath, items, columns = 3, translations, userPermissions }: ProjectNavigationProps) {
  const t = translations || ((key: string) => key);

  // Generate nav items with translations if not provided
  const navItems = items || [
    {
      icon: MessageSquare,
      label: t('navigation.chat'),
      href: '/chat',
      description: t('navigation.chat_description'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Wrench,
      label: t('navigation.notebook'),
      href: '/notebook',
      description: t('navigation.notebook_description'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Bot,
      label: t('navigation.agents'),
      href: '/agents',
      description: t('navigation.agents_description'),
      requiresPermission: 'project:agent:use',
    },
    {
      icon: Server,
      label: t('navigation.endpoints'),
      href: '/endpoints',
      description: t('navigation.endpoints_description'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Users,
      label: t('navigation.members'),
      href: '/members',
      description: t('navigation.members_description'),
      requiresPermission: 'project:settings:manage',
    },
    {
      icon: BarChart3,
      label: t('navigation.usage'),
      href: '/usage',
      description: t('navigation.usage_description'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Settings,
      label: t('navigation.settings'),
      href: '/settings',
      description: t('navigation.settings_description'),
      requiresPermission: 'project:settings:manage',
    },
  ];

  // Filter items by permission if userPermissions is provided
  const visibleItems = userPermissions
    ? navItems.filter((item) => {
        if (!item.requiresPermission) return true;
        return userPermissions.includes('*') || userPermissions.includes(item.requiresPermission)
          || userPermissions.some((p) => p.endsWith(':*') && item.requiresPermission!.startsWith(p.slice(0, -1)));
      })
    : navItems;

  return (
    <div className={`grid grid-cols-1 ${columns === 2 ? 'md:grid-cols-2' : columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4`}>
      {visibleItems.map((item) => {
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
