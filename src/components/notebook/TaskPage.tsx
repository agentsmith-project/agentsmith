'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { TaskHeader } from './TaskHeader';
import { AttachedFilesPanel } from './AttachedFilesPanel';
import { ConversationPanel } from './ConversationPanel';
import { NotebookSseDebugPanel } from './NotebookSseDebugPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { FileSelectDialog } from './FileSelectDialog';
import { ArtifactImageViewer } from './ArtifactImageViewer';
import { ArtifactSaveDialog } from './ArtifactSaveDialog';
import { TaskCreateDialog } from './TaskCreateDialog';
import { EditTaskDialog } from './EditTaskDialog';
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
import { useTask, useTaskMessages, useTaskArtifacts, useSendMessage, useAddFiles, useUpdateTask } from '@/lib/hooks/use-task';
import { useTaskSSE } from '@/lib/hooks/use-task-sse';
import type { TaskSSEDebugEvent } from '@/lib/hooks/use-task-sse';
import { useErrorHandler } from '@/lib/hooks/use-error-handler';
import { TaskAPI, FilesAPI } from '@/lib/api';
import { getApiClient } from '@/lib/api';
import type { Artifact, TaskMessage } from '@/lib/types/task';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';

export interface TaskPageProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canCreateTask: boolean;
  canUpdateTask: boolean;
  canDeleteTask: boolean;
}

export function TaskPage({
  workspaceId,
  projectId,
  taskId,
  canCreateTask,
  canUpdateTask,
  canDeleteTask,
}: TaskPageProps) {
  const t = useTranslations('notebook.attached_files.url_dialog');
  const tTask = useTranslations('notebook.task');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const [fileSelectOpen, setFileSelectOpen] = React.useState(false);
  const [imageViewerOpen, setImageViewerOpen] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [addUrlOpen, setAddUrlOpen] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState('');
  const [addingInput, setAddingInput] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);
  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [streamingContent, setStreamingContent] = React.useState<string>('');
  const [sseDebugEvents, setSseDebugEvents] = React.useState<TaskSSEDebugEvent[]>([]);

  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();
  const filesAPI = React.useMemo(() => new FilesAPI(getApiClient()), []);
  const localFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const { data: task, isLoading: taskLoading } = useTask(workspaceId, projectId, taskId);
  const { data: messages } = useTaskMessages(workspaceId, projectId, taskId);
  const { data: artifacts } = useTaskArtifacts(workspaceId, projectId, taskId);
  const sendMessage = useSendMessage();
  const addFiles = useAddFiles();
  const updateTask = useUpdateTask();

  // Query keys for this task — used by both useQuery hooks and SSE cache writes
  const messagesKey = queryKeys.tasks.messages(workspaceId, projectId, taskId);
  const artifactsKey = queryKeys.tasks.artifacts(workspaceId, projectId, taskId);
  const taskDetailKey = queryKeys.tasks.detail(workspaceId, projectId, taskId);

  // SSE connection for real-time updates
  const isDev = process.env.NODE_ENV === 'development';
  const { connectionStatus } = useTaskSSE(workspaceId, projectId, taskId, {
    onMessage: (message: TaskMessage) => {
      // Update streaming content for the active streaming message
      if (streamingMessageId === message.id) {
        setStreamingContent(message.content);
      }

      queryClient.setQueryData(
        messagesKey,
        (old: TaskMessage[] | undefined) => {
          if (!old) return [message];
          if (old.some((m) => m.id === message.id)) {
            return old.map((m) => (m.id === message.id ? message : m));
          }
          return [...old, message];
        },
      );
    },
    onArtifact: (artifact: Artifact) => {
      queryClient.setQueryData(
        artifactsKey,
        (old: Artifact[] | undefined) => {
          if (!old) return [artifact];
          if (old.some((a) => a.id === artifact.id)) {
            return old.map((a) => (a.id === artifact.id ? artifact : a));
          }
          return [...old, artifact];
        },
      );
    },
    onTaskUpdate: (updatedTask) => {
      // Task update signals agent completion — clear streaming state
      setStreamingMessageId(null);
      setStreamingContent('');

      queryClient.setQueryData(taskDetailKey, updatedTask);
    },
    onDebug: isDev
      ? (event) => {
          setSseDebugEvents((prev) => [...prev.slice(-4), event]);
        }
      : undefined,
    enabled: !!taskId && !taskLoading,
  });

  const handleSendMessage = async (content: string) => {
    try {
      // Clear previous streaming state
      setStreamingMessageId(null);
      setStreamingContent('');

      // Send message and get response
      const response = await sendMessage.mutateAsync({
        workspaceId,
        projectId,
        taskId,
        data: {
          task_id: taskId,
          content,
        },
      });

      // If response indicates streaming, set up streaming state
      // The actual streaming content will come through SSE
      if (response.role === 'agent') {
        setStreamingMessageId(response.id);
        setStreamingContent('');
      }
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.sendMessage' });
    }
  };

  const handleAddFiles = async (fileIds: string[]) => {
    await addFiles.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      fileIds,
    });
  };

  const uploadAndAttachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAddingInput(true);
    try {
      const uploadedIds: string[] = [];
      for (const file of files) {
        const uploaded = await filesAPI.upload(workspaceId, projectId, file);
        uploadedIds.push(uploaded.id);
      }
      if (uploadedIds.length > 0) {
        await handleAddFiles(uploadedIds);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.files.list(workspaceId, projectId),
        });
      }
    } finally {
      setAddingInput(false);
    }
  };

  const handleLocalInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadAndAttachFiles(files);
  };

  const handleSubmitUrlInput = async () => {
    const normalized = urlInput.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) return;

    const fileSafeName = normalized
      .replace(/^https?:\/\//i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 64);
    const filename = `${fileSafeName || 'url_input'}.url.txt`;
    const content = `URL input\n${normalized}\n`;
    const file = new File([content], filename, { type: 'text/plain' });
    await uploadAndAttachFiles([file]);
    setUrlInput('');
    setAddUrlOpen(false);
  };

  const handleViewArtifact = (artifact: Artifact) => {
    if (artifact.type === 'image') {
      setSelectedArtifact(artifact);
      setImageViewerOpen(true);
    }
  };

  const handleSaveArtifact = (artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setSaveDialogOpen(true);
  };

  const handleDownloadArtifact = async (artifact: Artifact) => {
    try {
      const taskAPI = new TaskAPI(getApiClient());
      const blob = await taskAPI.downloadArtifact(workspaceId, projectId, taskId, artifact.id);
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.title || `artifact-${artifact.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.downloadArtifact' });
    }
  };

  const handleSaveArtifactToLibrary = async (filename?: string, description?: string) => {
    if (!selectedArtifact) return;

    try {
      const taskAPI = new TaskAPI(getApiClient());
      await taskAPI.saveArtifact(
        workspaceId,
        projectId,
        taskId,
        selectedArtifact.id,
        {
          artifact_id: selectedArtifact.id,
          filename: filename || selectedArtifact.title,
          description,
        },
      );

      // Show success notification (you could add a toast here)
      setSaveDialogOpen(false);

      // Refresh files list
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(workspaceId, projectId),
      });
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.saveArtifactToLibrary' });
    }
  };

  const handleCreateNew = () => {
    setCreateDialogOpen(true);
  };

  const handleTaskCreated = (newTaskId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${newTaskId}`);
  };

  const handleTaskDeleted = () => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
  };

  const handleTaskUpdated = async (data: { title: string; status: 'active' | 'closed' | 'archived' }) => {
    await updateTask.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      data,
    });
  };

  const handleLeave = () => {
    // Navigate to notebook list
    // SSE connection will be automatically cleaned up when component unmounts
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
  };

  if (taskLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-tertiary">{tTask('loading')}</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">{tTask('not_found_title')}</h2>
          <p className="text-sm text-tertiary mb-4">{tTask('not_found_description')}</p>
          <button
            onClick={() => router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`)}
            className="text-sm text-accent hover:underline"
          >
            {tTask('back_to_notebook')}
          </button>
        </div>
      </div>
    );
  }

  const isDisabled = task.status === 'closed' || task.status === 'archived';

  return (
    <div className="h-full flex flex-col">
      <TaskHeader
        task={task}
        workspaceId={workspaceId}
        projectId={projectId}
        canDeleteTask={canDeleteTask}
        onCreateNew={canCreateTask ? handleCreateNew : undefined}
        onEdit={canUpdateTask ? () => setEditDialogOpen(true) : undefined}
        onDeleted={handleTaskDeleted}
        onLeave={handleLeave}
      />
      <div className="flex-1 flex min-h-0">
        <div className="w-[232px] flex-shrink-0">
          <AttachedFilesPanel
            workspaceId={workspaceId}
            projectId={projectId}
            taskId={taskId}
            attachedFileIds={task.attached_source_ids}
            addingInput={addingInput}
            onAddFromFiles={() => {
              if (!canUpdateTask) return;
              setFileSelectOpen(true);
            }}
            onAddFromLocal={() => {
              if (!canUpdateTask || addingInput) return;
              localFileInputRef.current?.click();
            }}
            onAddFromUrl={() => {
              if (!canUpdateTask || addingInput) return;
              setAddUrlOpen(true);
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          {isDev && <NotebookSseDebugPanel events={sseDebugEvents} />}
          <ConversationPanel
            messages={messages || []}
            streamingMessageId={streamingMessageId}
            streamingContent={streamingContent}
            connectionStatus={connectionStatus}
            onSendMessage={handleSendMessage}
            disabled={isDisabled || !canUpdateTask}
            sending={sendMessage.isPending}
          />
        </div>
        <div className="w-[288px] flex-shrink-0">
          <ArtifactsPanel
            artifacts={artifacts || []}
            onView={handleViewArtifact}
            onSave={handleSaveArtifact}
            onDownload={handleDownloadArtifact}
            disabled={isDisabled || !canUpdateTask}
          />
        </div>
      </div>

      <FileSelectDialog
        open={fileSelectOpen}
        onOpenChange={setFileSelectOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onConfirm={handleAddFiles}
        excludeIds={task.attached_source_ids}
      />

      <input
        ref={localFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleLocalInputChange}
      />

      <Dialog open={addUrlOpen} onOpenChange={setAddUrlOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={t('placeholder')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddUrlOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handleSubmitUrlInput}
              disabled={addingInput || !/^https?:\/\//i.test(urlInput.trim())}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ArtifactImageViewer
        open={imageViewerOpen}
        onOpenChange={setImageViewerOpen}
        artifact={selectedArtifact}
        onDownload={selectedArtifact ? () => handleDownloadArtifact(selectedArtifact) : undefined}
      />

      <ArtifactSaveDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        artifact={selectedArtifact}
        onSave={handleSaveArtifactToLibrary}
      />

      <TaskCreateDialog
        open={canCreateTask && createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={handleTaskCreated}
      />

      <EditTaskDialog
        open={canUpdateTask && editDialogOpen}
        onOpenChange={setEditDialogOpen}
        task={task}
        saving={updateTask.isPending}
        onSubmit={handleTaskUpdated}
      />
    </div>
  );
}
