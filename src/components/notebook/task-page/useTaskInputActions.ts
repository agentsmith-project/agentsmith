'use client';

import * as React from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Artifact } from '@/lib/types/task';
import type { FilesAPI, TaskAPI } from '@/lib/api';
import { ensureDefaultUploadLibrary } from '@/lib/files/default-library';
import { queryKeys } from '@/lib/query-keys';

type TaskInputPayload =
  | { kind: 'source'; source_id: string }
  | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
  | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
  | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number };

export function useTaskInputActions(args: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  filesAPI: FilesAPI;
  taskAPI: TaskAPI;
  queryClient: QueryClient;
  addFiles: UseMutationResult<unknown, unknown, { workspaceId: string; projectId: string; taskId: string; inputs: TaskInputPayload[] }, unknown>;
  handleError: (error: unknown, options?: { logContext?: string; showToast?: boolean }) => void;
}) {
  const { workspaceId, projectId, taskId, filesAPI, taskAPI, queryClient, addFiles, handleError } = args;

  const [fileSelectOpen, setFileSelectOpen] = React.useState(false);
  const [imageViewerOpen, setImageViewerOpen] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [addUrlOpen, setAddUrlOpen] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState('');
  const [addingInput, setAddingInput] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);
  const localFileInputRef = React.useRef<HTMLInputElement | null>(null);

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

  const uploadAndAttachFiles = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setAddingInput(true);
    try {
      const library = await ensureDefaultUploadLibrary({
        sourcesAPI: filesAPI,
        workspaceId,
        projectId,
      });
      const uploadedInputs: Array<Extract<TaskInputPayload, { kind: 'library_object' }>> = [];
      for (const file of files) {
        const uploaded = await filesAPI.uploadObject(
          workspaceId,
          projectId,
          library.id,
          file,
          `notebook/${taskId}/inputs`,
          true,
        );
        uploadedInputs.push({
          kind: 'library_object',
          library_id: library.id,
          key: uploaded.key,
          name: uploaded.name,
          content_type: uploaded.content_type,
          size_bytes: uploaded.size_bytes,
        });
      }
      if (uploadedInputs.length > 0) {
        await handleAddFiles(uploadedInputs);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
        });
      }
    } finally {
      setAddingInput(false);
    }
  }, [filesAPI, handleAddFiles, projectId, queryClient, taskId, workspaceId]);

  const handleLocalInputChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadAndAttachFiles(files);
  }, [uploadAndAttachFiles]);

  const handleSubmitUrlInput = React.useCallback(async () => {
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
    setAddingInput(true);
    try {
      const library = await ensureDefaultUploadLibrary({
        sourcesAPI: filesAPI,
        workspaceId,
        projectId,
      });
      const uploaded = await filesAPI.uploadObject(
        workspaceId,
        projectId,
        library.id,
        file,
        `notebook/${taskId}/inputs`,
        true,
      );
      await handleAddFiles([{
        kind: 'url',
        url: normalized,
        name: uploaded.name,
        imported_library_id: library.id,
        imported_key: uploaded.key,
        content_type: uploaded.content_type,
        size_bytes: uploaded.size_bytes,
      }]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
      });
    } finally {
      setAddingInput(false);
    }
    setUrlInput('');
    setAddUrlOpen(false);
  }, [filesAPI, handleAddFiles, projectId, queryClient, taskId, urlInput, workspaceId]);

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
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(workspaceId, projectId),
      });
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.saveArtifactToLibrary' });
    }
  }, [handleError, projectId, queryClient, selectedArtifact, taskAPI, taskId, workspaceId]);

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
    localFileInputRef,
    handleAddFiles,
    handleAttachArtifactAsInput,
    handleLocalInputChange,
    handleSubmitUrlInput,
    handleViewArtifact,
    handleSaveArtifact,
    handleDownloadArtifact,
    handleSaveArtifactToLibrary,
  };
}
