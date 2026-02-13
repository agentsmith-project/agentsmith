import * as React from 'react';

import { getApiClient, SourcesAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { getOperationErrorDetail } from './error-utils';

type BatchResultType = 'delete' | 'download';
type SelectedEntry = { kind: 'prefix'; prefix: string } | { kind: 'object'; key: string };
type SelectedObject = { kind: 'object'; key: string };

type DeleteObjectsResponse = {
  results: Array<{ key: string; status: 'deleted' | 'failed' | 'not_found' | 'error'; error_code?: string; message?: string }>;
};

type UseSourceBatchOperationsParams = {
  workspaceId: string;
  projectId: string;
  selectedLibraryId: string | null;
  selected: SelectedEntry[];
  selectedObjects: SelectedObject[];
  clearSelection: () => void;
  deleteObjects: (input: { workspaceId: string; projectId: string; libraryId: string; keys: string[] }) => Promise<DeleteObjectsResponse>;
  onDeletePartialFailure: (failedKeys: string[]) => void;
  t: (key: string, values?: Record<string, string>) => string;
  tErrors: (key: string, values?: Record<string, string | number>) => string;
};

function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function triggerBrowserDownload(blob: Blob, key: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = basename(key) || 'download';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export function useSourceBatchOperations({
  workspaceId,
  projectId,
  selectedLibraryId,
  selected,
  selectedObjects,
  clearSelection,
  deleteObjects,
  onDeletePartialFailure,
  t,
  tErrors,
}: UseSourceBatchOperationsParams) {
  const [batchResultOpen, setBatchResultOpen] = React.useState(false);
  const [batchResultType, setBatchResultType] = React.useState<BatchResultType>('delete');
  const [batchFailedKeys, setBatchFailedKeys] = React.useState<string[]>([]);
  const [batchRetryPending, setBatchRetryPending] = React.useState(false);

  const handleDelete = React.useCallback(async () => {
    if (!selectedLibraryId || selected.length === 0) return;
    const keys = selected.map((s) => (s.kind === 'object' ? s.key : s.prefix));
    try {
      const result = await deleteObjects({ workspaceId, projectId, libraryId: selectedLibraryId, keys });
      const failedKeys = result.results
        .filter((item) => item.status !== 'deleted')
        .map((item) => item.key);
      if (failedKeys.length > 0) {
        onDeletePartialFailure(failedKeys);
        setBatchResultType('delete');
        setBatchFailedKeys(failedKeys);
        setBatchResultOpen(true);
        toast.error(t('file_manager.delete_partial_failed', { failed: String(failedKeys.length) }));
        return;
      }
      clearSelection();
      toast.success(t('file_manager.deleted'));
    } catch (err) {
      const msg = getOperationErrorDetail(err, tErrors, t('file_manager.delete_failed'));
      toast.error(`${t('file_manager.delete_failed')}: ${msg}`);
    }
  }, [clearSelection, deleteObjects, onDeletePartialFailure, projectId, selected, selectedLibraryId, t, tErrors, workspaceId]);

  const handleDownload = React.useCallback(async () => {
    if (!selectedLibraryId || selectedObjects.length === 0) return;
    const api = new SourcesAPI(getApiClient());
    const failedKeys: string[] = [];
    for (const objectItem of selectedObjects) {
      try {
        const blob = await api.downloadObject(workspaceId, projectId, selectedLibraryId, objectItem.key);
        triggerBrowserDownload(blob, objectItem.key);
      } catch {
        failedKeys.push(objectItem.key);
      }
    }
    if (failedKeys.length > 0) {
      setBatchResultType('download');
      setBatchFailedKeys(failedKeys);
      setBatchResultOpen(true);
      toast.error(t('file_manager.download_partial_failed', { failed: String(failedKeys.length) }));
      return;
    }
    if (selectedObjects.length > 1) {
      toast.success(t('file_manager.download_started', { count: String(selectedObjects.length) }));
    }
  }, [projectId, selectedLibraryId, selectedObjects, t, workspaceId]);

  const handleRetryBatchFailures = React.useCallback(async () => {
    if (!selectedLibraryId || batchFailedKeys.length === 0) return;
    setBatchRetryPending(true);
    try {
      if (batchResultType === 'delete') {
        const result = await deleteObjects({
          workspaceId,
          projectId,
          libraryId: selectedLibraryId,
          keys: batchFailedKeys,
        });
        const stillFailed = result.results
          .filter((item) => item.status !== 'deleted')
          .map((item) => item.key);
        if (stillFailed.length > 0) {
          setBatchFailedKeys(stillFailed);
          toast.error(t('file_manager.retry_partial_failed', { failed: String(stillFailed.length) }));
          return;
        }
        clearSelection();
      } else {
        const api = new SourcesAPI(getApiClient());
        const stillFailed: string[] = [];
        for (const key of batchFailedKeys) {
          try {
            const blob = await api.downloadObject(workspaceId, projectId, selectedLibraryId, key);
            triggerBrowserDownload(blob, key);
          } catch {
            stillFailed.push(key);
          }
        }
        if (stillFailed.length > 0) {
          setBatchFailedKeys(stillFailed);
          toast.error(t('file_manager.retry_partial_failed', { failed: String(stillFailed.length) }));
          return;
        }
      }
      setBatchResultOpen(false);
      setBatchFailedKeys([]);
      toast.success(t('file_manager.retry_success'));
    } finally {
      setBatchRetryPending(false);
    }
  }, [
    batchFailedKeys,
    batchResultType,
    clearSelection,
    deleteObjects,
    projectId,
    selectedLibraryId,
    t,
    workspaceId,
  ]);

  const closeBatchResult = React.useCallback(() => {
    setBatchResultOpen(false);
    setBatchFailedKeys([]);
    setBatchRetryPending(false);
  }, []);

  const handleBatchResultOpenChange = React.useCallback((open: boolean) => {
    setBatchResultOpen(open);
    if (!open) {
      setBatchFailedKeys([]);
      setBatchRetryPending(false);
    }
  }, []);

  return {
    batchFailedKeys,
    batchResultOpen,
    batchResultType,
    batchRetryPending,
    closeBatchResult,
    handleDelete,
    handleBatchResultOpenChange,
    handleDownload,
    handleRetryBatchFailures,
  };
}
