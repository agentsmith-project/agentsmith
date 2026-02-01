'use client';

import { Plus, File } from 'lucide-react';
import { useState } from 'react';

export function SourcesPanel() {
  const [sources, setSources] = useState([
    { id: '1', name: 'Document.pdf' },
    { id: '2', name: 'Notes.txt' },
  ]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-foreground-secondary hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => {}}
        >
          <Plus className="w-4 h-4" />
          Add Source
        </button>

        {sources.map(source => (
          <div
            key={source.id}
            className="px-3 py-2 rounded hover:bg-surface-hover cursor-pointer transition-colors duration-200"
          >
            <div className="flex items-center gap-2">
              <File className="w-4 h-4 text-foreground-muted" />
              <span className="text-sm text-foreground truncate">{source.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
