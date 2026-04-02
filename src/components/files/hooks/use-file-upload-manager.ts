import * as React from 'react';

import { APIError } from '@/lib/api/errors';
import { toast } from '@/components/ui/toast';
import { getOperationErrorDetail } from './error-utils';

type UploadConflictState = {
  file: File;
  remaining: File[];
  total: number;
  completed: number;
};

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

type UseSourceUploadManagerParams = {
  workspaceId: string;
  projectId: string;
  selectedLibraryId: string | null;
  prefix: string;
  uploadObject: (input: UploadMutationInput) => Promise<unknown>;
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

export function useFileUploadManager({
  workspaceId,
  projectId,
  selectedLibraryId,
  prefix,
  uploadObject,
  t,
  tErrors,
}: UseSourceUploadManagerParams) {
  const [uploadConflictOpen, setUploadConflictOpen] = React.useState(false);
  const [uploadConflict, setUploadConflict] = React.useState<UploadConflictState | null>(null);
  const [uploadInProgress, setUploadInProgress] = React.useState(false);
  const [uploadCurrentFileName, setUploadCurrentFileName] = React.useState('');
  const [uploadCurrentProgress, setUploadCurrentProgress] = React.useState(0);
  const [uploadQueueTotal, setUploadQueueTotal] = React.useState(0);
  const [uploadQueueCompleted, setUploadQueueCompleted] = React.useState(0);
  const [isDropActive, setIsDropActive] = React.useState(false);

  const dragDepthRef = React.useRef(0);
  const uploadAbortRef = React.useRef<AbortController | null>(null);

  const resetUploadProgress = React.useCallback(() => {
    setUploadInProgress(false);
    setUploadCurrentFileName('');
    setUploadCurrentProgress(0);
    setUploadQueueTotal(0);
    setUploadQueueCompleted(0);
    uploadAbortRef.current = null;
  }, []);

  const handleCancelUpload = React.useCallback(() => {
    const controller = uploadAbortRef.current;
    if (controller) controller.abort();
  }, []);

  const uploadSingleFile = React.useCallback(
    async (file: File, overwrite = false) => {
      if (!selectedLibraryId) throw new Error('library_not_selected');
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setUploadCurrentFileName(file.name);
      setUploadCurrentProgress(0);
      await uploadObject({
        workspaceId,
        projectId,
        libraryId: selectedLibraryId,
        file,
        prefix: prefix || undefined,
        overwrite,
        signal: controller.signal,
        onProgress: (progress) => setUploadCurrentProgress(Math.max(0, Math.min(100, Math.round(progress)))),
      });
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
    },
    [prefix, projectId, selectedLibraryId, uploadObject, workspaceId],
  );

  const handleUploadConflict = React.useCallback((file: File, remaining: File[], total: number, completed: number) => {
    setUploadConflict({ file, remaining, total, completed });
    setUploadConflictOpen(true);
  }, []);

  const processUploadQueue = React.useCallback(
    async (queue: File[], progress?: { total: number; completed: number }) => {
      if (!selectedLibraryId || queue.length === 0) return;
      const total = progress?.total ?? queue.length;
      let completed = progress?.completed ?? 0;
      setUploadInProgress(true);
      setUploadQueueTotal(total);
      setUploadQueueCompleted(completed);
      for (let i = 0; i < queue.length; i += 1) {
        const current = queue[i];
        try {
          await uploadSingleFile(current, false);
          completed += 1;
          setUploadQueueCompleted(completed);
        } catch (err) {
          if (isUploadConflictError(err)) {
            setUploadInProgress(false);
            handleUploadConflict(current, queue.slice(i + 1), total, completed);
            return;
          }
          if (err instanceof Error && err.message === 'Upload was aborted') {
            resetUploadProgress();
            toast.success(t('file_manager.upload_canceled'));
            return;
          }
          const msg = getOperationErrorDetail(err, tErrors, t('file_manager.upload_failed'));
          resetUploadProgress();
          toast.error(`${t('file_manager.upload_failed')}: ${msg}`);
          return;
        }
      }
      resetUploadProgress();
      toast.success(t('file_manager.upload_success'));
    },
    [handleUploadConflict, resetUploadProgress, selectedLibraryId, t, tErrors, uploadSingleFile],
  );

  const handleFilesPicked = React.useCallback(
    async (files: FileList | null) => {
      if (!files || !selectedLibraryId || uploadInProgress) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      await processUploadQueue(list);
    },
    [processUploadQueue, selectedLibraryId, uploadInProgress],
  );

  const handleDropEnter: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      if (!selectedLibraryId) return;
      dragDepthRef.current += 1;
      setIsDropActive(true);
    },
    [selectedLibraryId],
  );

  const handleDropLeave: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      if (!selectedLibraryId) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDropActive(false);
    },
    [selectedLibraryId],
  );

  const handleDropOver: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      if (!selectedLibraryId) return;
      if (!isDropActive) setIsDropActive(true);
    },
    [isDropActive, selectedLibraryId],
  );

  const handleDrop: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDropActive(false);
      if (!selectedLibraryId) return;
      void handleFilesPicked(event.dataTransfer?.files ?? null);
    },
    [handleFilesPicked, selectedLibraryId],
  );

  const continueAfterConflict = React.useCallback(
    async (remaining: File[], completed: number, total: number) => {
      setUploadConflict(null);
      setUploadConflictOpen(false);
      if (remaining.length > 0) {
        await processUploadQueue(remaining, { completed, total });
      } else {
        resetUploadProgress();
        toast.success(t('file_manager.upload_success'));
      }
    },
    [processUploadQueue, resetUploadProgress, t],
  );

  const resolveUploadConflictOverwrite = React.useCallback(async () => {
    if (!uploadConflict) return;
    try {
      await uploadSingleFile(uploadConflict.file, true);
      await continueAfterConflict(uploadConflict.remaining, uploadConflict.completed + 1, uploadConflict.total);
    } catch (err) {
      const msg = getOperationErrorDetail(err, tErrors, t('file_manager.upload_failed'));
      toast.error(`${t('file_manager.upload_failed')}: ${msg}`);
    }
  }, [continueAfterConflict, t, tErrors, uploadConflict, uploadSingleFile]);

  const resolveUploadConflictRename = React.useCallback(async () => {
    if (!uploadConflict) return;
    const source = uploadConflict.file;
    let attempt = 1;
    while (attempt <= 20) {
      const nextName = renameWithIndex(source.name, attempt);
      const renamed = new File([source], nextName, { type: source.type, lastModified: source.lastModified });
      try {
        await uploadSingleFile(renamed, false);
        await continueAfterConflict(uploadConflict.remaining, uploadConflict.completed + 1, uploadConflict.total);
        return;
      } catch (err) {
        if (isUploadConflictError(err)) {
          attempt += 1;
          continue;
        }
        const msg = getOperationErrorDetail(err, tErrors, t('file_manager.upload_failed'));
        toast.error(`${t('file_manager.upload_failed')}: ${msg}`);
        return;
      }
    }
    toast.error(t('file_manager.upload_rename_exhausted'));
  }, [continueAfterConflict, t, tErrors, uploadConflict, uploadSingleFile]);

  const dismissUploadConflict = React.useCallback(() => {
    setUploadConflictOpen(false);
    setUploadConflict(null);
    resetUploadProgress();
  }, [resetUploadProgress]);

  const handleUploadConflictOpenChange = React.useCallback(
    (open: boolean) => {
      setUploadConflictOpen(open);
      if (!open) {
        setUploadConflict(null);
        resetUploadProgress();
      }
    },
    [resetUploadProgress],
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
    uploadCurrentFileName,
    uploadCurrentProgress,
    uploadInProgress,
    uploadQueueCompleted,
    uploadQueueTotal,
  };
}
