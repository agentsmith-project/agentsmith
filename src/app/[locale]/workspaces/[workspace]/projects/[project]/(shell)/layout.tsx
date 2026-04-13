/**
 * App Shell Layout
 *
 * Provides app navigation, project context for all app pages.
 * This layout wraps pages in the (shell) route group.
 */

'use client';

import { ReactNode, useMemo } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AppShellSidebar } from '@/components/app-shell/AppShellSidebar';
import { Topbar } from '@/components/app-shell/Topbar';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { PageLoading } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { APIError } from '@/lib/api/errors';

export default function AppShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations('projects');
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const locale = (params?.locale as string) || 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const projectId = validateProjectParam(params?.project);
  const isValidProjectRoute = !!workspaceId && !!projectId;
  const {
    isLoading: isProjectLoading,
    isError: isProjectError,
    error: projectError,
    refetch: refetchProject,
  } = useProject(workspaceId ?? '', projectId ?? '');
  const isProjectNotFound =
    isProjectError && projectError instanceof APIError && projectError.isNotFoundError();

  // Sync currentProject from URL so permission checks work on all project pages
  useSyncAuthFromUrl();

  // Get current page from URL path using usePathname
  // Path format: /locale/workspaces/{workspaceId}/projects/{projectId}/{page}
  const currentPage = useMemo(() => {
    const pathSegments = pathname.split('/');
    // Find 'projects' segment and skip workspace+project IDs to get the page segment
    const projectsIdx = pathSegments.indexOf('projects');
    // page is 2 segments after 'projects': projects / {projectId} / {page}
    if (projectsIdx >= 0 && projectsIdx + 2 < pathSegments.length) {
      return pathSegments[projectsIdx + 2];
    }
    return 'overview';
  }, [pathname]);

  const handleSidebarChange = (pageId: string) => {
    if (!workspaceId || !projectId) return;
    const newPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/${pageId}`;
    router.push(newPath);
  };

  return (
    <ProtectedRoute>
      {isValidProjectRoute && isProjectLoading ? (
        <div data-testid="page-layout" className="h-screen bg-background flex items-center justify-center">
          <PageLoading />
        </div>
      ) : isValidProjectRoute && isProjectNotFound ? (
        <div data-testid="page-layout" className="h-screen bg-background flex items-center justify-center p-6">
          <div data-testid="project-shell__project-not-found" className="w-full max-w-2xl">
            <ErrorState
              title={t('project_unavailable_title')}
              message={t('project_unavailable_description')}
              onRetry={() => {
                void refetchProject();
              }}
              retryLabel={t('retry')}
            />
          </div>
        </div>
      ) : (
      <div data-testid="page-layout" className="h-screen bg-background flex flex-col overflow-hidden">
        {/* Topbar */}
        <Topbar workspaceId={workspaceId} projectId={projectId} />

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
      )}
    </ProtectedRoute>
  );
}
