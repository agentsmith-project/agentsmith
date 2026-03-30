'use client';

import type { Artifact, Task } from '@/lib/types/task';

import { ArtifactImageViewer } from '../ArtifactImageViewer';
import { EditTaskDialog } from '../EditTaskDialog';
import { TaskCreateDialog } from '../TaskCreateDialog';

interface TaskPageDialogsProps {
  canCreateTask: boolean;
  canUpdateTask: boolean;
  createDialogOpen: boolean;
  editDialogOpen: boolean;
  imageViewerOpen: boolean;
  projectId: string;
  savingTask: boolean;
  selectedArtifact: Artifact | null;
  tCommon: (key: string) => string;
  task: Task;
  workspaceId: string;
  onArtifactDownload: (artifact: Artifact) => void | Promise<void>;
  onEditDialogOpenChange: (open: boolean) => void;
  onHandleTaskUpdated: (data: { title: string }) => void | Promise<void>;
  onImageViewerOpenChange: (open: boolean) => void;
  onSetCreateDialogOpen: (open: boolean) => void;
  onTaskCreated: (taskId: string) => void;
}

export function TaskPageDialogs({
  canCreateTask,
  canUpdateTask,
  createDialogOpen,
  editDialogOpen,
  imageViewerOpen,
  projectId,
  savingTask,
  selectedArtifact,
  tCommon: _tCommon,
  task,
  workspaceId,
  onArtifactDownload,
  onEditDialogOpenChange,
  onHandleTaskUpdated,
  onImageViewerOpenChange,
  onSetCreateDialogOpen,
  onTaskCreated,
}: TaskPageDialogsProps) {
  return (
    <>
      <ArtifactImageViewer
        open={imageViewerOpen}
        onOpenChange={onImageViewerOpenChange}
        artifact={selectedArtifact}
        onDownload={selectedArtifact ? () => onArtifactDownload(selectedArtifact) : undefined}
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
