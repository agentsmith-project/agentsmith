import * as React from 'react';

import { APIError } from '@/lib/api/errors';
import type { FileObjectItem } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { getOperationErrorDetail } from './error-utils';

export type UploadedFileObjectIdentity = {
  key?: string;
  path?: string;
  name?: string;
  item?: FileObjectItem;
};

export type FileUploadTargetContext = {
  libraryId: string;
  prefix: string;
};

type UploadConflictState = {
  id: number;
  target: FileUploadTargetContext;
  file: File;
  remaining: File[];
  total: number;
  completed: number;
  pendingSyncObjects: UploadedFileObjectIdentity[];
};

type UploadPhase = 'idle' | 'uploading' | 'syncing';

type UploadMutationInput = {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  file: File;
  prefix?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

type UploadMutationResult = Partial<FileObjectItem> & {
  path?: string;
};

type UseSourceUploadManagerParams = {
  workspaceId: string;
  projectId: string;
  uploadTarget: FileUploadTargetContext | null;
  uploadObject: (input: UploadMutationInput) => Promise<UploadMutationResult>;
  syncUploadedObjects: (
    target: FileUploadTargetContext,
    uploadedObjects: UploadedFileObjectIdentity[],
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
  t: (key: string, values?: Record<string, string>) => string;
  tErrors: (key: string, values?: Record<string, string | number>) => string;
};

function renameWithIndex(originalName: string, index: number) {
  const dotIndex = originalName.lastIndexOf('.');
  if (dotIndex <= 0) return `${originalName} (${index})`;
  const name = originalName.slice(0, dotIndex);
  const ext = originalName.slice(dotIndex);
  return `${name} (${index})${ext}`;
}

function isUploadConflictError(error: unknown) {
  if (!(error instanceof APIError)) return false;
  if (error.errorCode === 'destination_exists') return true;
  return error.statusCode === 409 && error.message === 'file_library_destination_exists';
}

function isErrorLikeRecord(error: unknown): error is { name?: unknown; message?: unknown } {
  return typeof error === 'object' && error !== null;
}

function isUploadAbortError(error: unknown) {
  if (error instanceof APIError && error.errorCode === 'REQUEST_ABORTED') return true;
  if (!isErrorLikeRecord(error)) return false;
  if (error.name === 'AbortError') return true;
  return error.message === 'Upload was aborted';
}

function nonEmptyString(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getUploadedFileObjectItem(
  response: UploadMutationResult,
  key: string | undefined,
  name: string | undefined,
) {
  if (!key || !name || typeof response.size_bytes !== 'number' || typeof response.last_modified !== 'string') {
    return undefined;
  }

  const item: FileObjectItem = {
    kind: 'object',
    key,
    name,
    size_bytes: response.size_bytes,
    content_type: response.content_type ?? 'application/octet-stream',
    last_modified: response.last_modified,
  };
  return item;
}

function getUploadedObjectIdentity(response: UploadMutationResult): UploadedFileObjectIdentity {
  const key = nonEmptyString(response.key);
  const path = nonEmptyString(response.path);
  const name = nonEmptyString(response.name);
  if (!key && !path && !name) {
    throw new Error('file_upload_response_missing_object_identity');
  }

  const identity: UploadedFileObjectIdentity = {};
  if (key) identity.key = key;
  if (path) identity.path = path;
  if (name) identity.name = name;
  const item = getUploadedFileObjectItem(response, key ?? path, name);
  if (item) identity.item = item;
  return identity;
}

export function useFileUploadManager({
  workspaceId,
  projectId,
  uploadTarget,
  uploadObject,
  syncUploadedObjects,
  t,
  tErrors,
}: UseSourceUploadManagerParams) {
  const [uploadConflictOpen, setUploadConflictOpen] = React.useState(false);
  const [uploadConflict, setUploadConflict] = React.useState<UploadConflictState | null>(null);
  const [uploadPhase, setUploadPhase] = React.useState<UploadPhase>('idle');
  const [uploadCurrentFileName, setUploadCurrentFileName] = React.useState('');
  const [uploadCurrentProgress, setUploadCurrentProgress] = React.useState(0);
  const [uploadQueueTotal, setUploadQueueTotal] = React.useState(0);
  const [uploadQueueCompleted, setUploadQueueCompleted] = React.useState(0);
  const [isDropActive, setIsDropActive] = React.useState(false);

  const dragDepthRef = React.useRef(0);
  const uploadAbortRef = React.useRef<AbortController | null>(null);
  const syncAbortRef = React.useRef<AbortController | null>(null);
  const uploadConflictRef = React.useRef<UploadConflictState | null>(null);
  const uploadConflictIdRef = React.useRef(0);
  const activeConflictResolutionIdRef = React.useRef<number | null>(null);
  const consumedUploadConflictPendingSyncIdsRef = React.useRef(new Set<number>());
  const mountedRef = React.useRef(true);
  const uploadInProgress = uploadPhase !== 'idle';
  const uploadCanCancel = uploadPhase === 'uploading';

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      syncAbortRef.current?.abort();
      syncAbortRef.current = null;
      uploadConflictRef.current = null;
      activeConflictResolutionIdRef.current = null;
    };
  }, []);

  const isCurrentUploadConflict = React.useCallback((conflict: UploadConflictState) => (
    mountedRef.current && uploadConflictRef.current?.id === conflict.id
  ), []);

  const setCurrentUploadConflict = React.useCallback((conflict: UploadConflictState | null) => {
    uploadConflictRef.current = conflict;
    setUploadConflict(conflict);
  }, []);

  const clearCurrentUploadConflict = React.useCallback((conflict?: UploadConflictState) => {
    if (conflict && uploadConflictRef.current?.id !== conflict.id) {
      return false;
    }
    uploadConflictRef.current = null;
    setUploadConflict(null);
    setUploadConflictOpen(false);
    return true;
  }, []);

  const resetUploadProgress = React.useCallback(() => {
    if (!mountedRef.current) return;
    setUploadPhase('idle');
    setUploadCurrentFileName('');
    setUploadCurrentProgress(0);
    setUploadQueueTotal(0);
    setUploadQueueCompleted(0);
    uploadAbortRef.current = null;
  }, []);

  const uploadSingleFile = React.useCallback(
    async (target: FileUploadTargetContext, file: File, overwrite = false) => {
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setUploadPhase('uploading');
      setUploadCurrentFileName(file.name);
      setUploadCurrentProgress(0);
      try {
        const response = await uploadObject({
          workspaceId,
          projectId,
          libraryId: target.libraryId,
          file,
          prefix: target.prefix || undefined,
          overwrite,
          signal: controller.signal,
          onProgress: (progress) => {
            if (
              mountedRef.current
              && uploadAbortRef.current === controller
              && !controller.signal.aborted
            ) {
              setUploadCurrentProgress(Math.max(0, Math.min(100, Math.round(progress))));
            }
          },
        });
        return getUploadedObjectIdentity(response);
      } finally {
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = null;
        }
      }
    },
    [projectId, uploadObject, workspaceId],
  );

  const syncUploadedObjectIdentities = React.useCallback(async (
    target: FileUploadTargetContext,
    uploadedObjects: UploadedFileObjectIdentity[],
  ) => {
    if (uploadedObjects.length === 0) return mountedRef.current;

    setUploadPhase('syncing');
    const controller = new AbortController();
    syncAbortRef.current?.abort();
    syncAbortRef.current = controller;
    try {
      await syncUploadedObjects(target, uploadedObjects, { signal: controller.signal });
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const msg = getOperationErrorDetail(err, tErrors, t('file_manager.upload_failed'));
      resetUploadProgress();
      toast.error(`${t('file_manager.upload_failed')}: ${msg}`);
      return;
    } finally {
      if (syncAbortRef.current === controller) {
        syncAbortRef.current = null;
      }
    }

    return mountedRef.current && !controller.signal.aborted;
  }, [resetUploadProgress, syncUploadedObjects, t, tErrors]);

  const finalizeUploadSuccess = React.useCallback(async (
    target: FileUploadTargetContext,
    uploadedObjects: UploadedFileObjectIdentity[],
  ) => {
    const synced = await syncUploadedObjectIdentities(target, uploadedObjects);
    if (!synced || !mountedRef.current) return;
    resetUploadProgress();
    toast.success(t('file_manager.upload_success'));
  }, [resetUploadProgress, syncUploadedObjectIdentities, t]);

  const handleUploadFailure = React.useCallback(
    (err: unknown) => {
      if (!mountedRef.current) return;
      const msg = getOperationErrorDetail(err, tErrors, t('file_manager.upload_failed'));
      resetUploadProgress();
      toast.error(`${t('file_manager.upload_failed')}: ${msg}`);
    },
    [resetUploadProgress, t, tErrors],
  );

  const handleUploadCanceled = React.useCallback(
    async (target: FileUploadTargetContext, uploadedObjects: UploadedFileObjectIdentity[]) => {
      const synced = await syncUploadedObjectIdentities(target, uploadedObjects);
      if (!synced || !mountedRef.current) return;
      resetUploadProgress();
      toast.success(t('file_manager.upload_canceled'));
    },
    [resetUploadProgress, syncUploadedObjectIdentities, t],
  );

  const handleInterruptedUploadFailure = React.useCallback(
    async (
      target: FileUploadTargetContext,
      uploadedObjects: UploadedFileObjectIdentity[],
      err: unknown,
    ) => {
      const synced = await syncUploadedObjectIdentities(target, uploadedObjects);
      if (!synced || !mountedRef.current) return;
      handleUploadFailure(err);
    },
    [handleUploadFailure, syncUploadedObjectIdentities],
  );

  const handleUploadConflict = React.useCallback(
    (
      target: FileUploadTargetContext,
      file: File,
      remaining: File[],
      total: number,
      completed: number,
      uploadedObjects: UploadedFileObjectIdentity[],
    ) => {
      if (!mountedRef.current) return;
      const id = uploadConflictIdRef.current + 1;
      uploadConflictIdRef.current = id;
      const conflict: UploadConflictState = {
        id,
        target,
        file,
        remaining,
        total,
        completed,
        pendingSyncObjects: uploadedObjects,
      };
      setCurrentUploadConflict(conflict);
      setUploadConflictOpen(true);
    },
    [setCurrentUploadConflict],
  );

  const consumeUploadConflictPendingSyncObjects = React.useCallback((conflict: UploadConflictState) => {
    if (consumedUploadConflictPendingSyncIdsRef.current.has(conflict.id)) return [];
    const pendingSyncObjects = conflict.pendingSyncObjects;
    if (pendingSyncObjects.length === 0) return pendingSyncObjects;
    consumedUploadConflictPendingSyncIdsRef.current.add(conflict.id);
    const nextConflict = { ...conflict, pendingSyncObjects: [] };
    if (uploadConflictRef.current?.id === conflict.id) {
      uploadConflictRef.current = nextConflict;
    }
    setUploadConflict((current) => {
      if (current?.id !== conflict.id) return current;
      return nextConflict;
    });
    return pendingSyncObjects;
  }, []);

  const flushUploadConflictPendingSyncObjects = React.useCallback(async (
    conflict: UploadConflictState,
    mode: 'sync' | 'canceled',
  ) => {
    const pendingSyncObjects = consumeUploadConflictPendingSyncObjects(conflict);
    if (mode === 'canceled') {
      await handleUploadCanceled(conflict.target, pendingSyncObjects);
      return true;
    }
    return syncUploadedObjectIdentities(conflict.target, pendingSyncObjects);
  }, [consumeUploadConflictPendingSyncObjects, handleUploadCanceled, syncUploadedObjectIdentities]);

  const handleCancelUpload = React.useCallback(() => {
    if (uploadPhase !== 'uploading') return;
    const controller = uploadAbortRef.current;
    if (controller) controller.abort();
    const conflict = uploadConflictRef.current;
    if (conflict && activeConflictResolutionIdRef.current === conflict.id) {
      activeConflictResolutionIdRef.current = null;
      clearCurrentUploadConflict(conflict);
      void flushUploadConflictPendingSyncObjects(conflict, 'canceled');
    }
  }, [clearCurrentUploadConflict, flushUploadConflictPendingSyncObjects, uploadPhase]);

  const processUploadQueue = React.useCallback(
    async (
      queue: File[],
      progress?: {
        target: FileUploadTargetContext;
        total: number;
        completed: number;
        uploadedObjects: UploadedFileObjectIdentity[];
      },
    ) => {
      const target = progress?.target ?? uploadTarget;
      if (!target || queue.length === 0) return;
      const total = progress?.total ?? queue.length;
      let completed = progress?.completed ?? 0;
      const uploadedObjects = [...(progress?.uploadedObjects ?? [])];
      setUploadPhase('uploading');
      setUploadQueueTotal(total);
      setUploadQueueCompleted(completed);
      for (let i = 0; i < queue.length; i += 1) {
        const current = queue[i];
        try {
          const uploadedObject = await uploadSingleFile(target, current, false);
          if (!mountedRef.current) return;
          uploadedObjects.push(uploadedObject);
          completed += 1;
          setUploadQueueCompleted(completed);
        } catch (err) {
          if (!mountedRef.current) return;
          if (isUploadConflictError(err)) {
            setUploadPhase('idle');
            handleUploadConflict(target, current, queue.slice(i + 1), total, completed, uploadedObjects);
            return;
          }
          if (isUploadAbortError(err)) {
            await handleUploadCanceled(target, uploadedObjects);
            return;
          }
          await handleInterruptedUploadFailure(target, uploadedObjects, err);
          return;
        }
      }
      await finalizeUploadSuccess(target, uploadedObjects);
    },
    [
      finalizeUploadSuccess,
      handleInterruptedUploadFailure,
      handleUploadCanceled,
      handleUploadConflict,
      uploadSingleFile,
      uploadTarget,
    ],
  );

  const handleFilesPicked = React.useCallback(
    async (files: FileList | null) => {
      if (!files || !uploadTarget || uploadPhase !== 'idle') return;
      const list = Array.from(files);
      if (list.length === 0) return;
      await processUploadQueue(list);
    },
    [processUploadQueue, uploadPhase, uploadTarget],
  );

  const handleDropEnter: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      if (!uploadTarget) return;
      dragDepthRef.current += 1;
      setIsDropActive(true);
    },
    [uploadTarget],
  );

  const handleDropLeave: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      if (!uploadTarget) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDropActive(false);
    },
    [uploadTarget],
  );

  const handleDropOver: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      if (!uploadTarget) return;
      if (!isDropActive) setIsDropActive(true);
    },
    [isDropActive, uploadTarget],
  );

  const handleDrop: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDropActive(false);
      if (!uploadTarget) return;
      void handleFilesPicked(event.dataTransfer?.files ?? null);
    },
    [handleFilesPicked, uploadTarget],
  );

  const continueAfterConflict = React.useCallback(
    async (
      conflict: UploadConflictState,
      uploadedObjects: UploadedFileObjectIdentity[],
    ) => {
      if (!isCurrentUploadConflict(conflict)) return;
      clearCurrentUploadConflict(conflict);
      if (conflict.remaining.length > 0) {
        await processUploadQueue(conflict.remaining, {
          target: conflict.target,
          completed: conflict.completed + 1,
          total: conflict.total,
          uploadedObjects,
        });
      } else {
        await finalizeUploadSuccess(conflict.target, uploadedObjects);
      }
    },
    [clearCurrentUploadConflict, finalizeUploadSuccess, isCurrentUploadConflict, processUploadQueue],
  );

  const resolveUploadConflictOverwrite = React.useCallback(async () => {
    const conflict = uploadConflictRef.current;
    if (!conflict) return;
    activeConflictResolutionIdRef.current = conflict.id;
    try {
      const uploadedObject = await uploadSingleFile(conflict.target, conflict.file, true);
      if (!isCurrentUploadConflict(conflict)) return;
      await continueAfterConflict(conflict, [...conflict.pendingSyncObjects, uploadedObject]);
    } catch (err) {
      if (!isCurrentUploadConflict(conflict)) return;
      const pendingSyncObjects = consumeUploadConflictPendingSyncObjects(conflict);
      if (isUploadAbortError(err)) {
        await handleUploadCanceled(conflict.target, pendingSyncObjects);
        return;
      }
      await handleInterruptedUploadFailure(conflict.target, pendingSyncObjects, err);
    } finally {
      if (activeConflictResolutionIdRef.current === conflict.id) {
        activeConflictResolutionIdRef.current = null;
      }
    }
  }, [
    consumeUploadConflictPendingSyncObjects,
    continueAfterConflict,
    handleInterruptedUploadFailure,
    handleUploadCanceled,
    isCurrentUploadConflict,
    uploadSingleFile,
  ]);

  const resolveUploadConflictRename = React.useCallback(async () => {
    const conflict = uploadConflictRef.current;
    if (!conflict) return;
    activeConflictResolutionIdRef.current = conflict.id;
    const source = conflict.file;
    let attempt = 1;
    try {
      while (attempt <= 20) {
        const nextName = renameWithIndex(source.name, attempt);
        const renamed = new File([source], nextName, { type: source.type, lastModified: source.lastModified });
        try {
          const uploadedObject = await uploadSingleFile(conflict.target, renamed, false);
          if (!isCurrentUploadConflict(conflict)) return;
          await continueAfterConflict(conflict, [...conflict.pendingSyncObjects, uploadedObject]);
          return;
        } catch (err) {
          if (!isCurrentUploadConflict(conflict)) return;
          if (isUploadConflictError(err)) {
            attempt += 1;
            continue;
          }
          const pendingSyncObjects = consumeUploadConflictPendingSyncObjects(conflict);
          if (isUploadAbortError(err)) {
            await handleUploadCanceled(conflict.target, pendingSyncObjects);
            return;
          }
          await handleInterruptedUploadFailure(conflict.target, pendingSyncObjects, err);
          return;
        }
      }
      if (!isCurrentUploadConflict(conflict)) return;
      const pendingSyncObjects = consumeUploadConflictPendingSyncObjects(conflict);
      const synced = await syncUploadedObjectIdentities(conflict.target, pendingSyncObjects);
      if (!synced || !mountedRef.current || !isCurrentUploadConflict(conflict)) return;
      resetUploadProgress();
      toast.error(t('file_manager.upload_rename_exhausted'));
    } finally {
      if (activeConflictResolutionIdRef.current === conflict.id) {
        activeConflictResolutionIdRef.current = null;
      }
    }
  }, [
    consumeUploadConflictPendingSyncObjects,
    continueAfterConflict,
    handleInterruptedUploadFailure,
    handleUploadCanceled,
    resetUploadProgress,
    syncUploadedObjectIdentities,
    t,
    isCurrentUploadConflict,
    uploadSingleFile,
  ]);

  const dismissUploadConflict = React.useCallback(async () => {
    const conflict = uploadConflictRef.current;
    if (conflict) {
      uploadAbortRef.current?.abort();
      if (activeConflictResolutionIdRef.current === conflict.id) {
        activeConflictResolutionIdRef.current = null;
      }
    }
    clearCurrentUploadConflict(conflict ?? undefined);
    if (conflict) {
      const synced = await flushUploadConflictPendingSyncObjects(conflict, 'sync');
      if (!synced || !mountedRef.current) return;
    }
    resetUploadProgress();
  }, [
    clearCurrentUploadConflict,
    flushUploadConflictPendingSyncObjects,
    resetUploadProgress,
  ]);

  const handleUploadConflictOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        void dismissUploadConflict();
        return;
      }
      setUploadConflictOpen(open);
    },
    [dismissUploadConflict],
  );

  return {
    dismissUploadConflict,
    handleCancelUpload,
    handleUploadConflictOpenChange,
    handleDrop,
    handleDropEnter,
    handleDropLeave,
    handleDropOver,
    handleFilesPicked,
    isDropActive,
    resolveUploadConflictOverwrite,
    resolveUploadConflictRename,
    uploadConflictFileName: uploadConflict?.file.name ?? '',
    uploadConflictOpen,
    uploadCanCancel,
    uploadCurrentFileName,
    uploadCurrentProgress,
    uploadInProgress,
    uploadQueueCompleted,
    uploadQueueTotal,
  };
}
