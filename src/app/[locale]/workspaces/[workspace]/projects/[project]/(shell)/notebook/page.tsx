/**
 * Notebook Page
 *
 * Task list view - displays all Tasks and allows navigation to individual Task details.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { TaskList } from '@/components/notebook/TaskList';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { buttonVariants } from '@/components/ui/button';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { cn } from '@/lib/utils';

interface NotebookPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function NotebookPage({ params }: NotebookPageProps) {
  const t = useTranslations('notebook');
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    locale?: string;
  } | null>(null);
  const canAccessNotebook = useHasPermission('project:endpoint:use');
  const { layoutMode } = useProjectLayoutMode();

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
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

  const locale = resolvedParams.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}`;

  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/chat`}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="notebook__open-chat"
                >
                  {t('open_chat')}
                </Link>
                <Link
                  href={`${basePath}/files`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="notebook__open-files"
                >
                  {t('open_files')}
                </Link>
                <Link
                  href={`${basePath}/agents`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="notebook__open-agents"
                >
                  {t('open_agents')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <TaskList
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          canCreateTask={canAccessNotebook}
        />
      </PageLayout>
    </PageState>
  );
}
