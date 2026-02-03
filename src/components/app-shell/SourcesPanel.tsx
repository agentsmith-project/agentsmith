'use client';

import * as React from 'react';
import { Plus, File, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { AIReadyStatusBadge } from '@/components/sources/AIReadyStatusBadge';
import { useSources } from '@/lib/hooks/use-sources';
import { PageLoading } from '@/components/ui/loading';
import { formatBytes } from '@/lib/utils/formatters';
import type { SourceFileWithAIReady } from '@/lib/api/types';

export interface SourcesPanelProps {
  workspaceId: string;
  projectId: string;
  attachedFileIds?: string[];
  onAttach?: (fileId: string) => void;
  onDetach?: (fileId: string) => void;
}

export function SourcesPanel({
  workspaceId,
  projectId,
  attachedFileIds = [],
  onAttach,
  onDetach,
}: SourcesPanelProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Query sources - only show ready files by default in sidebar
  const { data: sourcesData, isLoading } = useSources(workspaceId, projectId, {
    search: debouncedSearch || undefined,
    status: 'ready', // Only show ready files in sidebar
    page_size: 20, // Limit to 20 files in sidebar
  });

  const handleFileClick = (file: SourceFileWithAIReady) => {
    if (attachedFileIds.includes(file.id)) {
      onDetach?.(file.id);
    } else {
      onAttach?.(file.id);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
      </div>

      <div className="px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files..."
            className="pl-8 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <button
          className="w-full flex items-center gap-2 px-3 h-10 rounded-sm text-sm text-primary hover:bg-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => {
            // Open upload dialog - this would need to be handled by parent
            console.log('Upload clicked');
          }}
        >
          <Plus className="w-4 h-4" />
          Add Source
        </button>

        {isLoading ? (
          <PageLoading />
        ) : sourcesData?.items.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-tertiary">
            {search ? 'No files found' : 'No ready files'}
          </div>
        ) : (
          sourcesData?.items.map((file) => {
            const isAttached = attachedFileIds.includes(file.id);
            return (
              <div
                key={file.id}
                onClick={() => handleFileClick(file)}
                className={`
                  px-3 h-auto py-2 rounded-sm cursor-pointer transition-colors duration-200
                  ${isAttached ? 'bg-primary/10 border border-primary/30' : 'hover:bg-hover'}
                `}
              >
                <div className="flex items-center gap-2">
                  <File className="w-4 h-4 text-icon-default flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{file.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-tertiary">{formatBytes(file.file_size)}</span>
                      {file.ai_ready && (
                        <AIReadyStatusBadge
                          status={file.ai_ready.status}
                          className="text-[10px] px-1.5 py-0.5"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
