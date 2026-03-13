import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FileLibrary } from '@/lib/api/types';

type FilesLibrariesPaneProps = {
  t: (key: string, values?: Record<string, string>) => string;
  canManage: boolean;
  libsLoading: boolean;
  libraries: FileLibrary[];
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string) => void;
  onCreateLibrary: () => void;
  onRenameLibrary: (library: FileLibrary) => void;
  onDeleteLibrary: (library: FileLibrary) => void;
};

export function FilesLibrariesPane({
  t,
  canManage,
  libsLoading,
  libraries,
  selectedLibraryId,
  onSelectLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
}: FilesLibrariesPaneProps) {
  return (
    <div className="min-h-0 rounded-md border border-subtle bg-surface">
      <div className="px-3 py-2 border-b border-subtle flex items-center justify-between">
        <div className="text-sm text-primary">{t('file_manager.libraries')}</div>
        {canManage ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onCreateLibrary}
            aria-label={t('file_manager.library_create')}
            data-testid="files__library-create"
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 overflow-auto">
        {libsLoading ? (
          <div className="p-3 text-sm text-tertiary">{t('file_manager.loading')}</div>
        ) : libraries.length === 0 ? (
          <div className="p-3 text-sm text-tertiary">{t('file_manager.no_libraries')}</div>
        ) : (
          <div className="p-1" data-testid="files__library-list">
            {libraries.map((library) => {
              const active = library.id === selectedLibraryId;
              return (
                <div
                  key={library.id}
                  onClick={() => onSelectLibrary(library.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelectLibrary(library.id);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-sm flex items-center justify-between gap-2',
                    active ? 'bg-hover text-strong' : 'hover:bg-hover/70 text-primary',
                  )}
                  role="button"
                  tabIndex={0}
                  data-testid={`files__library-item--${library.id}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{library.name}</div>
                    {library.bucket ? <div className="truncate text-[11px] text-tertiary">{library.bucket}</div> : null}
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onRenameLibrary(library);
                        }}
                        aria-label={t('file_manager.library_rename')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDeleteLibrary(library);
                        }}
                        aria-label={t('file_manager.library_delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
