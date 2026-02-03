/**
 * Project Layout
 *
 * Layout for all project-scoped pages.
 * Includes the app shell with sidebar and topbar.
 */

'use client';

import { ReactNode, useMemo } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { AppShellSidebar } from '@/components/app-shell/AppShellSidebar';
import { Topbar } from '@/components/app-shell/Topbar';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';

export default function ProjectLayout({
  children,
}: {
  children: ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const locale = (params?.locale as string) || 'en-US';
  const workspaceId = params?.workspace as string;
  const projectId = params?.project as string;

  // Sync currentProject from URL so permission checks work on all project pages
  useSyncAuthFromUrl();

  // Get current page from URL path using usePathname (works on both server and client)
  const currentPage = useMemo(() => {
    const pathSegments = pathname.split('/');
    // Path format: /locale/workspaces/workspaceId/projects/projectId/page
    const pageIndex = pathSegments.findIndex(s => s === projectId);
    if (pageIndex >= 0 && pageIndex + 1 < pathSegments.length) {
      return pathSegments[pageIndex + 1];
    }
    return 'overview';
  }, [pathname, projectId]);

  const handleSidebarChange = (pageId: string) => {
    const newPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/${pageId}`;
    router.push(newPath);
  };

  return (
    <ProtectedRoute>
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        {/* Topbar */}
        <Topbar />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <AppShellSidebar currentValue={currentPage} onChange={handleSidebarChange} />

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
