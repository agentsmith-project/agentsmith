'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { TaskPage } from '@/components/notebook/TaskPage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  const canAccessNotebook = useHasPermission('project:notebook:access');

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        taskId: validateTaskId(p.taskId),
        locale: p.locale,
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

  const locale = resolvedParams.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}`;

  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth="full"
        header={(
          <PageHeader
            title={tNotebook('title')}
            subtitle={tNotebook('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/notebook`}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="notebook-task__open-list"
                >
                  {tNotebook('title')}
                </Link>
                <Link
                  href={`${basePath}/chat`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="notebook-task__open-chat"
                >
                  {tNotebook('open_chat')}
                </Link>
                <Link
                  href={`${basePath}/files`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="notebook-task__open-files"
                >
                  {tNotebook('open_files')}
                </Link>
              </div>
            )}
          />
        )}
      >
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
