'use client';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import type { Artifact } from '@/lib/types/recipe';

export interface ArtifactImageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: Artifact | null;
  onDownload?: () => void;
}

export function ArtifactImageViewer({
  open,
  onOpenChange,
  artifact,
  onDownload,
}: ArtifactImageViewerProps) {
  if (!artifact) return null;

  const imageUrl = artifact.content || artifact.thumbnail_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[90vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{artifact.title || 'Image Artifact'}</DialogTitle>
          {artifact.created_at && (
            <DialogDescription>
              Created {new Date(artifact.created_at).toLocaleString()}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-auto flex items-center justify-center bg-surface-high rounded-md p-4">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={artifact.title || 'Image artifact'}
              className="max-w-full max-h-full object-contain"
              loading="eager"
            />
          ) : (
            <div className="text-tertiary">No image available</div>
          )}
        </div>
        {onDownload && (
          <div className="flex justify-end pt-4 border-t border-subtle">
            <Button variant="outline" onClick={onDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
