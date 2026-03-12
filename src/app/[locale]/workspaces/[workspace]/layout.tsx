/**
 * Workspace Layout
 *
 * Wraps workspace-scoped pages (projects list, workspace settings) with ProtectedRoute.
 * Ensures unauthenticated users are redirected to login.
 */

'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (/^\/(en-US|zh-CN)\/workspaces\/[^/]+\/login(?:\/callback)?\/?$/.test(pathname)) {
    return <>{children}</>;
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
}
