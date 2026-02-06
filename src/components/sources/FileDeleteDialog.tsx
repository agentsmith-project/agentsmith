'use client';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export interface FileDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (deleteAIReady: boolean) => void;
  /** Single file: filename. Batch: count. */
  filename?: string;
  /** Single file mode: has AIReady. Batch: any has AIReady. */
  hasAIReady: boolean;
  /** Batch mode: number of files to delete */
  fileCount?: number;
  deleting?: boolean;
}

export function FileDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  filename,
  hasAIReady,
  fileCount = 1,
  deleting = false,
}: FileDeleteDialogProps) {
  const [deleteAIReady, setDeleteAIReady] = React.useState(true);
  const isBatch = fileCount > 1;

  const handleConfirm = () => {
    onConfirm(deleteAIReady);
  };

  const handleClose = () => {
    if (!deleting) {
      setDeleteAIReady(true);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]" data-testid="sources__delete-dialog">
        <DialogHeader>
          <DialogTitle>
            {isBatch ? `Delete ${fileCount} files` : 'Delete File'}
          </DialogTitle>
          <DialogDescription>
            {isBatch ? (
              <>Are you sure you want to delete <strong>{fileCount} files</strong>?</>
            ) : (
              <>Are you sure you want to delete <strong>{filename}</strong>?</>
            )}
          </DialogDescription>
        </DialogHeader>

        {hasAIReady && (
          <div className="flex items-center gap-2 py-4">
            <Checkbox
              id="delete-ai-ready"
              checked={deleteAIReady}
              onCheckedChange={(checked) => setDeleteAIReady(checked === true)}
              disabled={deleting}
            />
            <label
              htmlFor="delete-ai-ready"
              className="text-sm text-foreground cursor-pointer"
            >
              Also delete AIReady artifacts
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
