import { MonitorCog, Pencil, Plus, Trash2 } from 'lucide-react';
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
  onOpenDesktopAccess: (library: FileLibrary) => void;
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
  onOpenDesktopAccess,
  onRenameLibrary,
  onDeleteLibrary,
}: FilesLibrariesPaneProps) {
  const showActions = canManage || canExchangeCredentials;

  return (
    <div className="min-h-0 rounded-md border border-subtle bg-surface/74 shadow-ambient">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
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
              const isMountable = library.status === 'ready';
              const statusToneClass = library.status === 'failed'
                ? 'border-error/25 bg-error/10 text-error'
                : library.status === 'degraded'
                  ? 'border-warning/25 bg-warning/10 text-warning'
                  : 'border-subtle bg-white/5 text-secondary';
              const statusReason = library.status === 'failed'
                ? t('file_manager.library_status_reason_failed')
                : library.status === 'degraded'
                  ? t('file_manager.library_status_reason_degraded')
                  : null;
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
                    'flex w-full flex-col gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
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
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]',
                            statusToneClass,
                          )}
                          data-testid={`files__library-status--${library.id}`}
                        >
                          {t(`file_manager.library_status_${library.status}`)}
                        </span>
                      </div>
                      {library.bucket ? <div className="truncate text-[11px] text-tertiary">{library.bucket}</div> : null}
                      {statusReason ? (
                        <div
                          className="mt-1 text-[11px] text-tertiary"
                          data-testid={`files__library-status-reason--${library.id}`}
                        >
                          {statusReason}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {active && showActions ? (
                    <TooltipProvider delayDuration={120}>
                      <div className="flex items-center gap-1.5 border-t border-subtle pt-1">
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
                                  onOpenDesktopAccess(library);
                                }}
                                disabled={!isMountable}
                                aria-label={t('file_manager.desktop_access')}
                                data-testid={`files__library-desktop-access--${library.id}`}
                              >
                                <MonitorCog className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isMountable ? t('file_manager.desktop_access') : t('file_manager.library_status_reason_failed_mount')}
                            </TooltipContent>
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
                                  className="h-8 w-8 rounded-full border border-subtle bg-transparent text-secondary hover:bg-hover/55 hover:text-primary"
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
                                  className="h-8 w-8 rounded-full border border-subtle bg-transparent text-secondary hover:bg-error/12 hover:text-error"
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
                    <div className="border-t border-subtle pt-1" />
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
