/**
 * Project Layout
 *
 * Parent layout for project-scoped routes.
 * The app shell (sidebar/topbar) is provided by the (shell) route group layout.
 * This layout ensures URL state synchronization for all project pages.
 */

'use client';

import { ReactNode } from 'react';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';

export default function ProjectLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Sync currentProject from URL so permission checks work on all project pages
  useSyncAuthFromUrl();

  return <>{children}</>;
}
