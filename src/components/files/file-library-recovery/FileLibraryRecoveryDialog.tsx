'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, RefreshCw, UnlockKeyhole } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  FileLibrary,
  FileLibraryRestoreOperation,
  FileLibrarySavePoint,
  FileLibraryVersionOperation,
  ReleaseFileLibraryRuntimeAccessResponse,
  TaskFileTemplate,
} from '@/lib/api/types';
import { APIError } from '@/lib/api/errors';
import {
  useCreateFileLibrarySavePoint,
  useFileLibraryActiveVersionOperation,
  useFileLibrarySavePoints,
  isFileLibraryOperationPendingError,
  restoreOperationToVersionOperation,
  useReleaseFileLibraryRuntimeAccess,
  useRestoreFileLibrary,
} from '@/lib/hooks/use-file-library-recovery';
import {
  useCreateTaskFileTemplate,
  useDeleteTaskFileTemplate,
  usePublishTaskFileTemplate,
  useTaskFileTemplates,
  useUnpublishTaskFileTemplate,
} from '@/lib/hooks/use-task-file-templates';
import { cn } from '@/lib/utils';
import { buildTaskPath } from '@/components/agent-tasks/task-list/navigation';

type FileLibraryRecoveryDialogProps = {
  library: FileLibrary | null;
  locale?: string;
  open: boolean;
  projectId: string;
  t: (key: string, values?: Record<string, string>) => string;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
};

type TemplateActionErrorDisplay = {
  description: string;
  title: string;
};

type SavePointActionErrorDisplay = {
  description: string;
  kind: 'error' | 'pending';
  title: string;
};

type RestoreActionErrorDisplay = {
  description: string;
  title: string;
};

type RestoreActiveWriterBlocker = {
  releaseAction: {
    libraryId: string;
  } | null;
  visibleTask: {
    id: string | null;
    title: string;
  } | null;
};

type PendingRestoreConfirm = {
  idempotencyKey: string;
  savePoint: FileLibrarySavePoint;
};

type PendingTemplateCreateAction = {
  key: string;
  signature: string;
};

type RestoreOperationDisplay = {
  description: string;
  icon: 'info' | 'loading' | 'success' | 'warning';
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
};

type TemplatePublishMode = 'published' | 'unpublished';

const EMPTY_SAVE_POINTS: FileLibrarySavePoint[] = [];

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function savePointLabel(savePoint: FileLibrarySavePoint, t: FileLibraryRecoveryDialogProps['t']) {
  return savePoint.message?.trim() || t('file_manager.save_point_default_name');
}

function generateRestoreIdempotencyKey(savePointId: string) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `restore_${savePointId}_${randomPart}`;
}

function generateTaskFileTemplateActionKey() {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `task_file_template_${randomPart}`;
}

function buildTaskFileTemplateActionSignature(input: {
  description: string;
  name: string;
  publishOnCreate: boolean;
  sourceLibraryId: string;
}) {
  return JSON.stringify({
    description: input.description,
    name: input.name,
    publish_on_create: input.publishOnCreate,
    source_library_id: input.sourceLibraryId,
  });
}

function isVersionOperationActive(operation: FileLibraryVersionOperation | null | undefined) {
  return operation?.status === 'accepted' || operation?.status === 'running';
}

function isVersionOperationTerminal(operation: FileLibraryVersionOperation | null | undefined) {
  return operation?.status === 'succeeded'
    || operation?.status === 'failed'
    || operation?.status === 'recovery_required';
}

function normalizeVersionOperation(
  operation: FileLibraryVersionOperation | FileLibraryRestoreOperation | null | undefined,
): FileLibraryVersionOperation | null {
  if (!operation) return null;
  return 'kind' in operation ? operation : restoreOperationToVersionOperation(operation);
}

function buildRestoreOperationDisplay(
  operation: FileLibraryVersionOperation,
  t: FileLibraryRecoveryDialogProps['t'],
): RestoreOperationDisplay {
  if (operation.kind === 'save_point_create') {
    if (operation.status === 'succeeded') {
      return {
        description: t('file_manager.save_point_operation_succeeded_summary'),
        icon: 'success',
        title: t('file_manager.save_point_operation_succeeded_title'),
        tone: 'success',
      };
    }
    if (operation.status === 'failed') {
      return {
        description: t('file_manager.save_point_operation_failed_summary'),
        icon: 'warning',
        title: t('file_manager.save_point_operation_failed_title'),
        tone: 'error',
      };
    }
    if (operation.status === 'recovery_required') {
      return {
        description: t('file_manager.save_point_operation_recovery_required_summary'),
        icon: 'warning',
        title: t('file_manager.save_point_operation_recovery_required_title'),
        tone: 'error',
      };
    }
    if (operation.status === 'running') {
      return {
        description: t('file_manager.save_point_operation_running_summary'),
        icon: 'loading',
        title: t('file_manager.save_point_operation_running_title'),
        tone: 'warning',
      };
    }
    return {
      description: t('file_manager.save_point_operation_accepted_summary'),
      icon: 'loading',
      title: t('file_manager.save_point_operation_accepted_title'),
      tone: 'warning',
    };
  }
  if (operation.status === 'succeeded') {
    return {
      description: t('file_manager.restore_operation_succeeded_summary'),
      icon: 'success',
      title: t('file_manager.restore_operation_succeeded_title'),
      tone: 'success',
    };
  }
  if (operation.status === 'failed') {
    return {
      description: t('file_manager.restore_operation_failed_summary'),
      icon: 'warning',
      title: t('file_manager.restore_operation_failed_title'),
      tone: 'error',
    };
  }
  if (operation.status === 'recovery_required') {
    return {
      description: t('file_manager.restore_operation_recovery_required_summary'),
      icon: 'warning',
      title: t('file_manager.restore_operation_recovery_required_title'),
      tone: 'error',
    };
  }
  if (operation.status === 'accepted') {
    return {
      description: t('file_manager.restore_operation_accepted_summary'),
      icon: 'loading',
      title: t('file_manager.restore_operation_accepted_title'),
      tone: 'warning',
    };
  }
  return {
    description: t('file_manager.restore_operation_restoring_summary'),
    icon: 'loading',
    title: t('file_manager.restore_operation_restoring_title'),
    tone: 'warning',
  };
}

function hasApiErrorCode(error: unknown, codes: string[], rawTokens: string[]): boolean {
  const rawValues = error instanceof APIError
    ? [error.errorCode, error.message]
    : error instanceof Error
      ? [error.message]
      : [];
  const normalizedCodes = new Set(codes.map((code) => code.trim().toLowerCase()));
  return rawValues.some((value) => {
    const normalized = value.trim().toLowerCase();
    return normalizedCodes.has(normalized)
      || rawTokens.some((token) => normalized === token || normalized.includes(token));
  });
}

function isFileTemplateCapabilityDenied(error: unknown): boolean {
  return hasApiErrorCode(error, ['FILE_LIBRARY_CAPABILITY_DENIED'], ['file_library_capability_denied']);
}

function isFileTemplateRestoreActive(error: unknown): boolean {
  return hasApiErrorCode(
    error,
    ['FILE_LIBRARY_RESTORE_OPERATION_ACTIVE', 'FILE_LIBRARY_RESTORE_OPERATION_PENDING'],
    ['file_library_restore_operation_active', 'file_library_restore_operation_pending'],
  );
}

function isFileLibraryActiveWriterBlocked(error: unknown): boolean {
  return hasApiErrorCode(
    error,
    ['FILE_LIBRARY_ACTIVE_WRITER_BLOCKED'],
    ['file_library_active_writer_blocked'],
  );
}

function isFileLibraryStorageNotReady(error: unknown): boolean {
  return hasApiErrorCode(
    error,
    ['FILE_LIBRARY_STORAGE_NOT_READY'],
    ['file_library_storage_not_ready', 'file_library_project_storage_not_ready', 'storage not ready'],
  );
}

function isRuntimeAccessReleaseBlocked(error: unknown): boolean {
  return hasApiErrorCode(
    error,
    ['FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED', 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT'],
    ['file_library_runtime_access_release_blocked', 'agent_task_workspace_binding_conflict'],
  );
}

function readNonEmptyString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(record: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readRecord(record: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFirstString(records: Array<Record<string, unknown> | null | undefined>, keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = readNonEmptyString(record, key);
      if (value) return value;
    }
  }
  return null;
}

function readFirstBoolean(records: Array<Record<string, unknown> | null | undefined>, keys: string[]): boolean | null {
  for (const record of records) {
    for (const key of keys) {
      const value = readBoolean(record, key);
      if (value !== null) return value;
    }
  }
  return null;
}

function errorDetailRecords(error: unknown): Array<Record<string, unknown> | null> {
  if (!(error instanceof APIError)) return [];
  const details = error.details ?? null;
  return [
    details,
    readRecord(details, 'details'),
    readRecord(details, 'bound_task'),
    readRecord(details, 'task'),
  ];
}

function buildRestoreActiveWriterBlocker(
  error: unknown,
  library: FileLibrary,
): RestoreActiveWriterBlocker {
  const records = errorDetailRecords(error);
  const visible = readFirstBoolean(records, ['bound_task_visible', 'task_visible', 'visible']);
  const detailTaskTitle = readFirstString(records, ['bound_task_title', 'task_title', 'title']);
  const detailTaskId = readFirstString(records, ['bound_task_id', 'task_id', 'id']);
  const canUseLibraryFallback = visible !== false && library.bound_task_visible;
  const fallbackTaskTitle = canUseLibraryFallback ? library.bound_task_title ?? null : null;
  const fallbackTaskId = canUseLibraryFallback ? library.bound_task_id ?? null : null;
  const visibleTaskTitle = visible === true ? detailTaskTitle ?? fallbackTaskTitle : fallbackTaskTitle;
  const visibleTaskId = visible === true ? detailTaskId ?? fallbackTaskId : fallbackTaskId;
  const visibleTask = visibleTaskTitle
    ? {
        id: visibleTaskId,
        title: visibleTaskTitle,
      }
    : null;

  return {
    releaseAction: library.id ? { libraryId: library.id } : null,
    visibleTask,
  };
}

function buildRestoreErrorDisplay(
  error: unknown,
  t: FileLibraryRecoveryDialogProps['t'],
): RestoreActionErrorDisplay {
  let description = t('file_manager.restore_error_failed');
  if (isFileLibraryOperationPendingError(error)) {
    description = t('file_manager.save_point_operation_pending');
  }
  if (isFileLibraryStorageNotReady(error)) {
    description = t('file_manager.save_point_storage_not_ready');
  }
  if (isFileLibraryActiveWriterBlocked(error)) {
    description = t('file_manager.restore_active_writer_description');
  }

  return {
    title: isFileLibraryActiveWriterBlocked(error)
      ? t('file_manager.restore_active_writer_title')
      : t('file_manager.restore_error_title'),
    description,
  };
}

function buildRestoreRuntimeReleaseErrorDisplay(
  error: unknown,
  t: FileLibraryRecoveryDialogProps['t'],
): RestoreActionErrorDisplay {
  return {
    title: t('file_manager.restore_runtime_release_failed_title'),
    description: isRuntimeAccessReleaseBlocked(error)
      ? t('file_manager.restore_runtime_release_blocked')
      : t('file_manager.restore_runtime_release_failed'),
  };
}

function buildRestoreRuntimeReleasePendingDisplay(t: FileLibraryRecoveryDialogProps['t']): RestoreActionErrorDisplay {
  return {
    title: t('file_manager.restore_runtime_release_pending_title'),
    description: t('file_manager.restore_runtime_release_pending'),
  };
}

function isRuntimeAccessReleaseConfirmed(release: ReleaseFileLibraryRuntimeAccessResponse): boolean {
  if (release.runtime_access_status === 'release_pending') return false;
  return release.runtime_access_status === 'released' || release.released === true;
}

function buildTemplateActionErrorDisplay(
  error: unknown,
  t: FileLibraryRecoveryDialogProps['t'],
): TemplateActionErrorDisplay {
  let description = t('file_manager.task_template_action_failed');
  if (isFileLibraryOperationPendingError(error)) {
    description = t('file_manager.task_template_operation_pending');
  }
  if (isFileLibraryActiveWriterBlocked(error)) {
    description = t('file_manager.task_template_active_writer_blocked');
  }
  if (isFileLibraryStorageNotReady(error)) {
    description = t('file_manager.task_template_storage_not_ready');
  }
  if (isFileTemplateRestoreActive(error)) {
    description = t('file_manager.task_template_restore_active');
  }
  if (isFileTemplateCapabilityDenied(error)) {
    description = t('file_manager.task_template_capability_denied');
  }

  return {
    title: t('file_manager.task_template_action_failed_title'),
    description,
  };
}

function buildSavePointActionErrorDisplay(
  error: unknown,
  t: FileLibraryRecoveryDialogProps['t'],
): SavePointActionErrorDisplay {
  let description = t('file_manager.save_point_action_failed');
  let kind: SavePointActionErrorDisplay['kind'] = 'error';
  let title = t('file_manager.save_point_action_failed_title');
  if (isFileLibraryOperationPendingError(error)) {
    description = t('file_manager.save_point_operation_pending');
    kind = 'pending';
    title = t('file_manager.save_point_preparing_title');
  }
  if (isFileLibraryActiveWriterBlocked(error)) {
    description = t('file_manager.save_point_active_writer_blocked');
    kind = 'error';
    title = t('file_manager.save_point_action_failed_title');
  }
  if (isFileLibraryStorageNotReady(error)) {
    description = t('file_manager.save_point_storage_not_ready');
    kind = 'error';
    title = t('file_manager.save_point_action_failed_title');
  }

  return {
    kind,
    title,
    description,
  };
}

function buildRestoreActiveTemplateError(t: FileLibraryRecoveryDialogProps['t']): TemplateActionErrorDisplay {
  return {
    title: t('file_manager.task_template_action_failed_title'),
    description: t('file_manager.task_template_restore_active'),
  };
}

function buildRestoreStateCheckingTemplateError(t: FileLibraryRecoveryDialogProps['t']): TemplateActionErrorDisplay {
  return {
    title: t('file_manager.task_template_action_failed_title'),
    description: t('file_manager.restore_status_checking'),
  };
}

function TemplateStatusBadge({
  status,
  t,
}: {
  status: TaskFileTemplate['status'];
  t: FileLibraryRecoveryDialogProps['t'];
}) {
  const tone = status === 'published'
    ? 'border-success/25 bg-success/10 text-success'
    : status === 'failed'
      ? 'border-error/25 bg-error/10 text-error'
      : 'border-subtle bg-surface-high/30 text-secondary';

  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase', tone)}>
      {t(`file_manager.task_template_status_${status}`)}
    </span>
  );
}

function SavePointListRecoveringNotice({
  embedded = false,
  onRetry,
  t,
}: {
  embedded?: boolean;
  onRetry: () => void;
  t: FileLibraryRecoveryDialogProps['t'];
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3',
        embedded
          ? 'px-3 py-4'
          : 'rounded-md border border-warning/30 bg-warning/10 px-3 py-3',
      )}
      data-testid="files__save-point__list-recovering"
      role="status"
    >
      <div className="flex min-w-0 gap-2">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning" />
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium text-primary">
            {t('file_manager.save_point_preparing_title')}
          </div>
          <div className="text-sm text-secondary">
            {t('file_manager.save_point_preparing_description')}
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        data-testid="files__save-point__retry"
      >
        <RefreshCw className="h-4 w-4" />
        {t('file_manager.save_point_retry')}
      </Button>
    </div>
  );
}

export function FileLibraryRecoveryDialog({
  library,
  locale = 'en-US',
  open,
  projectId,
  t,
  workspaceId,
  onOpenChange,
}: FileLibraryRecoveryDialogProps) {
  const [savePointMessage, setSavePointMessage] = React.useState('');
  const [savePointActionError, setSavePointActionError] = React.useState<SavePointActionErrorDisplay | null>(null);
  const [pendingSavePointCreate, setPendingSavePointCreate] = React.useState<{
    existingIds: ReadonlySet<string>;
    initialDataUpdatedAt: number;
    message?: string;
  } | null>(null);
  const [pendingRestoreConfirm, setPendingRestoreConfirm] = React.useState<PendingRestoreConfirm | null>(null);
  const [restoreOperation, setRestoreOperation] = React.useState<FileLibraryVersionOperation | null>(null);
  const [versionOperationIdleVisible, setVersionOperationIdleVisible] = React.useState(false);
  const [restoreActionError, setRestoreActionError] = React.useState<RestoreActionErrorDisplay | null>(null);
  const [restoreActiveWriterBlocker, setRestoreActiveWriterBlocker] = React.useState<RestoreActiveWriterBlocker | null>(null);
  const [restoreReleaseError, setRestoreReleaseError] = React.useState<RestoreActionErrorDisplay | null>(null);
  const [restoreReleasePendingDisplay, setRestoreReleasePendingDisplay] = React.useState<RestoreActionErrorDisplay | null>(null);
  const [templateName, setTemplateName] = React.useState('');
  const [templateDescription, setTemplateDescription] = React.useState('');
  const [templatePublishMode, setTemplatePublishMode] = React.useState<TemplatePublishMode>('published');
  const [templateActionError, setTemplateActionError] = React.useState<TemplateActionErrorDisplay | null>(null);
  const restoreConfirmInFlightRef = React.useRef(false);
  const templateCreateActionRef = React.useRef<PendingTemplateCreateAction | null>(null);
  const localVersionOperationStartedRef = React.useRef<{ id: string; activeDataUpdatedAt: number } | null>(null);
  const [restoreConfirmSubmitting, setRestoreConfirmSubmitting] = React.useState(false);

  const libraryId = library?.id ?? '';
  const libraryReady = library?.status === 'ready';

  const savePointsQuery = useFileLibrarySavePoints(workspaceId, projectId, libraryId, {
    enabled: open && !!libraryId,
  });
  const refetchSavePoints = savePointsQuery.refetch;
  const activeVersionOperationQuery = useFileLibraryActiveVersionOperation(workspaceId, projectId, libraryId, {
    enabled: open && !!libraryId,
  });
  const activeOperationDataUpdatedAt = activeVersionOperationQuery.dataUpdatedAt ?? 0;
  const templatesQuery = useTaskFileTemplates(workspaceId, projectId, {
    enabled: open,
  });

  const createSavePoint = useCreateFileLibrarySavePoint({ suppressErrorToast: true });
  const restoreFileLibrary = useRestoreFileLibrary({ suppressErrorToast: true });
  const releaseRuntimeAccess = useReleaseFileLibraryRuntimeAccess({ suppressErrorToast: true });
  const createTemplate = useCreateTaskFileTemplate();
  const publishTemplate = usePublishTaskFileTemplate();
  const unpublishTemplate = useUnpublishTaskFileTemplate();
  const deleteTemplate = useDeleteTaskFileTemplate();

  React.useEffect(() => {
    if (!open) {
      setSavePointMessage('');
      setSavePointActionError(null);
      setPendingSavePointCreate(null);
      setPendingRestoreConfirm(null);
      setRestoreOperation(null);
      setVersionOperationIdleVisible(false);
      setRestoreActionError(null);
      setRestoreActiveWriterBlocker(null);
      setRestoreReleaseError(null);
      setRestoreReleasePendingDisplay(null);
      setTemplateName('');
      setTemplateDescription('');
      setTemplatePublishMode('published');
      setTemplateActionError(null);
      restoreConfirmInFlightRef.current = false;
      templateCreateActionRef.current = null;
      localVersionOperationStartedRef.current = null;
      setRestoreConfirmSubmitting(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || activeVersionOperationQuery.isLoading) return;
    const nextOperation = normalizeVersionOperation(activeVersionOperationQuery.data?.operation);
    if (!nextOperation) {
      if (isVersionOperationActive(restoreOperation)) {
        const localStarted = localVersionOperationStartedRef.current;
        if (
          localStarted?.id === restoreOperation.id
          && activeOperationDataUpdatedAt <= localStarted.activeDataUpdatedAt
        ) {
          return;
        }
        if (localStarted?.id === restoreOperation.id) {
          localVersionOperationStartedRef.current = null;
        }
        setRestoreOperation(null);
        setVersionOperationIdleVisible(true);
        void refetchSavePoints();
      }
      return;
    }
    setVersionOperationIdleVisible(false);
    setRestoreOperation((current) => (
      current?.id === nextOperation.id
      && current.status === nextOperation.status
      && current.updated_at === nextOperation.updated_at
        ? current
        : nextOperation
    ));
    if (isVersionOperationActive(nextOperation)) {
      setRestoreActionError(null);
      setRestoreActiveWriterBlocker(null);
    }
  }, [
    activeVersionOperationQuery.data?.operation,
    activeOperationDataUpdatedAt,
    activeVersionOperationQuery.isLoading,
    open,
    refetchSavePoints,
    restoreOperation,
  ]);

  const savePoints = savePointsQuery.data?.items ?? EMPTY_SAVE_POINTS;
  const templates = templatesQuery.data?.items ?? [];
  const templatesForProject = templates;
  const restoreOperationActive = isVersionOperationActive(restoreOperation);
  const taskTemplatesBlocked = restoreOperationActive || activeVersionOperationQuery.isLoading;
  const showTemplateListLoading = templatesQuery.isLoading && templates.length === 0;
  const showTemplateListError = templatesQuery.isError && templates.length === 0;
  const savePointListOperationPending = isFileLibraryOperationPendingError(savePointsQuery.error);
  const showSavePointListLoading = savePointsQuery.isLoading && savePoints.length === 0;
  const showSavePointListError = savePointsQuery.isError
    && !savePointListOperationPending
    && savePoints.length === 0;
  const restoreDisplay = restoreOperation
    ? buildRestoreOperationDisplay(restoreOperation, t)
    : versionOperationIdleVisible
      ? {
          description: t('file_manager.version_operation_idle_summary'),
          icon: 'info' as const,
          title: t('file_manager.version_operation_idle_title'),
          tone: 'info' as const,
        }
      : null;

  React.useEffect(() => {
    if (savePointActionError?.kind !== 'pending' || !pendingSavePointCreate) return;
    if (savePointsQuery.isError || savePointsQuery.isLoading) return;
    if (savePointsQuery.dataUpdatedAt <= pendingSavePointCreate.initialDataUpdatedAt) return;
    const pendingMessage = pendingSavePointCreate.message;
    const createdSavePointVisible = savePoints.some((savePoint) => (
      !pendingSavePointCreate.existingIds.has(savePoint.id)
      && (!pendingMessage || savePoint.message === pendingMessage)
    ));
    if (!createdSavePointVisible) return;
    setSavePointActionError(null);
    setPendingSavePointCreate(null);
    setSavePointMessage('');
  }, [
    pendingSavePointCreate,
    savePointActionError?.kind,
    savePoints,
    savePointsQuery.dataUpdatedAt,
    savePointsQuery.isError,
    savePointsQuery.isLoading,
  ]);

  React.useEffect(() => {
    if (!pendingSavePointCreate || restoreOperation?.kind !== 'save_point_create') return;
    if (!isVersionOperationTerminal(restoreOperation)) return;
    setSavePointActionError(null);
    setPendingSavePointCreate(null);
    if (restoreOperation.status === 'succeeded') {
      setSavePointMessage('');
    }
  }, [
    pendingSavePointCreate,
    restoreOperation?.id,
    restoreOperation?.kind,
    restoreOperation?.status,
  ]);

  const handleCreateSavePoint = async () => {
    if (!library || !libraryReady || restoreOperationActive) return;
    setSavePointActionError(null);
    try {
      const operation = await createSavePoint.mutateAsync({
        workspaceId,
        projectId,
        libraryId: library.id,
        message: savePointMessage.trim() || undefined,
      });
      localVersionOperationStartedRef.current = {
        id: operation.id,
        activeDataUpdatedAt: activeOperationDataUpdatedAt,
      };
      setRestoreOperation(operation);
      setVersionOperationIdleVisible(false);
      if (isVersionOperationActive(operation)) {
        void activeVersionOperationQuery.refetch();
      }
      if (operation.status === 'succeeded') {
        void savePointsQuery.refetch();
      }
      setPendingSavePointCreate(null);
      setSavePointMessage('');
    } catch (error) {
      if (isFileLibraryOperationPendingError(error)) {
        setPendingSavePointCreate({
          existingIds: new Set(savePoints.map((savePoint) => savePoint.id)),
          initialDataUpdatedAt: savePointsQuery.dataUpdatedAt,
          message: savePointMessage.trim() || undefined,
        });
        void savePointsQuery.refetch();
      } else {
        setPendingSavePointCreate(null);
      }
      setSavePointActionError(buildSavePointActionErrorDisplay(error, t));
    }
  };

  const handleOpenRestoreConfirm = (savePoint: FileLibrarySavePoint) => {
    if (!library || !libraryReady || restoreOperationActive) return;
    setRestoreActionError(null);
    setRestoreActiveWriterBlocker(null);
    setVersionOperationIdleVisible(false);
    setRestoreReleaseError(null);
    setRestoreReleasePendingDisplay(null);
    setPendingRestoreConfirm({
      savePoint,
      idempotencyKey: generateRestoreIdempotencyKey(savePoint.id),
    });
  };

  const handleRestoreConfirmOpenChange = (nextOpen: boolean) => {
    if (nextOpen || restoreConfirmSubmitting) return;
    setPendingRestoreConfirm(null);
  };

  const handleConfirmRestore = async () => {
    if (!library || !pendingRestoreConfirm || !libraryReady || restoreOperationActive) return;
    if (restoreConfirmInFlightRef.current) return;
    restoreConfirmInFlightRef.current = true;
    setRestoreConfirmSubmitting(true);
    setRestoreActionError(null);
    setRestoreActiveWriterBlocker(null);
    setVersionOperationIdleVisible(false);
    setRestoreReleaseError(null);
    setRestoreReleasePendingDisplay(null);
    try {
      const operation = await restoreFileLibrary.mutateAsync({
        workspaceId,
        projectId,
        libraryId: library.id,
        savePointId: pendingRestoreConfirm.savePoint.id,
        idempotencyKey: pendingRestoreConfirm.idempotencyKey,
      });
      const versionOperation = restoreOperationToVersionOperation(operation);
      localVersionOperationStartedRef.current = {
        id: versionOperation.id,
        activeDataUpdatedAt: activeOperationDataUpdatedAt,
      };
      setRestoreOperation(versionOperation);
      setVersionOperationIdleVisible(false);
      setPendingRestoreConfirm(null);
      if (operation.status === 'pending' || operation.status === 'restoring') {
        void activeVersionOperationQuery.refetch();
      }
    } catch (error) {
      const display = buildRestoreErrorDisplay(error, t);
      setRestoreActionError(display);
      setRestoreOperation(null);
      setVersionOperationIdleVisible(false);
      setPendingRestoreConfirm(null);
      if (isFileLibraryActiveWriterBlocked(error)) {
        setRestoreActiveWriterBlocker(buildRestoreActiveWriterBlocker(error, library));
      }
    } finally {
      restoreConfirmInFlightRef.current = false;
      setRestoreConfirmSubmitting(false);
    }
  };

  const handleReleaseRuntimeAccess = async () => {
    if (!restoreActiveWriterBlocker?.releaseAction) return;
    setRestoreReleaseError(null);
    setRestoreReleasePendingDisplay(null);
    try {
      const release = await releaseRuntimeAccess.mutateAsync({
        workspaceId,
        projectId,
        libraryId: restoreActiveWriterBlocker.releaseAction.libraryId,
      });
      if (!isRuntimeAccessReleaseConfirmed(release)) {
        setRestoreReleasePendingDisplay(buildRestoreRuntimeReleasePendingDisplay(t));
        return;
      }
      setRestoreActiveWriterBlocker(null);
      setRestoreActionError(null);
      await Promise.all([
        activeVersionOperationQuery.refetch(),
        savePointsQuery.refetch(),
      ]);
    } catch (error) {
      setRestoreReleaseError(buildRestoreRuntimeReleaseErrorDisplay(error, t));
    }
  };

  const handleSaveTaskFileTemplate = async () => {
    if (!library || !libraryReady || !templateName.trim()) return;
    setTemplateActionError(null);
    if (taskTemplatesBlocked) {
      setTemplateActionError(activeVersionOperationQuery.isLoading
        ? buildRestoreStateCheckingTemplateError(t)
        : buildRestoreActiveTemplateError(t));
      return;
    }
    try {
      const name = templateName.trim();
      const description = templateDescription.trim();
      const publishOnCreate = templatePublishMode === 'published';
      const signature = buildTaskFileTemplateActionSignature({
        sourceLibraryId: library.id,
        name,
        description,
        publishOnCreate,
      });
      if (templateCreateActionRef.current?.signature !== signature) {
        templateCreateActionRef.current = {
          signature,
          key: generateTaskFileTemplateActionKey(),
        };
      }
      await createTemplate.mutateAsync({
        workspaceId,
        projectId,
        sourceLibraryId: library.id,
        name,
        description: description || undefined,
        publishOnCreate,
        idempotencyKey: templateCreateActionRef.current.key,
      });
      templateCreateActionRef.current = null;
      setTemplateName('');
      setTemplateDescription('');
      setTemplatePublishMode('published');
    } catch (error) {
      setTemplateActionError(buildTemplateActionErrorDisplay(error, t));
    }
  };

  const handleTemplatePublish = async (templateId: string) => {
    setTemplateActionError(null);
    if (taskTemplatesBlocked) {
      setTemplateActionError(activeVersionOperationQuery.isLoading
        ? buildRestoreStateCheckingTemplateError(t)
        : buildRestoreActiveTemplateError(t));
      return;
    }
    try {
      await publishTemplate.mutateAsync({
        workspaceId,
        projectId,
        templateId,
      });
    } catch (error) {
      setTemplateActionError(buildTemplateActionErrorDisplay(error, t));
    }
  };

  const handleTemplateUnpublish = async (templateId: string) => {
    setTemplateActionError(null);
    if (taskTemplatesBlocked) {
      setTemplateActionError(activeVersionOperationQuery.isLoading
        ? buildRestoreStateCheckingTemplateError(t)
        : buildRestoreActiveTemplateError(t));
      return;
    }
    try {
      await unpublishTemplate.mutateAsync({
        workspaceId,
        projectId,
        templateId,
      });
    } catch (error) {
      setTemplateActionError(buildTemplateActionErrorDisplay(error, t));
    }
  };

  const handleTemplateDelete = async (templateId: string) => {
    setTemplateActionError(null);
    if (taskTemplatesBlocked) {
      setTemplateActionError(activeVersionOperationQuery.isLoading
        ? buildRestoreStateCheckingTemplateError(t)
        : buildRestoreActiveTemplateError(t));
      return;
    }
    try {
      await deleteTemplate.mutateAsync({
        workspaceId,
        projectId,
        templateId,
      });
    } catch (error) {
      setTemplateActionError(buildTemplateActionErrorDisplay(error, t));
    }
  };

  const savePointPending = createSavePoint.isPending;
  const savePointCreateBlocked = savePointPending
    || savePointListOperationPending
    || savePointActionError?.kind === 'pending'
    || restoreOperationActive
    || activeVersionOperationQuery.isLoading;
  const restorePending = restoreFileLibrary.isPending || restoreConfirmSubmitting;
  const releasePending = releaseRuntimeAccess.isPending;
  const templatePending = createTemplate.isPending || publishTemplate.isPending || unpublishTemplate.isPending || deleteTemplate.isPending;
  const restorePanelVisible = !!restoreDisplay || !!restoreActionError || !!restoreActiveWriterBlocker;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right-wide"
          closeLabel={t('file_manager.close')}
          className="flex h-full max-w-full flex-col gap-0 overflow-hidden overflow-x-hidden p-0"
          data-testid="files__dialog__version-management"
        >
          <SheetHeader className="border-b border-subtle px-6 py-5">
            <SheetTitle>{t('file_manager.version_management_title')}</SheetTitle>
            <SheetDescription>
              {library
                ? t('file_manager.version_management_dialog_description', { name: library.name })
                : t('file_manager.version_management_dialog_no_library')}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
            <div className="flex gap-2 rounded-md border border-subtle bg-surface/40 px-3 py-2.5 text-sm text-secondary" data-testid="files__version-management-scope">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
              <div>{t('file_manager.version_management_scope_notice')}</div>
            </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {activeVersionOperationQuery.isLoading ? (
              <div
                className="flex items-start gap-2 rounded-md border border-subtle bg-surface/45 px-3 py-2 text-sm text-secondary"
                data-testid="files__restore-status-checking"
                role="status"
              >
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-tertiary" />
                <span>{t('file_manager.restore_status_checking')}</span>
              </div>
            ) : null}

            {restorePanelVisible ? (
              <div
                className={cn(
                  'rounded-md border px-3 py-3',
                  restoreDisplay?.tone === 'success'
                    ? 'border-success/25 bg-success/10'
                    : restoreDisplay?.tone === 'error'
                      ? 'border-error/25 bg-error/10'
                      : restoreDisplay?.tone === 'info'
                        ? 'border-subtle bg-surface/45'
                        : 'border-warning/30 bg-warning/10',
                )}
                data-testid="files__restore-operation"
                role={restoreDisplay?.tone === 'error' || restoreActionError ? 'alert' : 'status'}
              >
                <div className="flex gap-2">
                  {restoreDisplay?.icon === 'loading' ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning" />
                  ) : restoreDisplay?.icon === 'success' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : restoreDisplay?.icon === 'info' ? (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
                  ) : (
                    <AlertTriangle className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      restoreDisplay?.tone === 'error' ? 'text-error' : 'text-warning',
                    )} />
                  )}
                  <div className="min-w-0 space-y-2">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-primary" data-testid="files__restore-operation-title">
                        {restoreActionError?.title ?? restoreDisplay?.title}
                      </div>
                      <div className="text-sm text-secondary" data-testid="files__restore-operation-summary">
                        {restoreActionError?.description ?? restoreDisplay?.description}
                      </div>
                      {restoreActiveWriterBlocker?.visibleTask ? (
                        <div className="text-sm text-secondary">
                          {t('file_manager.restore_active_writer_task', {
                            title: restoreActiveWriterBlocker.visibleTask.title,
                          })}
                        </div>
                      ) : null}
                    </div>
                    {restoreActiveWriterBlocker ? (
                      <div className="flex flex-wrap gap-2">
                        {restoreActiveWriterBlocker.visibleTask?.id ? (
                          <Button asChild type="button" variant="outline" size="sm">
                            <Link
                              href={buildTaskPath(locale, workspaceId, projectId, restoreActiveWriterBlocker.visibleTask.id)}
                              data-testid="files__restore-blocker-open-task"
                            >
                              <ExternalLink className="h-4 w-4" />
                              {t('file_manager.restore_runtime_open_task')}
                            </Link>
                          </Button>
                        ) : null}
                        {restoreActiveWriterBlocker.releaseAction ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleReleaseRuntimeAccess}
                            disabled={releasePending}
                            data-testid="files__restore-blocker-release"
                          >
                            {releasePending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UnlockKeyhole className="h-4 w-4" />
                            )}
                            {t('file_manager.restore_runtime_release')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {restoreReleaseError ? (
                      <div
                        className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2"
                        data-testid="files__restore-release-error"
                        role="alert"
                      >
                        <div className="text-sm font-medium text-primary">{restoreReleaseError.title}</div>
                        <div className="text-sm text-secondary">{restoreReleaseError.description}</div>
                      </div>
                    ) : null}
                    {restoreReleasePendingDisplay ? (
                      <div
                        className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2"
                        data-testid="files__restore-release-pending"
                        role="status"
                      >
                        <div className="text-sm font-medium text-primary">{restoreReleasePendingDisplay.title}</div>
                        <div className="text-sm text-secondary">{restoreReleasePendingDisplay.description}</div>
                      </div>
                    ) : null}
                    {restoreOperationActive ? (
                      <div
                        className="rounded-md border border-warning/25 bg-surface/45 px-3 py-2 text-sm text-secondary"
                        data-testid="files__restore-template-blocker"
                      >
                        {restoreOperation?.kind === 'restore'
                          ? t('file_manager.task_template_restore_pending')
                          : t('file_manager.task_template_operation_pending')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <section className="grid gap-3 rounded-md border border-subtle bg-surface/30 p-3" aria-labelledby="files-save-point-section-title">
              <div>
                <h3 id="files-save-point-section-title" className="text-sm font-medium text-primary">
                  {t('file_manager.save_point_section_title')}
                </h3>
                <p className="mt-1 text-sm text-tertiary">{t('file_manager.save_point_section_description')}</p>
              </div>
                <div className="space-y-1.5">
                  <Label htmlFor="version-management-save-point-message">{t('file_manager.save_point_message')}</Label>
                  <Input
                    id="version-management-save-point-message"
                    value={savePointMessage}
                    onChange={(event) => setSavePointMessage(event.target.value)}
                    placeholder={t('file_manager.save_point_message_placeholder')}
                    disabled={!libraryReady || savePointCreateBlocked}
                    data-testid="files__save-point__message"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleCreateSavePoint}
                    disabled={!libraryReady || savePointCreateBlocked}
                    data-testid="files__save-point__create"
                  >
                    {savePointPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('file_manager.save_point_create')}
                  </Button>
                </div>
                {savePointActionError ? (
                  <div
                    className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-3"
                    data-testid={savePointActionError.kind === 'pending'
                      ? 'files__save-point__pending'
                      : 'files__save-point__error'}
                    role={savePointActionError.kind === 'pending' ? 'status' : 'alert'}
                  >
                    {savePointActionError.kind === 'pending' ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-primary">
                        {savePointActionError.title}
                      </div>
                      <div className="text-sm text-secondary">
                        {savePointActionError.description}
                      </div>
                    </div>
                  </div>
                ) : null}
            </section>

            <section className="grid gap-3 rounded-md border border-subtle bg-surface/30 p-3" aria-labelledby="files-template-section-title">
              <div>
                <h3 id="files-template-section-title" className="text-sm font-medium text-primary">
                  {t('file_manager.task_template_section_title')}
                </h3>
                <p className="mt-1 text-sm text-tertiary">{t('file_manager.task_template_section_description')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="version-management-template-name">{t('file_manager.task_template_name')}</Label>
                  <Input
                    id="version-management-template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder={t('file_manager.task_template_name_placeholder')}
                    disabled={!libraryReady || templatePending || taskTemplatesBlocked}
                    data-testid="files__template__name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="version-management-template-description">{t('file_manager.task_template_description')}</Label>
                  <Input
                    id="version-management-template-description"
                    value={templateDescription}
                    onChange={(event) => setTemplateDescription(event.target.value)}
                    placeholder={t('file_manager.task_template_description_placeholder')}
                    disabled={!libraryReady || templatePending || taskTemplatesBlocked}
                    data-testid="files__template__description"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={templatePublishMode === 'published'}
                  className={cn(
                    templatePublishMode === 'published'
                      ? 'border-foreground bg-foreground text-background hover:bg-foreground/95 hover:text-background'
                      : 'bg-transparent',
                  )}
                  onClick={() => setTemplatePublishMode('published')}
                  disabled={templatePending || taskTemplatesBlocked}
                  data-testid="files__template__publish-mode-project"
                >
                  {t('file_manager.task_template_publish_project')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={templatePublishMode === 'unpublished'}
                  className={cn(
                    templatePublishMode === 'unpublished'
                      ? 'border-foreground bg-foreground text-background hover:bg-foreground/95 hover:text-background'
                      : 'bg-transparent',
                  )}
                  onClick={() => setTemplatePublishMode('unpublished')}
                  disabled={templatePending || taskTemplatesBlocked}
                  data-testid="files__template__publish-mode-draft"
                >
                  {t('file_manager.task_template_publish_draft')}
                </Button>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleSaveTaskFileTemplate}
                  disabled={!libraryReady || !templateName.trim() || templatePending || taskTemplatesBlocked}
                  data-testid="files__template__save"
                >
                  {templatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('file_manager.task_template_save')}
                </Button>
              </div>
              {templateActionError ? (
                <div
                  className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-3"
                  data-testid="files__template__error"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium text-primary">
                      {templateActionError.title}
                    </div>
                    <div className="text-sm text-secondary">
                      {templateActionError.description}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="max-h-[220px] overflow-auto overflow-x-auto rounded-md border border-subtle">
                {showTemplateListLoading ? (
                  <div
                    className="px-3 py-6 text-center text-sm text-tertiary"
                    data-testid="files__template__list-loading"
                    role="status"
                  >
                    {t('file_manager.loading')}
                  </div>
                ) : showTemplateListError ? (
                  <div
                    className="flex items-start justify-between gap-3 px-3 py-4"
                    data-testid="files__template__list-error"
                    role="alert"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-primary">
                        {t('file_manager.task_template_load_error_title')}
                      </div>
                      <div className="text-sm text-secondary">
                        {t('file_manager.task_template_load_error_description')}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void templatesQuery.refetch()}
                      data-testid="files__template__retry"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t('file_manager.save_point_retry')}
                    </Button>
                  </div>
                ) : templatesForProject.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.task_template_empty')}</div>
                ) : (
                  <div className="divide-y divide-subtle">
                    {templatesForProject.map((template) => (
                      <div key={template.id} className="flex flex-col gap-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate text-sm font-medium text-primary">{template.name}</div>
                            <TemplateStatusBadge status={template.status} t={t} />
                          </div>
                          {template.description ? (
                            <div className="truncate text-xs text-tertiary">{template.description}</div>
                          ) : null}
                          <div
                            className="truncate text-xs text-tertiary"
                            data-testid={`files__template__source--${template.id}`}
                          >
                            {t(template.source_library_id === library?.id
                              ? 'file_manager.task_template_source_current'
                              : 'file_manager.task_template_source_other')}
                          </div>
                          {template.status === 'failed' ? (
                            <div className="text-xs text-warning" data-testid={`files__template__failed-next-step--${template.id}`}>
                              {t('file_manager.task_template_failed_next_step')}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2 sm:shrink-0">
                          {template.status === 'published' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void handleTemplateUnpublish(template.id)}
                              disabled={templatePending || taskTemplatesBlocked}
                              data-testid={`files__template__unpublish--${template.id}`}
                            >
                              {t('file_manager.template_unpublish')}
                            </Button>
                          ) : template.status === 'unpublished' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void handleTemplatePublish(template.id)}
                              disabled={templatePending || taskTemplatesBlocked}
                              data-testid={`files__template__publish--${template.id}`}
                            >
                              {t('file_manager.template_publish')}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleTemplateDelete(template.id)}
                            disabled={templatePending || taskTemplatesBlocked}
                            data-testid={`files__template__delete--${template.id}`}
                          >
                            {t('file_manager.delete')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="files-restore-points-section-title">
              <h3 id="files-restore-points-section-title" className="text-sm font-medium text-primary">
                {t('file_manager.restore_points_section_title')}
              </h3>
              {savePointListOperationPending && savePoints.length > 0 ? (
                <SavePointListRecoveringNotice
                  onRetry={() => void savePointsQuery.refetch()}
                  t={t}
                />
              ) : null}

              <div className="max-h-[280px] overflow-auto overflow-x-auto rounded-md border border-subtle">
                {showSavePointListLoading ? (
                  <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.loading')}</div>
                ) : savePointListOperationPending && savePoints.length === 0 ? (
                  <SavePointListRecoveringNotice
                    embedded
                    onRetry={() => void savePointsQuery.refetch()}
                    t={t}
                  />
                ) : showSavePointListError ? (
                  <div
                    className="flex items-start justify-between gap-3 px-3 py-4"
                    data-testid="files__save-point__list-error"
                    role="alert"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-primary">
                        {t('file_manager.save_point_load_error_title')}
                      </div>
                      <div className="text-sm text-secondary">
                        {t('file_manager.save_point_load_error_description')}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void savePointsQuery.refetch()}
                      data-testid="files__save-point__retry"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t('file_manager.save_point_retry')}
                    </Button>
                  </div>
                ) : savePoints.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.save_point_empty')}</div>
                ) : (
                  <div className="divide-y divide-subtle">
                    {savePoints.map((savePoint) => (
                      <div key={savePoint.id} className="flex flex-col gap-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-primary">{savePointLabel(savePoint, t)}</div>
                          <div className="text-xs text-tertiary">{formatTimestamp(savePoint.created_at)}</div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenRestoreConfirm(savePoint)}
                          disabled={!libraryReady || restorePending || restoreOperationActive || activeVersionOperationQuery.isLoading}
                          data-testid={`files__save-point__restore--${savePoint.id}`}
                        >
                          {t('file_manager.restore')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingRestoreConfirm} onOpenChange={handleRestoreConfirmOpenChange}>
        <AlertDialogContent data-testid="files__restore-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRestoreConfirm
                ? t('file_manager.restore_confirm_title', {
                    name: savePointLabel(pendingRestoreConfirm.savePoint, t),
                  })
                : t('file_manager.restore')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('file_manager.restore_confirm_description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-secondary">
            {t('file_manager.restore_confirm_helper')}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={restoreConfirmSubmitting}
              data-testid="files__restore-confirm-cancel"
            >
              {t('file_manager.restore_confirm_cancel')}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmRestore()}
              disabled={restoreConfirmSubmitting || restoreFileLibrary.isPending || !pendingRestoreConfirm}
              data-testid="files__restore-confirm-submit"
            >
              {restoreConfirmSubmitting || restoreFileLibrary.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t('file_manager.restore_confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
