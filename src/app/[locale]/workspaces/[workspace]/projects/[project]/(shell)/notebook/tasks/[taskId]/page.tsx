'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { TaskPage } from '@/components/notebook/TaskPage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface TaskPageParams {
  params: Promise<{ workspace: string; project: string; taskId: string; locale: string }>;
}

const RECIPE_ID_SCHEMA = /^[a-zA-Z0-9_-]+$/;

function validateTaskId(taskId: string): string | undefined {
  const trimmed = taskId.trim();
  if (!trimmed || !RECIPE_ID_SCHEMA.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export default function TaskDetailPage({ params }: TaskPageParams) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    taskId?: string;
  } | null>(null);
  const canAccessNotebook = useHasPermission('project:notebook:access');

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        taskId: validateTaskId(p.taskId),
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

  if (!resolvedParams.workspace || !resolvedParams.project || !resolvedParams.taskId) {
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
      <PageLayout density="immersive" contentWidth="full">
        <TaskPage
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          taskId={resolvedParams.taskId}
          canCreateTask={canAccessNotebook}
          canUpdateTask={canAccessNotebook}
          canDeleteTask={canAccessNotebook}
        />
      </PageLayout>
    </PageState>
  );
}
