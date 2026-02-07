'use client';

import * as React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { SourceLibrary } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface SourceLibrariesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: SourceLibrary[];
  selectedLibraryId: string;
  onSelectLibrary: (libraryId: string) => void;
  onCreateLibrary: (name: string) => Promise<void>;
  onRenameLibrary: (libraryId: string, name: string) => Promise<void>;
  onDeleteLibrary: (libraryId: string) => Promise<void>;
  creating?: boolean;
  updating?: boolean;
  deleting?: boolean;
}

export function SourceLibrariesDialog({
  open,
  onOpenChange,
  libraries,
  selectedLibraryId,
  onSelectLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
  creating = false,
  updating = false,
  deleting = false,
}: SourceLibrariesDialogProps) {
  const [newLibraryName, setNewLibraryName] = React.useState('');
  const [editingLibraryId, setEditingLibraryId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState('');

  const handleCreate = async () => {
    const name = newLibraryName.trim();
    if (!name) return;
    await onCreateLibrary(name);
    setNewLibraryName('');
  };

  const beginRename = (library: SourceLibrary) => {
    setEditingLibraryId(library.id);
    setEditingName(library.name);
  };

  const submitRename = async () => {
    if (!editingLibraryId) return;
    const name = editingName.trim();
    if (!name) return;
    await onRenameLibrary(editingLibraryId, name);
    setEditingLibraryId(null);
    setEditingName('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sources__libraries-dialog" className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Manage Libraries</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-subtle bg-surface-high p-3">
            <p className="mb-2 text-xs text-tertiary">Create shared file library</p>
            <div className="flex items-center gap-2">
              <Input
                value={newLibraryName}
                onChange={(event) => setNewLibraryName(event.target.value)}
                placeholder="Library name"
                disabled={creating}
                data-testid="sources__library-create-input"
              />
              <Button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newLibraryName.trim()}
                data-testid="sources__library-create-btn"
              >
                <Plus className="mr-1 h-4 w-4" />
                Create
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className="w-full rounded-sm border border-subtle bg-surface px-3 py-2 text-left text-sm"
              data-testid="sources__library-row--all"
              onClick={() => onSelectLibrary('all')}
            >
              <span className={selectedLibraryId === 'all' ? 'text-foreground font-medium' : 'text-primary'}>
                All libraries
              </span>
            </button>

            {libraries.map((library) => (
              <div
                key={library.id}
                className="rounded-sm border border-subtle bg-surface px-3 py-2"
                data-testid={`sources__library-row--${library.id}`}
              >
                {editingLibraryId === library.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      disabled={updating}
                      data-testid={`sources__library-rename-input--${library.id}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitRename}
                      disabled={updating || !editingName.trim()}
                      data-testid={`sources__library-rename-save--${library.id}`}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingLibraryId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="text-left text-sm"
                      onClick={() => onSelectLibrary(library.id)}
                    >
                      <span className={selectedLibraryId === library.id ? 'text-foreground font-medium' : 'text-primary'}>
                        {library.name}
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => beginRename(library)}
                        data-testid={`sources__library-rename-btn--${library.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-error hover:text-error"
                        onClick={() => onDeleteLibrary(library.id)}
                        disabled={deleting}
                        data-testid={`sources__library-delete-btn--${library.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
