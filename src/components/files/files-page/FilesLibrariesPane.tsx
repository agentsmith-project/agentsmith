import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { FileLibrary } from '@/lib/api/types';

type FilesLibrariesPaneProps = {
  t: (key: string, values?: Record<string, string>) => string;
  canManage: boolean;
  libsLoading: boolean;
  libraries: FileLibrary[];
  showEmptyMessage?: boolean;
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string) => void;
  onCreateLibrary: () => void;
  onRenameLibrary: (library: FileLibrary) => void;
  onDeleteLibrary: (library: FileLibrary) => void;
};

function isTaskHomeBound(library: FileLibrary) {
  return library.task_home_binding_status === 'bound';
}

function statusReasonKey(library: FileLibrary) {
  if (library.status === 'failed') return 'file_manager.library_status_reason_failed';
  if (library.status === 'degraded') return 'file_manager.library_status_reason_degraded';
  return null;
}

export function FilesLibrariesPane({
  t,
  canManage,
  libsLoading,
  libraries,
  showEmptyMessage = true,
  selectedLibraryId,
  onSelectLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
}: FilesLibrariesPaneProps) {
  const showActions = canManage;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-subtle bg-surface/74 shadow-ambient"
      data-testid="files__libraries-pane"
    >
      <div className="shrink-0 flex items-center justify-between border-b border-subtle px-3 py-2">
        <div>
          <div className="text-[11px] font-semibold uppercase text-tertiary">{t('file_manager.libraries')}</div>
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
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="files__library-list-scroll">
        {libsLoading ? (
          <div className="p-3 text-sm text-tertiary">{t('file_manager.loading')}</div>
        ) : libraries.length === 0 ? (
          showEmptyMessage ? (
            <div className="p-3 text-sm text-tertiary">{t('file_manager.no_libraries')}</div>
          ) : (
            <div className="p-3" data-testid="files__library-pane-empty-shell" />
          )
        ) : (
          <div className="p-1.5" data-testid="files__library-list">
            {libraries.map((library) => {
              const active = library.id === selectedLibraryId;
              const taskHomeBound = isTaskHomeBound(library);
              const statusReason = statusReasonKey(library);
              const statusToneClass = library.status === 'failed'
                ? 'border-error/25 bg-error/10 text-error'
                : library.status === 'degraded'
                  ? 'border-warning/25 bg-warning/10 text-warning'
                  : 'border-subtle bg-white/5 text-secondary';
              const bindingLabel = taskHomeBound
                ? (
                    library.bound_task_visible && library.bound_task_title
                      ? t('file_manager.library_binding_bound_visible', {
                          title: library.bound_task_title,
                          status: library.bound_task_status ?? 'unknown',
                        })
                      : t('file_manager.library_binding_bound_redacted')
                  )
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
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    active
                      ? 'bg-accent/10 text-strong ring-1 ring-accent/18'
                      : 'text-primary hover:bg-hover/55',
                  )}
                  role="button"
                  tabIndex={0}
                  data-testid={`files__library-item--${library.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-sm transition-colors', active ? 'text-strong' : 'text-primary')}>
                      {library.name}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase',
                          statusToneClass,
                        )}
                        title={statusReason ? t(statusReason) : undefined}
                        data-testid={`files__library-status--${library.id}`}
                      >
                        {t(`file_manager.library_status_${library.status}`)}
                      </span>
                      {taskHomeBound ? (
                        <span
                          className="min-w-0 truncate rounded-full border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-warning"
                          title={bindingLabel ?? undefined}
                          data-testid={`files__library-binding--${library.id}`}
                        >
                          {t('file_manager.library_binding_bound')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {active && showActions ? (
                    <TooltipProvider delayDuration={120}>
                      <div className="shrink-0 flex items-center gap-1">
                        {!canManage ? null : (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 rounded-full border border-subtle bg-transparent text-secondary hover:bg-hover/55 hover:text-primary"
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
                                  className="h-7 w-7 rounded-full border border-subtle bg-transparent text-secondary hover:bg-error/12 hover:text-error"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onDeleteLibrary(library);
                                  }}
                                  disabled={taskHomeBound}
                                  aria-label={t('file_manager.library_delete')}
                                  title={taskHomeBound ? t('file_manager.library_delete_bound_blocked') : undefined}
                                  data-testid={`files__library-delete-inline--${library.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {taskHomeBound
                                  ? t('file_manager.library_delete_bound_blocked')
                                  : t('file_manager.library_delete')}
                              </TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </TooltipProvider>
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
