/**
 * Project Layout
 *
 * Layout for all project-scoped pages.
 * Includes the app shell with sidebar and topbar.
 */

'use client';

import { ReactNode } from 'react';
import { AppShellSidebar } from '@/components/app-shell/AppShellSidebar';
import { Topbar } from '@/components/app-shell/Topbar';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ProjectLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background flex flex-col">
        {/* Topbar */}
        <Topbar />

        {/* Main Content */}
        <div className="flex-1 flex">
          {/* Sidebar */}
          <AppShellSidebar currentValue="" onChange={() => {}} />

          {/* Page Content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
