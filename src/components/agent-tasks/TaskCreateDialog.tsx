'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { TaskAPI, getApiClient } from '@/lib/api';
import { APIError, resolveApiErrorPresentation } from '@/lib/api/errors';
import { useCreateTask } from '@/lib/hooks/use-task';
import { useFileLibraries } from '@/lib/hooks/use-files';
import { useTaskFileTemplates } from '@/lib/hooks/use-task-file-templates';
import { queryKeys } from '@/lib/query-keys';
import { useAgentTaskModelSetting } from '@/lib/agent-task-model-setting';
import type { FileLibrary } from '@/lib/api/types';
import type { CreateTaskRequest, TaskRunnerBindingOption } from '@/lib/types/task';
import { ImportantNotice } from '@/components/agent-tasks/task-create-dialog/ImportantNotice';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
export interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: (taskId: string) => void;
}

export function deriveDefaultTaskWorkspaceName(title: string) {
  const normalizedTitle = title.trim().replace(/\s+/g, ' ');
  if (!normalizedTitle) {
    return '';
  }
  if (/\bworkspace$/i.test(normalizedTitle)) {
    return normalizedTitle;
  }
  return `${normalizedTitle} workspace`;
}

function isTaskRunnerBindingOptionSelectable(option: TaskRunnerBindingOption) {
  return option.actions.bind_to_task.allowed && !option.disabled_reason_code;
}

function isFileLibraryTaskHomeBound(library: FileLibrary) {
  return library.task_home_binding_status === 'bound';
}

function isFileLibrarySelectableForTask(library: FileLibrary) {
  return library.status === 'ready' && !isFileLibraryTaskHomeBound(library);
}

type TaskWorkspaceMode = 'create_new' | 'use_existing' | 'use_template';

const TASK_CREATE_FILE_LIBRARY_TYPED_ERROR_CODES = new Set([
  'AGENT_TASK_FILE_LIBRARY_IN_USE',
  'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
  'FILE_LIBRARY_DELETING',
  'FILE_LIBRARY_NOT_READY',
  'FILE_LIBRARY_NOT_FOUND',
  'FILE_LIBRARY_FORBIDDEN',
]);

function isTaskCreateFileLibraryTypedError(error: unknown): error is APIError {
  return error instanceof APIError && TASK_CREATE_FILE_LIBRARY_TYPED_ERROR_CODES.has(error.errorCode);
}

const DEVELOPER_RUNNER_REASON_KEY_BY_CODE: Record<string, string> = {
  agent_runner_stale: 'developer_runner_reason_stale',
  agent_runner_disconnected: 'developer_runner_reason_unavailable',
  agent_runner_unavailable: 'developer_runner_reason_unavailable',
  agent_runner_runtime_unavailable: 'developer_runner_reason_unavailable',
  agent_runner_model_unconfigured: 'developer_runner_reason_unavailable',
  agent_runner_default_conflict: 'developer_runner_reason_unavailable',
  agent_runner_forbidden: 'developer_runner_reason_forbidden',
  permission_denied: 'developer_runner_reason_forbidden',
  invalid_binding_target: 'developer_runner_reason_capability',
  agent_runner_capability_mismatch: 'developer_runner_reason_capability',
  TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER: 'developer_runner_reason_task_home_binding_unavailable',
};

function getDeveloperRunnerReasonKey(option: TaskRunnerBindingOption): string {
  const reasonCode = option.disabled_reason_code
    ?? option.actions.bind_to_task.reason_code
    ?? option.readiness.reason_code
    ?? option.freshness?.reason_code
    ?? option.capability.reason_code;

  if (reasonCode && DEVELOPER_RUNNER_REASON_KEY_BY_CODE[reasonCode]) {
    return DEVELOPER_RUNNER_REASON_KEY_BY_CODE[reasonCode];
  }
  if (!option.actions.bind_to_task.allowed) {
    return 'developer_runner_reason_forbidden';
  }
  if (option.freshness?.state === 'stale' || option.readiness.state === 'stale') {
    return 'developer_runner_reason_stale';
  }
  if (
    option.freshness?.state === 'missing'
    || option.readiness.state === 'missing'
    || option.readiness.state === 'unavailable'
  ) {
    return 'developer_runner_reason_unavailable';
  }
  if (option.capability.state === 'incompatible') {
    return 'developer_runner_reason_capability';
  }
  return 'developer_runner_reason_default';
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: TaskCreateDialogProps) {
  const t = useTranslations('agent_tasks.task');
  const commonT = useTranslations('common');
  const errorT = useTranslations('errors');
  const locale = useLocale();
  const [title, setTitle] = React.useState('');
  const [workspaceMode, setWorkspaceMode] = React.useState<TaskWorkspaceMode>('create_new');
  const [workspaceName, setWorkspaceName] = React.useState('');
  const [workspaceFileLibraryId, setWorkspaceFileLibraryId] = React.useState<string>('');
  const [taskFileTemplateId, setTaskFileTemplateId] = React.useState<string>('');
  const [workspaceFileLibraryConflict, setWorkspaceFileLibraryConflict] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [useDeveloperRunner, setUseDeveloperRunner] = React.useState(false);
  const [boundRunnerId, setBoundRunnerId] = React.useState('');
  const createTask = useCreateTask();
  const taskApi = React.useMemo(() => new TaskAPI(getApiClient()), []);
  const modelSetting = useAgentTaskModelSetting({
    workspaceId,
    projectId,
    enabled: open && !!workspaceId && !!projectId,
  });

  const {
    data: fileLibrariesData,
    isLoading: fileLibrariesLoading,
    refetch: refetchFileLibraries,
  } = useFileLibraries(workspaceId, projectId);
  const fileLibraries = React.useMemo(
    () => (fileLibrariesData?.items || []).filter(isFileLibrarySelectableForTask),
    [fileLibrariesData?.items],
  );
  const {
    data: taskFileTemplatesData,
    isLoading: taskFileTemplatesLoading,
  } = useTaskFileTemplates(workspaceId, projectId, {
    enabled: open && !!workspaceId && !!projectId,
  });
  const taskFileTemplates = React.useMemo(
    () => (taskFileTemplatesData?.items ?? []).filter((template) => template.status === 'published'),
    [taskFileTemplatesData?.items],
  );
  const selectedFileLibrary = React.useMemo(
    () => fileLibraries.find((library) => library.id === workspaceFileLibraryId) ?? null,
    [fileLibraries, workspaceFileLibraryId],
  );
  const selectedTaskFileTemplate = React.useMemo(
    () => taskFileTemplates.find((template) => template.id === taskFileTemplateId) ?? null,
    [taskFileTemplateId, taskFileTemplates],
  );
  const selectedFileLibrarySelectable = selectedFileLibrary
    ? isFileLibrarySelectableForTask(selectedFileLibrary)
    : false;
  const runnerBindingOptionsQuery = useQuery({
    queryKey: queryKeys.tasks.runnerBindingOptions(workspaceId, projectId),
    queryFn: () => taskApi.getRunnerBindingOptions(workspaceId, projectId),
    enabled: open && advancedOpen && !!workspaceId && !!projectId,
    staleTime: 10_000,
    retry: false,
  });
  const developerRunnerOptions = React.useMemo(
    () => (runnerBindingOptionsQuery.data?.options ?? []).filter((option) => (
      option.bound_runner_kind === 'developer'
      && option.actions.bind_to_task.visible
      && typeof option.agent_runner_id === 'string'
      && option.agent_runner_id.length > 0
    )),
    [runnerBindingOptionsQuery.data?.options],
  );
  const selectedDeveloperRunnerOption = React.useMemo(
    () => developerRunnerOptions.find((option) => option.agent_runner_id === boundRunnerId),
    [boundRunnerId, developerRunnerOptions],
  );
  const selectedDeveloperRunnerIsSelectable =
    !!selectedDeveloperRunnerOption &&
    isTaskRunnerBindingOptionSelectable(selectedDeveloperRunnerOption);
  const hasDeveloperRunnerOptions = developerRunnerOptions.length > 0;
  const hasSelectableDeveloperRunnerOption = developerRunnerOptions.some(isTaskRunnerBindingOptionSelectable);
  const defaultWorkspaceName = deriveDefaultTaskWorkspaceName(title);
  const modelReadiness = modelSetting.settingQuery.data?.readiness;
  const modelReadinessBlocks = !!modelReadiness && modelReadiness.state !== 'ready';
  const canUpdateModelSetting =
    modelSetting.settingQuery.data?.actions?.update?.visible === true
    && modelSetting.settingQuery.data.actions.update.allowed === true;
  const endpointsHref = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/endpoints`;
  const selectWorkspaceMode = React.useCallback((nextMode: TaskWorkspaceMode) => {
    setWorkspaceMode(nextMode);
    if (nextMode !== 'use_existing') {
      setWorkspaceFileLibraryId('');
      setWorkspaceFileLibraryConflict(null);
    }
    if (nextMode !== 'use_template') {
      setTaskFileTemplateId('');
    }
  }, []);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setTitle('');
      setWorkspaceMode('create_new');
      setWorkspaceName('');
      setWorkspaceFileLibraryId('');
      setTaskFileTemplateId('');
      setWorkspaceFileLibraryConflict(null);
      setAdvancedOpen(false);
      setUseDeveloperRunner(false);
      setBoundRunnerId('');
    }
  }, [open]);

  React.useEffect(() => {
    if (!workspaceFileLibraryId) return;
    if (!selectedFileLibrary || !isFileLibrarySelectableForTask(selectedFileLibrary)) {
      setWorkspaceFileLibraryId('');
    }
  }, [selectedFileLibrary, workspaceFileLibraryId]);

  React.useEffect(() => {
    if (!taskFileTemplateId) return;
    if (!selectedTaskFileTemplate) {
      setTaskFileTemplateId('');
    }
  }, [selectedTaskFileTemplate, taskFileTemplateId]);

  React.useEffect(() => {
    if (useDeveloperRunner) return;
    if (boundRunnerId) {
      setBoundRunnerId('');
    }
  }, [boundRunnerId, useDeveloperRunner]);

  React.useEffect(() => {
    if (!boundRunnerId) return;
    if (!runnerBindingOptionsQuery.data) return;
    if (selectedDeveloperRunnerOption) return;
    setBoundRunnerId('');
  }, [boundRunnerId, runnerBindingOptionsQuery.data, selectedDeveloperRunnerOption]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      return;
    }
    if (workspaceMode === 'use_existing' && !workspaceFileLibraryId) {
      return;
    }
    if (workspaceMode === 'use_existing' && !selectedFileLibrarySelectable) {
      return;
    }
    if (workspaceMode === 'use_template' && !selectedTaskFileTemplate) {
      return;
    }
    if (modelReadinessBlocks) {
      return;
    }
    if (useDeveloperRunner && !selectedDeveloperRunnerIsSelectable) {
      return;
    }

    const data: CreateTaskRequest = {
      title: title.trim(),
      ...(useDeveloperRunner && selectedDeveloperRunnerIsSelectable ? { bound_runner_id: boundRunnerId } : {}),
      ...(workspaceMode === 'create_new'
        ? {
            workspace_mode: 'create_new' as const,
            workspace_name: workspaceName.trim() || defaultWorkspaceName,
          }
        : workspaceMode === 'use_existing'
          ? {
              workspace_mode: 'use_existing' as const,
              workspace_file_library_id: workspaceFileLibraryId,
            }
          : {
              workspace_mode: 'use_template' as const,
              task_file_template_id: taskFileTemplateId,
            }),
    };

    try {
      setWorkspaceFileLibraryConflict(null);
      const task = await createTask.mutateAsync({
        workspaceId,
        projectId,
        data,
      });
      onOpenChange(false);
      if (onSuccess) {
        onSuccess(task.id);
      }
    } catch (error) {
      if (isTaskCreateFileLibraryTypedError(error)) {
        const resolved = resolveApiErrorPresentation({
          error,
          t: errorT,
          fallbackMessage: t('workspace_file_library_conflict'),
        });
        setWorkspaceFileLibraryConflict(resolved.description);
        setWorkspaceFileLibraryId('');
        await refetchFileLibraries();
        return;
      }
      // Error is handled by the hook
    }
  };

  const canSubmit = title.trim().length > 0
    && (
      workspaceMode === 'create_new'
      || (workspaceMode === 'use_existing' && workspaceFileLibraryId.length > 0 && selectedFileLibrarySelectable)
      || (workspaceMode === 'use_template' && !!selectedTaskFileTemplate)
    )
    && !modelReadinessBlocks
    && (!useDeveloperRunner || selectedDeveloperRunnerIsSelectable)
    && !createTask.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>
            {t('create_description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {modelSetting.settingQuery.isLoading ? (
            <div className="rounded-md border border-subtle bg-surface/70 px-3 py-2 text-sm text-tertiary">
              {t('model_readiness_loading')}
            </div>
          ) : null}
          {modelReadinessBlocks ? (
            <div
              className="rounded-md border border-warning/30 bg-warning/10 px-3 py-3"
              data-testid="task-create__model-readiness-blocked"
              data-state={modelReadiness.state}
            >
              <div className="text-sm font-medium text-foreground">{t('model_readiness_blocked_title')}</div>
              <p className="mt-1 text-sm text-secondary">{modelReadiness.display_summary}</p>
              {canUpdateModelSetting ? (
                <a
                  href={endpointsHref}
                  className="mt-2 inline-flex text-sm font-medium text-accent hover:underline"
                >
                  {t('model_readiness_open_endpoints')}
                </a>
              ) : (
                <p className="mt-2 text-xs text-tertiary">{t('model_readiness_contact_admin')}</p>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="task-title" className="text-sm font-medium text-foreground">
              {t('create_title')}
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('create_title')}
              disabled={createTask.isPending}
              required
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">{t('workspace_source_label')}</span>
            <div className="grid gap-2">
              <label className="flex items-start gap-3 rounded-lg border border-subtle bg-surface/30 px-3 py-3">
                <input
                  type="radio"
                  name="task-workspace-mode"
                  value="create_new"
                  checked={workspaceMode === 'create_new'}
                  onChange={() => selectWorkspaceMode('create_new')}
                  disabled={createTask.isPending}
                />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('workspace_source_create_new')}</div>
                  <p className="text-xs text-tertiary">{t('workspace_source_create_new_hint')}</p>
                </div>
              </label>
              {workspaceMode === 'create_new' ? (
                <div className="space-y-2 rounded-lg border border-dashed border-subtle bg-surface/20 p-3">
                  <label htmlFor="task-workspace-name" className="text-sm font-medium text-foreground">
                    {t('workspace_name_label')}
                  </label>
                  <Input
                    id="task-workspace-name"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder={workspaceName.length === 0 && defaultWorkspaceName.length > 0 ? defaultWorkspaceName : t('workspace_name_placeholder')}
                    disabled={createTask.isPending}
                  />
                  <p className="text-xs text-tertiary">{t('workspace_name_hint')}</p>
                </div>
              ) : null}
              <label className="flex items-start gap-3 rounded-lg border border-subtle bg-surface/30 px-3 py-3">
                <input
                  type="radio"
                  name="task-workspace-mode"
                  value="use_existing"
                  checked={workspaceMode === 'use_existing'}
                  onChange={() => selectWorkspaceMode('use_existing')}
                  disabled={createTask.isPending}
                />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('workspace_source_use_existing')}</div>
                  <p className="text-xs text-tertiary">{t('workspace_source_use_existing_hint')}</p>
                </div>
              </label>
              {workspaceMode === 'use_existing' ? (
                <div className="space-y-2 rounded-lg border border-dashed border-subtle bg-surface/20 p-3">
                  <label htmlFor="task-workspace-file-library" className="text-sm font-medium text-foreground">
                    {t('select_workspace_file_library')}
                  </label>
                  <Select
                    value={workspaceFileLibraryId}
                    onValueChange={(value) => {
                      setWorkspaceFileLibraryConflict(null);
                      setWorkspaceFileLibraryId(value);
                    }}
                    disabled={createTask.isPending || fileLibrariesLoading}
                  >
                    <SelectTrigger id="task-workspace-file-library" data-testid="task-create__file-library">
                      <SelectValue placeholder={t('select_workspace_file_library')} />
                    </SelectTrigger>
                    <SelectContent>
                      {fileLibrariesLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
                        </div>
                      ) : fileLibraries.length === 0 ? (
                        <div className="py-4 text-center text-sm text-tertiary">{t('workspace_file_library_empty')}</div>
                      ) : (
                        fileLibraries.map((library) => (
                          <SelectItem key={library.id} value={library.id}>
                            {library.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {workspaceFileLibraryConflict ? (
                    <div
                      className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-secondary"
                      role="alert"
                      data-testid="task-create__file-library-conflict"
                    >
                      {workspaceFileLibraryConflict}
                    </div>
                  ) : null}
                  <p className="text-xs text-tertiary">{t('workspace_file_library_hint')}</p>
                </div>
              ) : null}
              <label className="flex items-start gap-3 rounded-lg border border-subtle bg-surface/30 px-3 py-3">
                <input
                  type="radio"
                  name="task-workspace-mode"
                  value="use_template"
                  checked={workspaceMode === 'use_template'}
                  onChange={() => selectWorkspaceMode('use_template')}
                  disabled={createTask.isPending}
                />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('workspace_source_use_template')}</div>
                  <p className="text-xs text-tertiary">{t('workspace_source_use_template_hint')}</p>
                </div>
              </label>
              {workspaceMode === 'use_template' ? (
                <div className="space-y-2 rounded-lg border border-dashed border-subtle bg-surface/20 p-3">
                  <label htmlFor="task-file-template" className="text-sm font-medium text-foreground">
                    {t('select_task_file_template')}
                  </label>
                  <Select
                    value={taskFileTemplateId}
                    onValueChange={setTaskFileTemplateId}
                    disabled={createTask.isPending || taskFileTemplatesLoading}
                  >
                    <SelectTrigger id="task-file-template" data-testid="task-create__task-file-template">
                      <SelectValue placeholder={t('select_task_file_template')} />
                    </SelectTrigger>
                    <SelectContent>
                      {taskFileTemplatesLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
                        </div>
                      ) : taskFileTemplates.length === 0 ? (
                        <div className="py-4 text-center text-sm text-tertiary">{t('task_file_template_empty')}</div>
                      ) : (
                        taskFileTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-tertiary">{t('task_file_template_hint')}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-0 text-sm font-medium text-foreground hover:bg-transparent"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              {t('advanced_settings')}
            </Button>
            {advancedOpen ? (
              <div className="space-y-3 rounded-lg border border-subtle bg-surface/20 p-3">
                <p className="text-xs text-tertiary">{t('advanced_settings_description')}</p>
                {runnerBindingOptionsQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-1 text-sm text-tertiary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('developer_runner_loading')}</span>
                  </div>
                ) : runnerBindingOptionsQuery.isError ? (
                  <p className="text-sm text-tertiary">{t('developer_runner_empty')}</p>
                ) : !hasDeveloperRunnerOptions ? (
                  <p className="text-sm text-tertiary">{t('developer_runner_empty')}</p>
                ) : (
                  <>
                    {hasSelectableDeveloperRunnerOption ? (
                      <label className="flex items-start gap-3 rounded-lg border border-subtle bg-background/70 px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={t('use_developer_runner')}
                          aria-describedby="task-developer-runner-hint"
                          checked={useDeveloperRunner}
                          onChange={(event) => setUseDeveloperRunner(event.target.checked)}
                          disabled={createTask.isPending}
                        />
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-foreground">{t('use_developer_runner')}</div>
                          <p id="task-developer-runner-hint" className="text-xs text-tertiary">
                            {t('developer_runner_hint')}
                          </p>
                        </div>
                      </label>
                    ) : null}

                    {!hasSelectableDeveloperRunnerOption && !useDeveloperRunner ? (
                      <div
                        className="space-y-2 rounded-lg border border-dashed border-subtle bg-background/70 p-3"
                        data-testid="task-create__developer-runner-unavailable-options"
                      >
                        <p className="text-sm text-tertiary">{t('developer_runner_override_unavailable_hint')}</p>
                        {developerRunnerOptions.map((option) => (
                          <div key={option.option_id} className="space-y-0.5">
                            <p className="text-sm font-medium text-foreground">{option.label}</p>
                            <p className="text-xs text-tertiary">{t(getDeveloperRunnerReasonKey(option))}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
                {useDeveloperRunner && hasDeveloperRunnerOptions ? (
                  <div className="space-y-2 rounded-lg border border-dashed border-subtle bg-background/70 p-3">
                    <div className="space-y-2">
                      <label htmlFor="task-bound-runner" className="text-sm font-medium text-foreground">
                        {t('developer_runner_label')}
                      </label>
                      <Select
                        value={boundRunnerId}
                        onValueChange={setBoundRunnerId}
                        disabled={createTask.isPending || !hasSelectableDeveloperRunnerOption}
                      >
                        <SelectTrigger id="task-bound-runner" data-testid="task-create__bound-runner">
                          <SelectValue placeholder={t('developer_runner_placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {developerRunnerOptions.map((option) => {
                            const selectable = isTaskRunnerBindingOptionSelectable(option);
                            const reasonKey = selectable ? null : getDeveloperRunnerReasonKey(option);
                            return (
                              <SelectItem
                                key={option.option_id}
                                value={option.agent_runner_id!}
                                disabled={!selectable}
                              >
                                <span className="flex flex-col items-start gap-0.5 text-left">
                                  <span>{option.label}</span>
                                  {reasonKey ? (
                                    <span className="text-xs text-tertiary">{t(reasonKey)}</span>
                                  ) : null}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {selectedDeveloperRunnerOption && !selectedDeveloperRunnerIsSelectable ? (
                        <div className="rounded-md border border-subtle bg-surface/70 px-3 py-2">
                          <p className="text-sm font-medium text-foreground">{t('developer_runner_selected_unavailable')}</p>
                          <p className="text-xs text-tertiary">
                            {t(getDeveloperRunnerReasonKey(selectedDeveloperRunnerOption))}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <ImportantNotice t={t} />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createTask.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
