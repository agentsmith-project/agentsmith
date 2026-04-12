"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/layout/PageLayout";
import { ProjectWorkbenchBar } from "@/components/layout/ProjectWorkbenchBar";
import { PageState } from "@/components/layout/PageState";
import { PageLoading } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { TaskPage } from "@/components/notebook/TaskPage";
import { useCanAccessNotebook, useCanUseNotebookTerminal } from "@/lib/hooks/use-permissions";
import { useResolvedProjectRoute } from "@/lib/hooks/use-resolved-project-route";

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

function TaskDetailRouteState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: Array<{ href: string; label: string; testId: string; variant?: 'primary' | 'outline' }>;
}) {
  return (
    <PageState state="error">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-[24px] border border-subtle bg-surface/95 px-6 py-7 text-center shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
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

export default function TaskDetailPage({ params }: TaskPageParams) {
  const tErrors = useTranslations("errors");
  const tNotebook = useTranslations("notebook");
  const tCommon = useTranslations("common");
  const tProjects = useTranslations("projects");
  const resolvedRoute = useResolvedProjectRoute(params);
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string | null;
    project: string | null;
    taskId?: string;
    locale: string;
  } | null>(null);
  const canAccessNotebook = useCanAccessNotebook();
  const canUseNotebookTerminal = useCanUseNotebookTerminal();

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
  const notebookPath = resolvedParams.workspace && resolvedParams.project
    ? `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/notebook`
    : workspacePath;
  const filesPath = resolvedParams.workspace && resolvedParams.project
    ? `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/files`
    : workspacePath;
  const chatPath = resolvedParams.workspace && resolvedParams.project
    ? `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/chat`
    : workspacePath;

  if (
    !resolvedRoute.isValid ||
    !resolvedParams.workspace ||
    !resolvedParams.project ||
    !resolvedParams.taskId
  ) {
    return (
      <TaskDetailRouteState
        title={tErrors("validation_error")}
        description={tErrors("badRequest.description")}
        actions={[
          { href: notebookPath, label: tNotebook("task.back_to_notebook"), testId: 'notebook-task__open-list', variant: 'primary' },
          { href: filesPath, label: tCommon("open_files"), testId: 'notebook-task__open-files', variant: 'outline' },
          { href: workspacePath, label: tProjects("back_to_workspace"), testId: 'notebook-task__back-to-workspace', variant: 'outline' },
        ]}
      />
    );
  }

  if (!canAccessNotebook) {
    return (
      <TaskDetailRouteState
        title={tErrors("permission_denied_title")}
        description={tErrors("permission_denied_hint")}
        actions={[
          { href: workspacePath, label: tProjects("back_to_workspace"), testId: 'notebook-task__back-to-workspace', variant: 'primary' },
          { href: filesPath, label: tCommon("open_files"), testId: 'notebook-task__open-files', variant: 'outline' },
          { href: chatPath, label: tCommon("open_chat"), testId: 'notebook-task__open-chat', variant: 'outline' },
        ]}
      />
    );
  }

  const basePath = `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}`;

  return (
    <PageState state="success">
      <PageLayout density="immersive" contentWidth="full">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-4 shrink-0">
            <ProjectWorkbenchBar
              title={tNotebook("title")}
              meta={
                <div className="text-sm text-secondary">
                  {tNotebook("subtitle")}
                </div>
              }
            />
          </div>
          <TaskPage
            workspaceId={resolvedParams.workspace}
            projectId={resolvedParams.project}
            taskId={resolvedParams.taskId}
            canCreateTask={canAccessNotebook}
            canUpdateTask={canAccessNotebook}
            canDeleteTask={canAccessNotebook}
            canUseTerminal={canUseNotebookTerminal}
            diagnosticsBasePath={basePath}
          />
        </div>
      </PageLayout>
    </PageState>
  );
}
