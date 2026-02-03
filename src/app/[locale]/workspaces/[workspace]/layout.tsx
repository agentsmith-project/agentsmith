/**
 * Workspace Layout
 *
 * Wraps workspace-scoped pages (projects list, workspace settings) with ProtectedRoute.
 * Ensures unauthenticated users are redirected to login.
 */

'use client';

import { ReactNode } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
