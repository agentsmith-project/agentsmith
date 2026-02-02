'use client';
import * as React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Artifact } from '@/lib/types/recipe';
import { cn } from '@/lib/utils';

export interface ArtifactImageGridProps {
  artifacts: Artifact[];
  onImageClick: (artifact: Artifact) => void;
}

export function ArtifactImageGrid({ artifacts, onImageClick }: ArtifactImageGridProps) {
  if (artifacts.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-tertiary">
        No images to display
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          onClick={() => onImageClick(artifact)}
          className="relative aspect-square bg-surface-high rounded-sm overflow-hidden border border-border hover:border-accent/50 transition-colors group"
        >
          {artifact.thumbnail_url ? (
            <img
              src={artifact.thumbnail_url}
              alt={artifact.title || 'Image artifact'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : artifact.content ? (
            <img
              src={artifact.content}
              alt={artifact.title || 'Image artifact'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="h-8 w-8 text-tertiary" />
            </div>
          )}
          {artifact.title && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 truncate opacity-0 group-hover:opacity-100 transition-opacity">
              {artifact.title}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
