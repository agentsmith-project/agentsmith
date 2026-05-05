/**
 * Agent Tasks Page
 *
 * Task list view - displays all Tasks and allows navigation to individual Task details.
 */

'use client';

import { useTranslations } from 'next-intl';
import { TaskList } from '@/components/agent-tasks/TaskList';
import { PageLayout } from '@/components/layout/PageLayout';
import { ProjectWorkbenchBar } from '@/components/layout/ProjectWorkbenchBar';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useCanAccessAgentTasks } from '@/lib/hooks/use-permissions';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';

interface AgentTasksPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AgentTasksPage({ params }: AgentTasksPageProps) {
  const t = useTranslations('agent_tasks');
  const tErrors = useTranslations('errors');
  const resolvedParams = useResolvedProjectRoute(params);
  const canAccessAgentTasks = useCanAccessAgentTasks();
  const { layoutMode } = useProjectLayoutMode();

  if (!resolvedParams.isReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.isValid || !resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canAccessAgentTasks) {
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
      <PageLayout
        density="immersive"
        contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
      >
        <div className="space-y-4">
          <ProjectWorkbenchBar
            title={t('title')}
            variant="utility"
            meta={<div className="text-sm text-secondary">{t('subtitle')}</div>}
          />

          <TaskList
            workspaceId={resolvedParams.workspace}
            projectId={resolvedParams.project}
            canCreateTask={canAccessAgentTasks}
          />
        </div>
      </PageLayout>
    </PageState>
  );
}
