'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link2, Plus, Upload, X, File as FileIcon } from 'lucide-react';
import { useRemoveFile, useTaskAttachedFiles } from '@/lib/hooks/use-task';
import { AIReadyStatusBadge } from '@/components/files/AIReadyStatusBadge';
import { InputRefBadge } from '@/components/inputs/InputRefBadge';
import { EmptyState } from '@/components/ui/loading';
import { formatBytes } from '@/lib/utils/formatters';
import { getTaskAttachedInputKindLabel } from '@/lib/utils/input-ref-display';
// Simple file icon function - can be enhanced later
function getFileIcon(_fileType: string) {
  return FileIcon;
}
import type { TaskAttachedInputDetail } from '@/lib/types/task';

export interface AttachedFilesPanelProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  attachedInputIds: string[];
  onAddFromFiles: () => void;
  onAddFromLocal: () => void;
  onAddFromUrl: () => void;
  addingInput?: boolean;
}

export function AttachedFilesPanel({
  workspaceId,
  projectId,
  taskId,
  attachedInputIds: _attachedInputIds,
  onAddFromFiles,
  onAddFromLocal,
  onAddFromUrl,
  addingInput = false,
}: AttachedFilesPanelProps) {
  const t = useTranslations('notebook.attached_files');
  const removeFile = useRemoveFile();

  const { data: attachedFilesData } = useTaskAttachedFiles(workspaceId, projectId, taskId);
  const attachedFiles = React.useMemo(() => attachedFilesData ?? [], [attachedFilesData]);

  const handleRemove = async (inputId: string) => {
    await removeFile.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      inputId,
    });
  };

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="border-b border-white/6 px-2.5 py-1.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <span className="rounded-full bg-surface-high/40 px-1.5 py-0.5 text-[10px] text-tertiary">
            {attachedFiles.length}
          </span>
        </div>
        <p className="line-clamp-2 text-[10px] leading-4 text-tertiary">{t('subtitle')}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {attachedFiles.length === 0 ? (
          <div className="p-2.5">
            <EmptyState
              title={t('empty')}
              description={t('empty_description')}
            />
          </div>
        ) : (
          <div className="space-y-0.5 p-1.5">
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

      <div className="border-t border-white/6 px-1.5 py-1.5">
        <div className="grid grid-cols-3 gap-1">
          <Button variant="outline" size="sm" className="h-7 w-full px-1 text-[10px]" onClick={onAddFromFiles} disabled={addingInput}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            <span className="truncate">{t('add_files')}</span>
          </Button>
          <Button variant="outline" size="sm" className="h-7 w-full px-1 text-[10px]" onClick={onAddFromLocal} disabled={addingInput}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            <span className="truncate">{t('add_local')}</span>
          </Button>
          <Button variant="outline" size="sm" className="h-7 w-full px-1 text-[10px]" onClick={onAddFromUrl} disabled={addingInput}>
            <Link2 className="mr-1 h-3.5 w-3.5" />
            <span className="truncate">{t('add_url')}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

interface AttachedFileItemProps {
  file: TaskAttachedInputDetail;
  onRemove: () => void;
  removing: boolean;
}

function AttachedFileItem({ file, onRemove, removing }: AttachedFileItemProps) {
  const t = useTranslations('notebook.attached_files.tooltip');
  const FileIcon = getFileIcon(file.file_type);
  const aiReadyStatus = file.kind === 'source' ? file.ai_ready?.status : undefined;

  return (
    <div className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/[0.03]">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-surface-high/55">
        <FileIcon className="h-3.5 w-3.5 text-icon-default" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-[12px] leading-4 text-foreground">{file.filename}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-tertiary">{formatBytes(file.file_size)}</span>
          {aiReadyStatus && (
            <AIReadyStatusBadge status={aiReadyStatus} />
          )}
          <InputRefBadge label={getTaskAttachedInputKindLabel(file)} />
        </div>
      </div>
      <button
        onClick={onRemove}
        disabled={removing}
        className="rounded-md p-1 text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-high/60 hover:text-foreground disabled:opacity-50"
        aria-label={t('remove_file')}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
