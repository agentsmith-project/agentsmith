'use client';

import * as React from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Artifact } from '@/lib/types/task';
import type { TaskAPI } from '@/lib/api';

type TaskInputPayload =
  | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
  | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
  | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number };

export function useTaskInputActions(args: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  taskAPI: TaskAPI;
  addFiles: UseMutationResult<unknown, unknown, { workspaceId: string; projectId: string; taskId: string; inputs: TaskInputPayload[] }, unknown>;
  handleError: (error: unknown, options?: { logContext?: string; showToast?: boolean }) => void;
}) {
  const { workspaceId, projectId, taskId, taskAPI, addFiles, handleError } = args;

  const [fileSelectOpen, setFileSelectOpen] = React.useState(false);
  const [imageViewerOpen, setImageViewerOpen] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [addUrlOpen, setAddUrlOpen] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState('');
  const [addingInput, setAddingInput] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);

  const handleAddFiles = React.useCallback(async (inputs: TaskInputPayload[]) => {
    await addFiles.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      inputs,
    });
  }, [addFiles, projectId, taskId, workspaceId]);

  const handleAttachArtifactAsInput = React.useCallback(async (artifact: Artifact) => {
    if (addingInput) return;
    setAddingInput(true);
    try {
      await handleAddFiles([{
        kind: 'artifact',
        task_id: taskId,
        artifact_id: artifact.id,
        ...(artifact.task_relative_path ? { task_relative_path: artifact.task_relative_path } : {}),
        ...(artifact.title ? { name: artifact.title } : {}),
        ...(artifact.mime_type ? { content_type: artifact.mime_type } : {}),
        ...(typeof artifact.file_size === 'number' ? { size_bytes: artifact.file_size } : {}),
      }]);
    } finally {
      setAddingInput(false);
    }
  }, [addingInput, handleAddFiles, taskId]);

  const handleSubmitUrlInput = React.useCallback(async () => {
    setUrlInput('');
    setAddUrlOpen(false);
  }, []);

  const handleViewArtifact = React.useCallback((artifact: Artifact) => {
    if (artifact.type === 'image') {
      setSelectedArtifact(artifact);
      setImageViewerOpen(true);
    }
  }, []);

  const handleSaveArtifact = React.useCallback((artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setSaveDialogOpen(true);
  }, []);

  const handleDownloadArtifact = React.useCallback(async (artifact: Artifact) => {
    try {
      const blob = await taskAPI.downloadArtifact(workspaceId, projectId, taskId, artifact.id);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.title || `artifact-${artifact.id}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.downloadArtifact' });
    }
  }, [handleError, projectId, taskAPI, taskId, workspaceId]);

  const handleSaveArtifactToLibrary = React.useCallback(async (filename?: string, description?: string) => {
    if (!selectedArtifact) return;
    try {
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
      setSaveDialogOpen(false);
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.saveArtifactToLibrary' });
    }
  }, [handleError, projectId, selectedArtifact, taskAPI, taskId, workspaceId]);

  return {
    fileSelectOpen,
    setFileSelectOpen,
    imageViewerOpen,
    setImageViewerOpen,
    saveDialogOpen,
    setSaveDialogOpen,
    addUrlOpen,
    setAddUrlOpen,
    urlInput,
    setUrlInput,
    addingInput,
    selectedArtifact,
    handleAttachArtifactAsInput,
    handleSubmitUrlInput,
    handleViewArtifact,
    handleSaveArtifact,
    handleDownloadArtifact,
    handleSaveArtifactToLibrary,
  };
}
