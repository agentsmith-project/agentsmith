"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageState } from "@/components/layout/PageState";
import { PageLoading } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { TaskPage } from "@/components/agent-tasks/TaskPage";
import { useCanAccessAgentTasks, useCanUseAgentTaskTerminal } from "@/lib/hooks/use-permissions";
import { useProject } from "@/lib/hooks/use-projects-queries";
import { useResolvedProjectRoute } from "@/lib/hooks/use-resolved-project-route";
import { canAccessProjectSurfaceHref } from "@/lib/projects/project-surface-access";

interface TaskPageParams {
  params: Promise<{
    workspace: string;
    project: string;
    taskId: string;
    locale: string;
  }>;
}

const RECIPE_ID_SCHEMA = /^[a-zA-Z0-9_-]+$/;

function validateTaskId(taskId: string): string | undefined {
  const trimmed = taskId.trim();
  if (!trimmed || !RECIPE_ID_SCHEMA.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

type TaskDetailRecoveryAction = {
  href: string;
  label: string;
  testId: string;
  variant?: 'primary' | 'outline';
};

function pushRecoveryAction(
  actions: TaskDetailRecoveryAction[],
  condition: boolean,
  action: TaskDetailRecoveryAction,
) {
  if (condition) {
    actions.push(action);
  }
}

function TaskDetailRouteState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: TaskDetailRecoveryAction[];
}) {
  return (
    <PageState state="error">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-md border border-subtle bg-surface/95 px-6 py-7 text-center shadow-card">
          <h2 className="mb-2 text-lg font-semibold text-foreground">{title}</h2>
          <p className="mb-5 text-sm text-tertiary">{description}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {actions.map((action) => (
              <Button key={action.testId} asChild variant={action.variant === 'primary' ? 'action' : 'outline'} size="sm">
                <Link href={action.href} data-testid={action.testId}>
                  {action.label}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </PageState>
  );
}

export default function AgentTaskDetailPage({ params }: TaskPageParams) {
  const tErrors = useTranslations("errors");
  const tAgentTasks = useTranslations("agent_tasks");
  const tCommon = useTranslations("common");
  const tProjects = useTranslations("projects");
  const resolvedRoute = useResolvedProjectRoute(params);
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string | null;
    project: string | null;
    taskId?: string;
    locale: string;
  } | null>(null);
  const canAccessAgentTasks = useCanAccessAgentTasks();
  const canUseAgentTaskTerminal = useCanUseAgentTaskTerminal();
  const { data: currentProject } = useProject(resolvedRoute.workspace ?? '', resolvedRoute.project ?? '');

  useEffect(() => {
    if (!resolvedRoute.isReady) {
      return;
    }
    params.then((p) => {
      const nextParams = {
        workspace: resolvedRoute.workspace,
        project: resolvedRoute.project,
        taskId: validateTaskId(p.taskId),
        locale: resolvedRoute.locale,
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
  }, [
    params,
    resolvedRoute.isReady,
    resolvedRoute.locale,
    resolvedRoute.project,
    resolvedRoute.workspace,
  ]);

  if (!resolvedRoute.isReady || !resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  const locale = resolvedParams.locale ?? "en-US";
  const workspacePath = resolvedParams.workspace
    ? `/${locale}/workspaces/${resolvedParams.workspace}`
    : `/${locale}/workspaces`;
  const agentTasksPath = resolvedParams.workspace && resolvedParams.project
    ? `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/agent-tasks`
    : workspacePath;
  const filesPath = resolvedParams.workspace && resolvedParams.project
    ? `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/files`
    : workspacePath;
  const chatPath = resolvedParams.workspace && resolvedParams.project
    ? `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/chat`
    : workspacePath;
  const canOpenAgentTasksSurface = canAccessProjectSurfaceHref(currentProject, 'agent-tasks');
  const canOpenFilesSurface = canAccessProjectSurfaceHref(currentProject, 'files');
  const canOpenChatSurface = canAccessProjectSurfaceHref(currentProject, 'chat');

  if (
    !resolvedRoute.isValid ||
    !resolvedParams.workspace ||
    !resolvedParams.project ||
    !resolvedParams.taskId
  ) {
    const actions: TaskDetailRecoveryAction[] = [];
    pushRecoveryAction(actions, canOpenAgentTasksSurface && canAccessAgentTasks, {
      href: agentTasksPath,
      label: tAgentTasks("task.back_to_agent_tasks"),
      testId: 'agent-task__open-list',
      variant: 'primary',
    });
    pushRecoveryAction(actions, canOpenFilesSurface, {
      href: filesPath,
      label: tCommon("open_files"),
      testId: 'agent-task__open-files',
      variant: actions.length === 0 ? 'primary' : 'outline',
    });
    actions.push({
      href: workspacePath,
      label: tProjects("back_to_workspace"),
      testId: 'agent-task__back-to-workspace',
      variant: actions.length === 0 ? 'primary' : 'outline',
    });

    return (
      <TaskDetailRouteState
        title={tErrors("validation_error")}
        description={tErrors("badRequest.description")}
        actions={actions}
      />
    );
  }

  if (!canAccessAgentTasks) {
    const actions: TaskDetailRecoveryAction[] = [
      { href: workspacePath, label: tProjects("back_to_workspace"), testId: 'agent-task__back-to-workspace', variant: 'primary' },
    ];
    pushRecoveryAction(actions, canOpenFilesSurface, {
      href: filesPath,
      label: tCommon("open_files"),
      testId: 'agent-task__open-files',
      variant: 'outline',
    });
    pushRecoveryAction(actions, canOpenChatSurface, {
      href: chatPath,
      label: tCommon("open_chat"),
      testId: 'agent-task__open-chat',
      variant: 'outline',
    });

    return (
      <TaskDetailRouteState
        title={tErrors("permission_denied_title")}
        description={tErrors("permission_denied_hint")}
        actions={actions}
      />
    );
  }

  const basePath = `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}`;

  return (
    <PageState state="success">
      <PageLayout density="immersive" contentWidth="full">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TaskPage
            workspaceId={resolvedParams.workspace}
            projectId={resolvedParams.project}
            taskId={resolvedParams.taskId}
            canCreateTask={canAccessAgentTasks}
            canUpdateTask={canAccessAgentTasks}
            canDeleteTask={canAccessAgentTasks}
            canUseTerminal={canUseAgentTaskTerminal}
            diagnosticsBasePath={basePath}
          />
        </div>
      </PageLayout>
    </PageState>
  );
}
