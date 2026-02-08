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
import { SourcesTable } from '@/components/sources/SourcesTable';
import { useSources } from '@/lib/hooks/use-sources';
import { Loader2 } from 'lucide-react';
export interface SourceSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onConfirm: (selectedIds: string[]) => void;
  excludeIds?: string[]; // IDs to exclude (already attached)
}

export function SourceSelectDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onConfirm,
  excludeIds = [],
}: SourceSelectDialogProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  // Fetch only ready sources
  const { data: sourcesData, isLoading } = useSources(workspaceId, projectId, {
    status: 'ready',
    ai_ready_only: true,
    page_size: 1000, // Get all ready sources
  });

  // Filter out already attached sources
  const availableSources = React.useMemo(() => {
    if (!sourcesData?.items) return [];
    return sourcesData.items.filter((source) => !excludeIds.includes(source.id));
  }, [sourcesData?.items, excludeIds]);

  React.useEffect(() => {
    if (open) {
      setSelectedIds([]);
    }
  }, [open]);

  const handleConfirm = () => {
    if (selectedIds.length > 0) {
      onConfirm(selectedIds);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Sources to Task</DialogTitle>
          <DialogDescription>
            Choose AIReady files from your library to add as context. Only ready files are shown.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-tertiary" />
            </div>
          ) : availableSources.length === 0 ? (
            <div className="py-8 text-center text-sm text-tertiary">
              No ready files available in your library
            </div>
          ) : (
            <SourcesTable
              data={availableSources}
              selectedIds={selectedIds}
              onRowSelect={setSelectedIds}
            />
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-subtle">
          <div className="text-sm text-tertiary">
            {selectedIds.length > 0 ? `${selectedIds.length} file(s) selected` : 'No files selected'}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={selectedIds.length === 0}>
              Add Selected
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
