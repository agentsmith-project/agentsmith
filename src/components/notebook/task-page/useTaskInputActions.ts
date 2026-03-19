'use client';

import * as React from 'react';
import type { Artifact } from '@/lib/types/task';
import type { TaskAPI } from '@/lib/api';

export function useTaskInputActions(args: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  taskAPI: TaskAPI;
  handleError: (error: unknown, options?: { logContext?: string; showToast?: boolean }) => void;
}) {
  const { workspaceId, projectId, taskId, taskAPI, handleError } = args;

  const [imageViewerOpen, setImageViewerOpen] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);

  const handleViewArtifact = React.useCallback((artifact: Artifact) => {
    if (artifact.type === 'image') {
      setSelectedArtifact(artifact);
      setImageViewerOpen(true);
    }
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

  return {
    imageViewerOpen,
    setImageViewerOpen,
    selectedArtifact,
    handleViewArtifact,
    handleDownloadArtifact,
  };
}
