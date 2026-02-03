/**
 * Workspace Shell Layout
 *
 * Provides shared layout structure for workspace pages.
 * The (shell) route group allows layout sharing without affecting URL structure.
 *
 * Note: Projects page includes its own Topbar, so this layout is minimal.
 */

import { ReactNode } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function WorkspaceShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
