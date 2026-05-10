'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ObjectOperationDialogsProps {
  batchFailedKeys: string[];
  batchResultOpen: boolean;
  batchResultType: 'delete' | 'download';
  batchRetryPending: boolean;
  canManage: boolean;
  deleteInlineError: string | null;
  deleteConfirmOpen: boolean;
  selectedCount: number;
  t: (key: string, values?: Record<string, string>) => string;
  uploadConflictFileName: string;
  uploadConflictOpen: boolean;
  onCloseBatchResult: () => void;
  onClearDeleteInlineError: () => void;
  onDismissUploadConflict: () => void;
  onHandleBatchResultOpenChange: (open: boolean) => void;
  onHandleDelete: () => Promise<boolean>;
  onHandleRetryBatchFailures: () => Promise<void>;
  onHandleUploadConflictOpenChange: (open: boolean) => void;
  onResolveUploadConflictOverwrite: () => void;
  onResolveUploadConflictRename: () => void;
  onSetDeleteConfirmOpen: (open: boolean) => void;
}

export function ObjectOperationDialogs({
  batchFailedKeys,
  batchResultOpen,
  batchResultType,
  batchRetryPending,
  canManage,
  deleteInlineError,
  deleteConfirmOpen,
  selectedCount,
  t,
  uploadConflictFileName,
  uploadConflictOpen,
  onCloseBatchResult,
  onClearDeleteInlineError,
  onDismissUploadConflict,
  onHandleBatchResultOpenChange,
  onHandleDelete,
  onHandleRetryBatchFailures,
  onHandleUploadConflictOpenChange,
  onResolveUploadConflictOverwrite,
  onResolveUploadConflictRename,
  onSetDeleteConfirmOpen,
}: ObjectOperationDialogsProps) {
  return (
    <>
      <Dialog open={canManage && uploadConflictOpen} onOpenChange={onHandleUploadConflictOpenChange}>
        <DialogContent className="sm:max-w-[520px]" data-testid="files__dialog__upload-conflict">
          <DialogHeader>
            <DialogTitle>{t('file_manager.upload_conflict_title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-tertiary">
              {t('file_manager.upload_conflict_description')}
            </div>
            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2 font-mono text-xs break-all text-primary">
              {uploadConflictFileName || '-'}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDismissUploadConflict}>
              {t('file_manager.cancel')}
            </Button>
            <Button type="button" variant="outline" onClick={onResolveUploadConflictRename} data-testid="files__upload-conflict__rename">
              {t('file_manager.upload_conflict_rename')}
            </Button>
            <Button type="button" variant="destructive" onClick={onResolveUploadConflictOverwrite} data-testid="files__upload-conflict__overwrite">
              {t('file_manager.upload_conflict_overwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={canManage && deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) onClearDeleteInlineError();
          onSetDeleteConfirmOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[480px]" data-testid="files__dialog__delete">
          <DialogHeader>
            <DialogTitle>{t('file_manager.delete')}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-tertiary">
            {t('file_manager.delete_confirm', { count: String(selectedCount) })}
          </div>
          {deleteInlineError ? (
            <div
              className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
              role="alert"
              data-testid="files__delete__error"
            >
              {deleteInlineError}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onClearDeleteInlineError();
                onSetDeleteConfirmOpen(false);
              }}
            >
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void onHandleDelete().then((success) => {
                  if (success) {
                    onSetDeleteConfirmOpen(false);
                  }
                });
              }}
              disabled={selectedCount === 0}
            >
              {t('file_manager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchResultOpen && (canManage || batchResultType === 'download')} onOpenChange={onHandleBatchResultOpenChange}>
        <DialogContent className="sm:max-w-[620px]" data-testid="files__dialog__batch-result">
          <DialogHeader>
            <DialogTitle>
              {batchResultType === 'delete'
                ? t('file_manager.batch_delete_result_title')
                : t('file_manager.batch_download_result_title')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-tertiary">
              {t('file_manager.batch_result_failed_count', { failed: String(batchFailedKeys.length) })}
            </div>
            <div className="rounded-md border border-subtle bg-surface-high/20 max-h-[260px] overflow-auto">
              <div className="divide-y divide-border-subtle">
                {batchFailedKeys.map((key) => (
                  <div key={key} className="px-3 py-2 text-xs font-mono break-all text-primary" data-testid="files__batch-result__row">
                    {key}
                  </div>
                ))}
              </div>
            </div>
            {deleteInlineError ? (
              <div
                className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                role="alert"
                data-testid="files__batch-result__error"
              >
                {deleteInlineError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCloseBatchResult}>
              {t('file_manager.close')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onHandleRetryBatchFailures();
              }}
              disabled={batchRetryPending || batchFailedKeys.length === 0 || (!canManage && batchResultType === 'delete')}
              data-testid="files__batch-result__retry"
            >
              {t('file_manager.retry_failed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
