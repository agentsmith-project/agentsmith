'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FilesTable } from '@/components/files/FilesTable';
import { useFiles } from '@/lib/hooks/use-files';
import { Loader2 } from 'lucide-react';
export interface FileSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onConfirm: (selectedIds: string[]) => void;
  excludeIds?: string[]; // IDs to exclude (already attached)
}

export function FileSelectDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onConfirm,
  excludeIds = [],
}: FileSelectDialogProps) {
  const t = useTranslations('notebook.attached_files.select_dialog');
  const tCommon = useTranslations('common');
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  // Fetch task-selectable files from the file library.
  // Do not hard-filter to AI Ready only: users should be able to see newly uploaded files
  // and decide whether to attach them based on visible status badges.
  const { data: filesData, isLoading } = useFiles(workspaceId, projectId, {
    page_size: 1000, // Demo-friendly upper bound for selectable files
  });

  // Filter out already attached files
  const availableFiles = React.useMemo(() => {
    if (!filesData?.items) return [];
    return filesData.items.filter((file) => !excludeIds.includes(file.id));
  }, [filesData?.items, excludeIds]);

  React.useEffect(() => {
    if (open) {
      setSelectedIds([]);
    }
  }, [open]);

  const handleConfirm = () => {
    if (selectedIds.length > 0) {
      onConfirm(selectedIds);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-tertiary" />
            </div>
          ) : availableFiles.length === 0 ? (
            <div className="py-8 text-center text-sm text-tertiary">
              {t('no_files')}
            </div>
          ) : (
            <FilesTable
              data={availableFiles}
              selectedIds={selectedIds}
              onRowSelect={setSelectedIds}
            />
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-subtle">
          <div className="text-sm text-tertiary">
            {selectedIds.length > 0
              ? t('selected_count', { count: selectedIds.length })
              : t('none_selected')}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={selectedIds.length === 0}>
              {t('confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
