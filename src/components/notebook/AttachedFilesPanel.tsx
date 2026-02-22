'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link2, Plus, Upload, X, File as FileIcon } from 'lucide-react';
import { useRemoveFile, useTaskAttachedFiles } from '@/lib/hooks/use-task';
import { AIReadyStatusBadge } from '@/components/files/AIReadyStatusBadge';
import { EmptyState } from '@/components/ui/loading';
import { formatBytes } from '@/lib/utils/formatters';
// Simple file icon function - can be enhanced later
function getFileIcon(_fileType: string) {
  return FileIcon;
}
import type { FileItemWithAIReady } from '@/lib/api/types';

export interface AttachedFilesPanelProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  attachedFileIds: string[];
  onAddFromFiles: () => void;
  onAddFromLocal: () => void;
  onAddFromUrl: () => void;
  addingInput?: boolean;
}

export function AttachedFilesPanel({
  workspaceId,
  projectId,
  taskId,
  attachedFileIds: _attachedFileIds,
  onAddFromFiles,
  onAddFromLocal,
  onAddFromUrl,
  addingInput = false,
}: AttachedFilesPanelProps) {
  const t = useTranslations('notebook.attached_files');
  const removeFile = useRemoveFile();

  const { data: attachedFilesData } = useTaskAttachedFiles(workspaceId, projectId, taskId);
  const attachedFiles = React.useMemo(() => attachedFilesData ?? [], [attachedFilesData]);

  const handleRemove = async (fileId: string) => {
    await removeFile.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      fileId,
    });
  };

  return (
    <div className="h-full flex flex-col bg-surface border-r border-subtle">
      <div className="p-4 border-b border-subtle">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        </div>
        <p className="text-xs text-tertiary">{t('subtitle')}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {attachedFiles.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('empty')}
              description={t('empty_description')}
            />
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {attachedFiles.map((file) => (
              <AttachedFileItem
                key={file.id}
                file={file}
                onRemove={() => handleRemove(file.id)}
                removing={removeFile.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-subtle">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" className="w-full" onClick={onAddFromFiles} disabled={addingInput}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t('add_files')}
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={onAddFromLocal} disabled={addingInput}>
            <Upload className="h-4 w-4 mr-1.5" />
            {t('add_local')}
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={onAddFromUrl} disabled={addingInput}>
            <Link2 className="h-4 w-4 mr-1.5" />
            {t('add_url')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface AttachedFileItemProps {
  file: FileItemWithAIReady;
  onRemove: () => void;
  removing: boolean;
}

function AttachedFileItem({ file, onRemove, removing }: AttachedFileItemProps) {
  const t = useTranslations('notebook.attached_files.tooltip');
  const FileIcon = getFileIcon(file.file_type);

  return (
    <div className="group flex items-center gap-3 p-3 rounded-sm hover:bg-hover transition-colors">
      <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center flex-shrink-0">
        <FileIcon className="w-4 h-4 text-icon-default" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{file.filename}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-tertiary">{formatBytes(file.file_size)}</span>
          {file.ai_ready && (
            <AIReadyStatusBadge status={file.ai_ready.status} />
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        disabled={removing}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-sm hover:bg-surface-high text-tertiary hover:text-foreground disabled:opacity-50"
        aria-label={t('remove_file')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
