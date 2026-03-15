'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { ProjectWorkbenchBar, ProjectWorkbenchSwitcher } from '@/components/layout/ProjectWorkbenchBar';
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
  const tNotebook = useTranslations('notebook');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    taskId?: string;
    locale?: string;
  } | null>(null);
  const canAccessNotebook = useHasPermission('project:endpoint:use');

  useEffect(() => {
    params.then((p) => {
      const nextParams = {
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        taskId: validateTaskId(p.taskId),
        locale: p.locale,
      };
      setResolvedParams((previous) =>
        previous &&
        previous.workspace === nextParams.workspace &&
        previous.project === nextParams.project &&
        previous.taskId === nextParams.taskId &&
        previous.locale === nextParams.locale
          ? previous
          : nextParams,
      );
    });
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

  const locale = resolvedParams.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}`;

  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth="full"
      >
        <div className="mb-4">
          <ProjectWorkbenchBar
            title={tNotebook('title')}
            meta={<div className="text-sm text-secondary">{tNotebook('subtitle')}</div>}
            switcher={(
              <ProjectWorkbenchSwitcher
                items={[
                  {
                    href: `${basePath}/notebook`,
                    label: tNotebook('title'),
                    testId: 'notebook-task__open-list',
                    active: true,
                  },
                  {
                    href: `${basePath}/chat`,
                    label: tNotebook('open_chat'),
                    testId: 'notebook-task__open-chat',
                  },
                  {
                    href: `${basePath}/files`,
                    label: tNotebook('open_files'),
                    testId: 'notebook-task__open-files',
                  },
                ]}
              />
            )}
          />
        </div>
        <TaskPage
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          taskId={resolvedParams.taskId}
          canCreateTask={canAccessNotebook}
          canUpdateTask={canAccessNotebook}
          canDeleteTask={canAccessNotebook}
          diagnosticsBasePath={basePath}
        />
      </PageLayout>
    </PageState>
  );
}
