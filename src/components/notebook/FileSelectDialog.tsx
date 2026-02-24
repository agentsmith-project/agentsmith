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
import { useFileLibraries } from '@/lib/hooks/use-files';
import { useFileObjects } from '@/lib/hooks/use-file-objects';
import { Loader2, Folder, File as FileIcon } from 'lucide-react';
import type { FileObjectItem } from '@/lib/api/types';
export interface FileSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onConfirm: (inputs: Array<
    | { kind: 'source'; source_id: string }
    | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
  >) => void | Promise<void>;
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
  const [selectedLibraryId, setSelectedLibraryId] = React.useState<string>('');
  const [isAttachingObject, setIsAttachingObject] = React.useState(false);
  const [attachingObjectKey, setAttachingObjectKey] = React.useState<string | null>(null);

  // Fetch task-selectable files from the file library.
  // Do not hard-filter to AI Ready only: users should be able to see newly uploaded files
  // and decide whether to attach them based on visible status badges.
  const { data: filesData, isLoading } = useFiles(workspaceId, projectId, {
    page_size: 1000, // Demo-friendly upper bound for selectable files
  });
  const { data: librariesData } = useFileLibraries(workspaceId, projectId);
  const libraries = React.useMemo(() => librariesData?.items ?? [], [librariesData?.items]);
  const { data: libraryObjectsData, isLoading: libraryObjectsLoading } = useFileObjects(
    workspaceId,
    projectId,
    selectedLibraryId || null,
    {
      page_size: 100,
      sort_by: 'name',
      sort_order: 'asc',
    },
  );
  const libraryObjectItems = React.useMemo(
    () => (libraryObjectsData?.items ?? []).filter((item): item is FileObjectItem => item.kind === 'object'),
    [libraryObjectsData?.items],
  );

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

  React.useEffect(() => {
    if (!open) return;
    if (selectedLibraryId) return;
    if (libraries.length === 0) return;
    setSelectedLibraryId(libraries[0].id);
  }, [libraries, open, selectedLibraryId]);

  const handleConfirm = async () => {
    if (selectedIds.length > 0) {
      await onConfirm(selectedIds.map((source_id) => ({ kind: 'source' as const, source_id })));
      onOpenChange(false);
    }
  };

  const handleAttachLibraryObject = async (libraryId: string, objectItem: FileObjectItem) => {
    setIsAttachingObject(true);
    setAttachingObjectKey(objectItem.key);
    try {
      await onConfirm([{
        kind: 'library_object',
        library_id: libraryId,
        key: objectItem.key,
        name: objectItem.name,
        content_type: objectItem.content_type,
        size_bytes: objectItem.size_bytes,
      }]);
      onOpenChange(false);
    } finally {
      setIsAttachingObject(false);
      setAttachingObjectKey(null);
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
          ) : (
            <div className="space-y-4">
              <div>
                {availableFiles.length === 0 ? (
                  <div className="py-6 text-center text-sm text-tertiary border border-subtle rounded-md">
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

              <div className="border border-subtle rounded-md p-3 space-y-3">
                <div className="text-sm font-medium text-primary">
                  {t('library_objects_title')}
                </div>
                {libraries.length === 0 ? (
                  <div className="text-sm text-tertiary">{t('library_objects_empty')}</div>
                ) : (
                  <>
                    <select
                      className="w-full h-9 rounded-md border border-subtle bg-surface px-3 text-sm"
                      value={selectedLibraryId}
                      onChange={(e) => setSelectedLibraryId(e.target.value)}
                    >
                      {libraries.map((library) => (
                        <option key={library.id} value={library.id}>
                          {library.name}
                        </option>
                      ))}
                    </select>
                    {libraryObjectsLoading ? (
                      <div className="flex items-center justify-center py-4 text-tertiary">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : libraryObjectItems.length === 0 ? (
                      <div className="text-sm text-tertiary">{t('library_objects_no_items')}</div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto divide-y divide-subtle rounded-md border border-subtle">
                        {libraryObjectsData?.items?.map((item) => {
                          if (item.kind === 'prefix') {
                            return (
                              <div key={item.prefix} className="flex items-center gap-2 px-3 py-2 text-sm text-tertiary">
                                <Folder className="h-4 w-4" />
                                <span className="truncate">{item.name}/</span>
                              </div>
                            );
                          }
                          const objectItem = item as FileObjectItem;
                          return (
                            <div key={objectItem.key} className="flex items-center justify-between gap-2 px-3 py-2">
                              <div className="min-w-0 flex items-center gap-2">
                                <FileIcon className="h-4 w-4 text-tertiary" />
                                <div className="min-w-0">
                                  <div className="truncate text-sm text-primary">{objectItem.name}</div>
                                  <div className="truncate text-xs text-tertiary">{objectItem.content_type}</div>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isAttachingObject}
                                onClick={() => handleAttachLibraryObject(selectedLibraryId, objectItem)}
                              >
                                {isAttachingObject && attachingObjectKey === objectItem.key ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  t('library_objects_add')
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-xs text-tertiary">
                      {t('library_objects_hint')}
                    </p>
                  </>
                )}
              </div>
            </div>
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
            <Button onClick={() => { void handleConfirm(); }} disabled={selectedIds.length === 0 || isAttachingObject}>
              {t('confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
