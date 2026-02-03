'use client';
import * as React from 'react';
import { RecipeHeader } from './RecipeHeader';
import { AttachedSourcesPanel } from './AttachedSourcesPanel';
import { ConversationPanel } from './ConversationPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { SourceSelectDialog } from './SourceSelectDialog';
import { ArtifactImageViewer } from './ArtifactImageViewer';
import { ArtifactSaveDialog } from './ArtifactSaveDialog';
import { RecipeCreateDialog } from './RecipeCreateDialog';
import { useRecipe, useRecipeMessages, useRecipeArtifacts, useSendMessage, useAddSources } from '@/lib/hooks/use-recipe';
import { useRecipeSSE } from '@/lib/hooks/use-recipe-sse';
import { useErrorHandler } from '@/lib/hooks/use-error-handler';
import { RecipeAPI } from '@/lib/api';
import { getApiClient } from '@/lib/api';
import type { Artifact, RecipeMessage } from '@/lib/types/recipe';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

export interface RecipePageProps {
  workspaceId: string;
  projectId: string;
  recipeId: string;
}

export function RecipePage({ workspaceId, projectId, recipeId }: RecipePageProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const [sourceSelectOpen, setSourceSelectOpen] = React.useState(false);
  const [imageViewerOpen, setImageViewerOpen] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);
  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [streamingContent, setStreamingContent] = React.useState<string>('');

  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();
  const { data: recipe, isLoading: recipeLoading } = useRecipe(workspaceId, projectId, recipeId);
  const { data: messages } = useRecipeMessages(workspaceId, projectId, recipeId);
  const { data: artifacts } = useRecipeArtifacts(workspaceId, projectId, recipeId);
  const sendMessage = useSendMessage();
  const addSources = useAddSources();

  // SSE connection for real-time updates
  useRecipeSSE(workspaceId, projectId, recipeId, {
    onMessage: (message: RecipeMessage) => {
      // Check if this is a streaming update (message with partial content)
      if (streamingMessageId === message.id) {
        setStreamingContent(message.content);
        // If message is complete, clear streaming state
        if (message.content && !message.content.endsWith('…')) {
          setStreamingMessageId(null);
          setStreamingContent('');
        }
      }

      queryClient.setQueryData(
        ['recipe-messages', workspaceId, projectId, recipeId],
        (old: RecipeMessage[] | undefined) => {
          if (!old) return [message];
          // Check if message already exists
          if (old.some((m) => m.id === message.id)) {
            return old.map((m) => (m.id === message.id ? message : m));
          }
          return [...old, message];
        },
      );
    },
    onArtifact: (artifact: Artifact) => {
      queryClient.setQueryData(
        ['recipe-artifacts', workspaceId, projectId, recipeId],
        (old: Artifact[] | undefined) => {
          if (!old) return [artifact];
          // Check if artifact already exists
          if (old.some((a) => a.id === artifact.id)) {
            return old.map((a) => (a.id === artifact.id ? artifact : a));
          }
          return [...old, artifact];
        },
      );
    },
    onRecipeUpdate: (updatedRecipe) => {
      queryClient.setQueryData(
        ['recipe', workspaceId, projectId, recipeId],
        updatedRecipe,
      );
    },
    enabled: !!recipeId && !recipeLoading,
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
        recipeId,
        data: {
          recipe_id: recipeId,
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
      handleError(err, { logContext: 'RecipePage.sendMessage' });
    }
  };

  const handleAddSources = async (sourceIds: string[]) => {
    await addSources.mutateAsync({
      workspaceId,
      projectId,
      recipeId,
      sourceIds,
    });
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
      const recipeAPI = new RecipeAPI(getApiClient());
      const blob = await recipeAPI.downloadArtifact(workspaceId, projectId, recipeId, artifact.id);
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.title || `artifact-${artifact.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleError(err, { logContext: 'RecipePage.downloadArtifact' });
    }
  };

  const handleSaveArtifactToLibrary = async (filename?: string, description?: string) => {
    if (!selectedArtifact) return;

    try {
      const recipeAPI = new RecipeAPI(getApiClient());
      await recipeAPI.saveArtifact(
        workspaceId,
        projectId,
        recipeId,
        selectedArtifact.id,
        {
          artifact_id: selectedArtifact.id,
          filename: filename || selectedArtifact.title,
          description,
        },
      );

      // Show success notification (you could add a toast here)
      setSaveDialogOpen(false);

      // Optionally refresh sources list
      queryClient.invalidateQueries({
        queryKey: ['sources', workspaceId, projectId],
      });
    } catch (err) {
      handleError(err, { logContext: 'RecipePage.saveArtifactToLibrary' });
    }
  };

  const handleCreateNew = () => {
    setCreateDialogOpen(true);
  };

  const handleRecipeCreated = (newRecipeId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/workbench/recipes/${newRecipeId}`);
  };

  const handleRecipeDeleted = () => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/workbench`);
  };

  const handleLeave = () => {
    // Navigate to workbench list
    // SSE connection will be automatically cleaned up when component unmounts
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/workbench`);
  };

  if (recipeLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-tertiary">Loading recipe...</div>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">Recipe not found</h2>
          <p className="text-sm text-tertiary mb-4">The recipe you're looking for doesn't exist or has been deleted.</p>
          <button
            onClick={() => router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/workbench`)}
            className="text-sm text-accent hover:underline"
          >
            Go back to Workbench
          </button>
        </div>
      </div>
    );
  }

  const isDisabled = recipe.status === 'closed' || recipe.status === 'archived';

  return (
    <div className="h-full flex flex-col">
      <RecipeHeader
        recipe={recipe}
        workspaceId={workspaceId}
        projectId={projectId}
        onCreateNew={handleCreateNew}
        onDeleted={handleRecipeDeleted}
        onLeave={handleLeave}
      />
      <div className="flex-1 flex min-h-0">
        <div className="w-[260px] flex-shrink-0">
          <AttachedSourcesPanel
            workspaceId={workspaceId}
            projectId={projectId}
            recipeId={recipeId}
            attachedSourceIds={recipe.attached_source_ids}
            onAddClick={() => setSourceSelectOpen(true)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <ConversationPanel
            messages={messages || []}
            streamingMessageId={streamingMessageId}
            streamingContent={streamingContent}
            onSendMessage={handleSendMessage}
            disabled={isDisabled}
            sending={sendMessage.isPending}
          />
        </div>
        <div className="w-[320px] flex-shrink-0">
          <ArtifactsPanel
            artifacts={artifacts || []}
            onView={handleViewArtifact}
            onSave={handleSaveArtifact}
            onDownload={handleDownloadArtifact}
            disabled={isDisabled}
          />
        </div>
      </div>

      <SourceSelectDialog
        open={sourceSelectOpen}
        onOpenChange={setSourceSelectOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onConfirm={handleAddSources}
        excludeIds={recipe.attached_source_ids}
      />

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

      <RecipeCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={handleRecipeCreated}
      />
    </div>
  );
}
