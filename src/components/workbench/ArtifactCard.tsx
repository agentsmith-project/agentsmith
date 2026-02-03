'use client';
import * as React from 'react';
import { Download, Save, Copy, Eye, FileText, Image as ImageIcon, File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Artifact } from '@/lib/types/recipe';
import { toast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/utils/formatters';

export interface ArtifactCardProps {
  artifact: Artifact;
  onView?: () => void;
  onSave?: () => void;
  onDownload?: () => void;
  disabled?: boolean;
}

export function ArtifactCard({
  artifact,
  onView,
  onSave,
  onDownload,
  disabled = false,
}: ArtifactCardProps) {
  const handleCopy = async () => {
    if (artifact.type === 'text' && artifact.content) {
      try {
        await navigator.clipboard.writeText(artifact.content);
        toast.info('Copied to clipboard');
      } catch {
        toast.error('Copy failed');
      }
    }
  };

  const renderContent = () => {
    switch (artifact.type) {
      case 'text':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-icon-default" />
              <span className="text-sm font-medium text-foreground">
                {artifact.title || 'Text Artifact'}
              </span>
            </div>
            {artifact.content && (
              <p className="text-sm text-primary line-clamp-3">{artifact.content}</p>
            )}
          </div>
        );
      case 'image':
        return (
          <div className="space-y-2">
            <div className="relative aspect-square bg-surface-high rounded-sm overflow-hidden border border-border">
              {artifact.thumbnail_url ? (
                <img
                  src={artifact.thumbnail_url}
                  alt={artifact.title || 'Image artifact'}
                  className="w-full h-full object-cover"
                />
              ) : artifact.content ? (
                <img
                  src={artifact.content}
                  alt={artifact.title || 'Image artifact'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-tertiary" />
                </div>
              )}
            </div>
            {artifact.title && (
              <p className="text-xs text-tertiary truncate">{artifact.title}</p>
            )}
          </div>
        );
      default:
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <File className="h-4 w-4 text-icon-default" />
              <span className="text-sm font-medium text-foreground">
                {artifact.title || 'File Artifact'}
              </span>
            </div>
            {artifact.file_size && (
              <p className="text-xs text-tertiary">
                {formatBytes(artifact.file_size)}
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="p-3 rounded-md border border-border bg-surface hover:bg-hover transition-colors">
      {renderContent()}
      <div className="flex items-center gap-1 mt-3 flex-wrap">
        {artifact.type === 'text' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={disabled}
            className="h-7 text-xs"
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </Button>
        )}
        {onView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onView}
            disabled={disabled}
            className="h-7 text-xs"
          >
            <Eye className="h-3 w-3 mr-1" />
            View
          </Button>
        )}
        {onSave && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            disabled={disabled}
            className="h-7 text-xs"
          >
            <Save className="h-3 w-3 mr-1" />
            Save
          </Button>
        )}
        {onDownload && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDownload}
            disabled={disabled}
            className="h-7 text-xs"
          >
            <Download className="h-3 w-3 mr-1" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
}
