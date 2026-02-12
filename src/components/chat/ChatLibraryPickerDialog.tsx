'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Folder, File, ChevronLeft } from 'lucide-react';
import type { SourcesAPI } from '@/lib/api/endpoints/sources';
import type { SourceLibrary, SourceObjectItem, SourceObjectsListItem } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface ChatLibraryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  sourcesAPI: SourcesAPI;
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
  const libraries = librariesData?.items ?? [];

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

  const openPrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
  };

  const onBack = () => {
    setPrefix(parentPrefix);
  };

  const items = objectsData?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="chat__library-picker">
        <DialogHeader>
          <DialogTitle>{t('library_picker.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr]">
            <Select value={libraryId} onValueChange={(next) => {
              setLibraryId(next);
              setPrefix('');
              setSearch('');
            }}>
              <SelectTrigger data-testid="chat__library-picker-library-select">
                <SelectValue placeholder={t('library_picker.select_library')} />
              </SelectTrigger>
              <SelectContent>
                {libraries.map((library: SourceLibrary) => (
                  <SelectItem key={library.id} value={library.id}>
                    {library.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('library_picker.search_placeholder')}
              data-testid="chat__library-picker-search"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-tertiary">
            <div className="truncate">
              {currentLibrary ? `${currentLibrary.name} / ${prefix || '/'}` : '/'}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={!prefix}>
              <ChevronLeft className="h-4 w-4" />
              {t('library_picker.up')}
            </Button>
          </div>

          <div className="max-h-[360px] overflow-auto rounded-md border border-subtle bg-surface">
            {objectsLoading ? (
              <div className="p-4 text-sm text-tertiary">{t('library_picker.loading')}</div>
            ) : items.length === 0 ? (
              <div className="p-4 text-sm text-tertiary">{t('library_picker.empty')}</div>
            ) : (
              <div className="divide-y divide-subtle">
                {items.map((item: SourceObjectsListItem) => {
                  if (item.kind === 'prefix') {
                    return (
                      <button
                        key={item.prefix}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
                        onClick={() => openPrefix(item.prefix)}
                        data-testid={`chat__library-picker-prefix-${item.name}`}
                      >
                        <Folder className="h-4 w-4 text-tertiary" />
                        <span className="truncate text-sm">{item.name}</span>
                      </button>
                    );
                  }

                  const objectItem = item as SourceObjectItem;
                  return (
                    <div
                      key={objectItem.key}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                      data-testid={`chat__library-picker-object-${objectItem.name}`}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <File className="h-4 w-4 text-tertiary" />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-primary">{objectItem.name}</div>
                          <div className="truncate text-xs text-tertiary">{objectItem.content_type}</div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
