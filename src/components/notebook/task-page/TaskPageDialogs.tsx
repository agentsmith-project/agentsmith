'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import type { Artifact, Task } from '@/lib/types/task';
import type { FileSelectDialogProps } from '../FileSelectDialog';

import { ArtifactImageViewer } from '../ArtifactImageViewer';
import { ArtifactSaveDialog } from '../ArtifactSaveDialog';
import { EditTaskDialog } from '../EditTaskDialog';
import { FileSelectDialog } from '../FileSelectDialog';
import { TaskCreateDialog } from '../TaskCreateDialog';

interface TaskPageDialogsProps {
  addUrlOpen: boolean;
  addingInput: boolean;
  canCreateTask: boolean;
  canUpdateTask: boolean;
  createDialogOpen: boolean;
  editDialogOpen: boolean;
  fileSelectOpen: boolean;
  imageViewerOpen: boolean;
  localFileInputRef: React.RefObject<HTMLInputElement | null>;
  projectId: string;
  saveDialogOpen: boolean;
  savingTask: boolean;
  selectedArtifact: Artifact | null;
  t: (key: string) => string;
  tCommon: (key: string) => string;
  task: Task;
  urlInput: string;
  workspaceId: string;
  onAddFilesConfirm: FileSelectDialogProps['onConfirm'];
  onArtifactDownload: (artifact: Artifact) => void | Promise<void>;
  onArtifactSaveToLibrary: (filename?: string, description?: string) => void | Promise<void>;
  onEditDialogOpenChange: (open: boolean) => void;
  onFileSelectOpenChange: (open: boolean) => void;
  onHandleTaskUpdated: (data: { title: string }) => void | Promise<void>;
  onImageViewerOpenChange: (open: boolean) => void;
  onLocalInputChange: React.ChangeEventHandler<HTMLInputElement>;
  onSaveDialogOpenChange: (open: boolean) => void;
  onSetAddUrlOpen: (open: boolean) => void;
  onSetCreateDialogOpen: (open: boolean) => void;
  onSetUrlInput: (value: string) => void;
  onSubmitUrlInput: () => void | Promise<void>;
  onTaskCreated: (taskId: string) => void;
}

export function TaskPageDialogs({
  addUrlOpen,
  addingInput,
  canCreateTask,
  canUpdateTask,
  createDialogOpen,
  editDialogOpen,
  fileSelectOpen,
  imageViewerOpen,
  localFileInputRef,
  projectId,
  saveDialogOpen,
  savingTask,
  selectedArtifact,
  t,
  tCommon,
  task,
  urlInput,
  workspaceId,
  onAddFilesConfirm,
  onArtifactDownload,
  onArtifactSaveToLibrary,
  onEditDialogOpenChange,
  onFileSelectOpenChange,
  onHandleTaskUpdated,
  onImageViewerOpenChange,
  onLocalInputChange,
  onSaveDialogOpenChange,
  onSetAddUrlOpen,
  onSetCreateDialogOpen,
  onSetUrlInput,
  onSubmitUrlInput,
  onTaskCreated,
}: TaskPageDialogsProps) {
  return (
    <>
      <FileSelectDialog
        open={fileSelectOpen}
        onOpenChange={onFileSelectOpenChange}
        workspaceId={workspaceId}
        projectId={projectId}
        onConfirm={onAddFilesConfirm}
        excludeIds={task.attached_inputs.filter((item) => item.kind === 'source').map((item) => item.source_id)}
      />

      <input
        ref={localFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onLocalInputChange}
      />

      <Dialog open={addUrlOpen} onOpenChange={onSetAddUrlOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <Input
            value={urlInput}
            onChange={(event) => onSetUrlInput(event.target.value)}
            placeholder={t('placeholder')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onSetAddUrlOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={onSubmitUrlInput}
              disabled={addingInput || !/^https?:\/\//i.test(urlInput.trim())}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ArtifactImageViewer
        open={imageViewerOpen}
        onOpenChange={onImageViewerOpenChange}
        artifact={selectedArtifact}
        onDownload={selectedArtifact ? () => onArtifactDownload(selectedArtifact) : undefined}
      />

      <ArtifactSaveDialog
        open={saveDialogOpen}
        onOpenChange={onSaveDialogOpenChange}
        artifact={selectedArtifact}
        onSave={onArtifactSaveToLibrary}
      />

      <TaskCreateDialog
        open={canCreateTask && createDialogOpen}
        onOpenChange={onSetCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={onTaskCreated}
      />

      <EditTaskDialog
        open={canUpdateTask && editDialogOpen}
        onOpenChange={onEditDialogOpenChange}
        task={task}
        saving={savingTask}
        onSubmit={onHandleTaskUpdated}
      />
    </>
  );
}
