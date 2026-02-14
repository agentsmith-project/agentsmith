/**
 * Notebook Page
 *
 * Task list view - displays all Tasks and allows navigation to individual Task details.
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TaskList } from '@/components/notebook/TaskList';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface NotebookPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function NotebookPage({ params }: NotebookPageProps) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
  } | null>(null);
  const canAccessNotebook = useHasPermission('project:notebook:access');
  const { layoutMode } = useProjectLayoutMode();

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
      }),
    );
  }, [params]);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canAccessNotebook) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout density="immersive" contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}>
        <TaskList
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          canCreateTask={canAccessNotebook}
        />
      </PageLayout>
    </PageState>
  );
}
