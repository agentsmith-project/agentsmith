import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { FileLibrary } from '@/lib/api/types';

type FilesLibrariesPaneProps = {
  t: (key: string, values?: Record<string, string>) => string;
  canManage: boolean;
  canExchangeCredentials: boolean;
  libsLoading: boolean;
  libraries: FileLibrary[];
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string) => void;
  onCreateLibrary: () => void;
  onOpenMountAccess: (library: FileLibrary) => void;
  onRenameLibrary: (library: FileLibrary) => void;
  onDeleteLibrary: (library: FileLibrary) => void;
};

export function FilesLibrariesPane({
  t,
  canManage,
  canExchangeCredentials,
  libsLoading,
  libraries,
  selectedLibraryId,
  onSelectLibrary,
  onCreateLibrary,
  onOpenMountAccess,
  onRenameLibrary,
  onDeleteLibrary,
}: FilesLibrariesPaneProps) {
  const showActions = canManage || canExchangeCredentials;

  return (
    <div className="min-h-0 rounded-[16px] border border-white/5 bg-surface/74 shadow-[0_10px_24px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between border-b border-white/6 px-3 py-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('file_manager.libraries')}</div>
          <div className="mt-0.5 text-[11px] text-secondary">{libraries.length} {t('file_manager.items')}</div>
        </div>
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
          <div className="p-1.5" data-testid="files__library-list">
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
                    'flex w-full flex-col gap-2 rounded-[12px] px-2.5 py-2 text-left transition-colors',
                    active
                      ? 'bg-accent/10 text-strong ring-1 ring-accent/18'
                      : 'text-primary hover:bg-hover/55',
                  )}
                  role="button"
                  tabIndex={0}
                  data-testid={`files__library-item--${library.id}`}
                >
                  <div className="min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate text-sm transition-colors', active ? 'text-strong' : 'text-primary')}>
                        {library.name}
                      </div>
                      {library.bucket ? <div className="truncate text-[11px] text-tertiary">{library.bucket}</div> : null}
                    </div>
                  </div>
                  {active && showActions ? (
                    <TooltipProvider delayDuration={120}>
                      <div className="flex items-center gap-1.5 border-t border-white/6 pt-1">
                        {canExchangeCredentials ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-full border border-accent/20 bg-accent/6 text-accent hover:bg-accent/12 hover:text-accent"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onOpenMountAccess(library);
                                }}
                                aria-label={t('file_manager.mount_access')}
                                data-testid={`files__library-mount-access--${library.id}`}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('file_manager.mount_access')}</TooltipContent>
                          </Tooltip>
                        ) : null}
                        {!canManage ? null : (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 rounded-full border border-white/8 bg-transparent text-secondary hover:bg-hover/55 hover:text-primary"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onRenameLibrary(library);
                                  }}
                                  aria-label={t('file_manager.library_rename')}
                                  data-testid={`files__library-rename-inline--${library.id}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('file_manager.library_rename')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 rounded-full border border-white/8 bg-transparent text-secondary hover:bg-error/12 hover:text-error"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onDeleteLibrary(library);
                                  }}
                                  aria-label={t('file_manager.library_delete')}
                                  data-testid={`files__library-delete-inline--${library.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('file_manager.library_delete')}</TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </TooltipProvider>
                  ) : active ? (
                    <div className="border-t border-white/6 pt-1" />
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
