'use client';
import * as React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Artifact } from '@/lib/types/task';

export interface ArtifactImageGridProps {
  artifacts: Artifact[];
  onImageClick: (artifact: Artifact) => void;
  onAttachAsInput?: (artifact: Artifact) => void;
}

export function ArtifactImageGrid({ artifacts, onImageClick, onAttachAsInput }: ArtifactImageGridProps) {
  const tArtifacts = useTranslations('notebook.artifacts');
  const tCommon = useTranslations('common');
  if (artifacts.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-tertiary">
        No images to display
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-xl border border-white/6 bg-surface/55 p-2">
          <div className="flex items-start gap-2.5">
            <button
              onClick={() => onImageClick(artifact)}
              className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-surface-high/40 transition-colors hover:ring-1 hover:ring-accent/35"
            >
              {artifact.thumbnail_url ? (
                <img
                  src={artifact.thumbnail_url}
                  alt={artifact.title || 'Image artifact'}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : artifact.content ? (
                <img
                  src={artifact.content}
                  alt={artifact.title || 'Image artifact'}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-tertiary" />
                </div>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">
                {artifact.title || 'Image artifact'}
              </div>
              <div className="mt-1 text-[11px] text-tertiary">
                {tArtifacts('filter.image')}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => onImageClick(artifact)}
                  className="h-6 rounded-md px-2 text-[11px] text-primary hover:bg-hover transition-colors"
                >
                  {tCommon('view')}
                </button>
                {onAttachAsInput ? (
                  <button
                    type="button"
                    onClick={() => onAttachAsInput(artifact)}
                    className="h-6 rounded-md px-2 text-[11px] text-primary hover:bg-hover transition-colors"
                  >
                    {tArtifacts('actions.attach_input')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
