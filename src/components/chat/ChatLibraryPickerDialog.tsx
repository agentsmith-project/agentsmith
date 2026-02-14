'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Folder, File, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { FilesAPI } from '@/lib/api/endpoints/files';
import type { FileLibrary, FileObjectItem, FileObjectsListItem } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface ChatLibraryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  sourcesAPI: FilesAPI;
  loading?: boolean;
  onPickObject: (input: {
    libraryId: string;
    key: string;
    name: string;
    contentType?: string;
  }) => void;
}

export function ChatLibraryPickerDialog(props: ChatLibraryPickerDialogProps) {
  const {
    open,
    onOpenChange,
    workspaceId,
    projectId,
    sourcesAPI,
    loading = false,
    onPickObject,
  } = props;
  const t = useTranslations('chat');

  const [libraryId, setLibraryId] = React.useState<string>('');
  const [prefix, setPrefix] = React.useState<string>('');
  const [search, setSearch] = React.useState<string>('');

  const { data: librariesData } = useQuery({
    queryKey: ['chat-library-picker', 'libraries', workspaceId, projectId],
    queryFn: () => sourcesAPI.listLibraries(workspaceId, projectId),
    enabled: open && workspaceId.length > 0 && projectId.length > 0,
  });
  const libraries = React.useMemo(() => librariesData?.items ?? [], [librariesData?.items]);

  React.useEffect(() => {
    if (!open) return;
    if (libraryId) return;
    if (libraries.length === 0) return;
    setLibraryId(libraries[0].id);
  }, [libraryId, libraries, open]);

  const { data: objectsData, isLoading: objectsLoading } = useQuery({
    queryKey: ['chat-library-picker', 'objects', workspaceId, projectId, libraryId, prefix, search],
    queryFn: () =>
      sourcesAPI.listObjects(workspaceId, projectId, libraryId, {
        prefix: prefix || undefined,
        delimiter: '/',
        search: search || undefined,
        sort_by: 'name',
        sort_order: 'asc',
      }),
    enabled: open && workspaceId.length > 0 && projectId.length > 0 && libraryId.length > 0,
  });

  const currentLibrary = libraries.find((item) => item.id === libraryId) ?? null;
  const parentPrefix = React.useMemo(() => {
    if (!prefix) return '';
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const index = normalized.lastIndexOf('/');
    if (index < 0) return '';
    return `${normalized.slice(0, index + 1)}`;
  }, [prefix]);

  const breadcrumbItems = React.useMemo(() => {
    const items: Array<{ label: string; targetPrefix: string }> = [];
    if (currentLibrary) {
      items.push({ label: currentLibrary.name, targetPrefix: '' });
    } else {
      items.push({ label: '/', targetPrefix: '' });
    }
    if (!prefix) return items;
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const segments = normalized.split('/').filter((part) => part.length > 0);
    let acc = '';
    for (const segment of segments) {
      acc = `${acc}${segment}/`;
      items.push({ label: segment, targetPrefix: acc });
    }
    return items;
  }, [currentLibrary, prefix]);

  const openPrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
  };

  const onBack = () => {
    setPrefix(parentPrefix);
  };

  const items = objectsData?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,960px)] max-w-none h-[min(78vh,640px)] p-0 overflow-hidden !flex !flex-col !gap-0"
        data-testid="chat__library-picker"
      >
        <DialogHeader className="px-6 py-4 border-b border-subtle">
          <DialogTitle className="p-0">{t('library_picker.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="min-w-0">
              <Select value={libraryId} onValueChange={(next) => {
                setLibraryId(next);
                setPrefix('');
                setSearch('');
              }}>
                <SelectTrigger data-testid="chat__library-picker-library-select">
                  <SelectValue placeholder={t('library_picker.select_library')} />
                </SelectTrigger>
                <SelectContent>
                  {libraries.map((library: FileLibrary) => (
                    <SelectItem key={library.id} value={library.id}>
                      {library.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('library_picker.search_placeholder')}
                data-testid="chat__library-picker-search"
              />
            </div>
          </div>

          <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-tertiary">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onBack}
              disabled={!prefix}
              aria-label={t('library_picker.up')}
              title={t('library_picker.up')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
              <div className="inline-flex items-center gap-1">
                {breadcrumbItems.map((item, index) => (
                  <React.Fragment key={`${item.targetPrefix}-${item.label}`}>
                    {index > 0 ? <ChevronRight className="h-3 w-3 text-tertiary/70" /> : null}
                    <button
                      type="button"
                      className="rounded-sm px-1 py-0.5 text-tertiary hover:bg-hover hover:text-primary"
                      onClick={() => setPrefix(item.targetPrefix)}
                    >
                      {item.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 min-h-0 flex-1 rounded-md border border-subtle bg-surface overflow-hidden">
            {objectsLoading ? (
              <div className="p-4 text-sm text-tertiary">{t('library_picker.loading')}</div>
            ) : items.length === 0 ? (
              <div className="flex h-full min-h-[220px] items-center justify-center p-6">
                <div className="flex w-full max-w-sm flex-col items-center rounded-md border border-dashed border-subtle/80 bg-surface-high/40 px-6 py-8 text-center">
                  <Inbox className="mb-3 h-6 w-6 text-tertiary" />
                  <div className="text-sm text-primary">{t('library_picker.empty')}</div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-xs text-tertiary border-b border-subtle bg-surface-high/50">
                  <span>{t('library_picker.name_column')}</span>
                  <span>{t('library_picker.items_count', { count: items.length })}</span>
                </div>
                <div className="min-h-0 overflow-auto divide-y divide-subtle">
                  {items.map((item: FileObjectsListItem) => {
                    if (item.kind === 'prefix') {
                      return (
                        <button
                          key={item.prefix}
                          type="button"
                          className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
                          onClick={() => openPrefix(item.prefix)}
                          data-testid={`chat__library-picker-prefix-${item.name}`}
                        >
                          <Folder className="h-4 w-4 text-tertiary" />
                          <span className="truncate text-sm">{item.name}</span>
                        </button>
                      );
                    }

                    const objectItem = item as FileObjectItem;
                    return (
                      <div
                        key={objectItem.key}
                        className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
                        data-testid={`chat__library-picker-object-${objectItem.name}`}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <File className="h-4 w-4 text-tertiary" />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-primary" title={objectItem.name}>{objectItem.name}</div>
                            <div className="truncate text-xs text-tertiary">{objectItem.content_type}</div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={loading}
                          onClick={() =>
                            onPickObject({
                              libraryId,
                              key: objectItem.key,
                              name: objectItem.name,
                              contentType: objectItem.content_type,
                            })
                          }
                        >
                          {t('library_picker.add')}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
