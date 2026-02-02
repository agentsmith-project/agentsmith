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
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { Artifact } from '@/lib/types/recipe';

export interface ArtifactSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: Artifact | null;
  onSave: (filename?: string, description?: string) => void;
  saving?: boolean;
}

export function ArtifactSaveDialog({
  open,
  onOpenChange,
  artifact,
  onSave,
  saving = false,
}: ArtifactSaveDialogProps) {
  const [filename, setFilename] = React.useState('');
  const [description, setDescription] = React.useState('');

  React.useEffect(() => {
    if (open && artifact) {
      setFilename(artifact.title || '');
      setDescription('');
    }
  }, [open, artifact]);

  const handleSave = () => {
    if (artifact) {
      onSave(filename || undefined, description || undefined);
    }
  };

  if (!artifact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Save Artifact to Library</DialogTitle>
          <DialogDescription>
            Save this artifact to your file library. You'll need to start AIReady processing
            separately if you want to use it in recipes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="artifact-filename" className="text-sm font-medium text-foreground">
              Filename (optional)
            </label>
            <Input
              id="artifact-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Enter filename"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="artifact-description" className="text-sm font-medium text-foreground">
              Description (optional)
            </label>
            <Input
              id="artifact-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description"
              disabled={saving}
            />
          </div>

          <div className="rounded-md bg-surface-high border border-subtle p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-xs text-tertiary">
              <p className="font-medium text-foreground mb-1">Note:</p>
              <p>Saved files need to be processed with AIReady before they can be used in recipes.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save to Library
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
