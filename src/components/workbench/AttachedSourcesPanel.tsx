'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, File as FileIcon } from 'lucide-react';
import { useRemoveSource } from '@/lib/hooks/use-recipe';
import { useSources } from '@/lib/hooks/use-sources';
import { AIReadyStatusBadge } from '@/components/sources/AIReadyStatusBadge';
import { EmptyState } from '@/components/ui/loading';
import { formatBytes } from '@/lib/utils/formatters';
// Simple file icon function - can be enhanced later
function getFileIcon(fileType: string) {
  return FileIcon;
}
import type { SourceFile } from '@/lib/api/types';

export interface AttachedSourcesPanelProps {
  workspaceId: string;
  projectId: string;
  recipeId: string;
  attachedSourceIds: string[];
  onAddClick: () => void;
}

export function AttachedSourcesPanel({
  workspaceId,
  projectId,
  recipeId,
  attachedSourceIds,
  onAddClick,
}: AttachedSourcesPanelProps) {
  const removeSource = useRemoveSource();

  // Fetch all sources to get details for attached ones
  const { data: sourcesData } = useSources(workspaceId, projectId, {
    page_size: 1000, // Get all sources
  });

  // Filter to only attached sources
  const attachedSources = React.useMemo(() => {
    if (!sourcesData?.items) return [];
    return sourcesData.items.filter((source) => attachedSourceIds.includes(source.id));
  }, [sourcesData?.items, attachedSourceIds]);

  const handleRemove = async (sourceId: string) => {
    await removeSource.mutateAsync({
      workspaceId,
      projectId,
      recipeId,
      sourceId,
    });
  };

  return (
    <div className="h-full flex flex-col bg-surface border-r border-subtle">
      <div className="p-4 border-b border-subtle">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground">Attached Sources</h2>
        </div>
        <p className="text-xs text-tertiary">Files attached to this recipe</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {attachedSources.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No sources attached"
              description="Add AIReady files from your library to provide context for the agent"
            />
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {attachedSources.map((source) => (
              <AttachedSourceItem
                key={source.id}
                source={source}
                onRemove={() => handleRemove(source.id)}
                removing={removeSource.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-subtle">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onAddClick}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Sources
        </Button>
      </div>
    </div>
  );
}

interface AttachedSourceItemProps {
  source: SourceFile;
  onRemove: () => void;
  removing: boolean;
}

function AttachedSourceItem({ source, onRemove, removing }: AttachedSourceItemProps) {
  const FileIcon = getFileIcon(source.file_type);

  return (
    <div className="group flex items-center gap-3 p-3 rounded-sm hover:bg-hover transition-colors">
      <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center flex-shrink-0">
        <FileIcon className="w-4 h-4 text-icon-default" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{source.filename}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-tertiary">{formatBytes(source.file_size)}</span>
          {source.ai_ready && (
            <AIReadyStatusBadge status={source.ai_ready.status} />
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        disabled={removing}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-sm hover:bg-surface-high text-tertiary hover:text-foreground disabled:opacity-50"
        aria-label="Remove source"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
