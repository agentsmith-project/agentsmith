'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FileText, FileType2, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { getApiClient, SourcesAPI } from '@/lib/api';
import type { SourceObjectMeta } from '@/lib/api/types';
import { queryKeys } from '@/lib/query-keys';

type SelectedItem =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'object'; key: string };

interface SourceObjectDetailsPanelProps {
  workspaceId: string;
  projectId: string;
  selectedLibraryId: string | null;
  selected: SelectedItem[];
  onDownload: () => void;
}

type PreviewKind = 'image' | 'pdf' | 'text' | 'none';

const TEXT_CONTENT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'text/markdown',
]);

function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function extensionOf(filename: string) {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  const precision = value >= 100 || unitIdx === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIdx]}`;
}

function resolvePreviewKind(contentType: string, key: string): PreviewKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('text/') || TEXT_CONTENT_TYPES.has(contentType)) return 'text';

  const ext = extensionOf(key);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'json', 'csv', 'xml', 'yml', 'yaml', 'log', 'js', 'ts', 'tsx', 'jsx', 'css', 'html'].includes(ext)) {
    return 'text';
  }
  return 'none';
}

function previewSupportsInline(kind: PreviewKind) {
  return kind === 'image' || kind === 'pdf' || kind === 'text';
}

function previewTypeLabel(kind: PreviewKind, t: ReturnType<typeof useTranslations>) {
  if (kind === 'image') return t('file_manager.preview_type_image');
  if (kind === 'pdf') return t('file_manager.preview_type_pdf');
  if (kind === 'text') return t('file_manager.preview_type_text');
  return t('file_manager.preview_type_binary');
}

function FileKindIcon({ kind }: { kind: PreviewKind }) {
  if (kind === 'image') return <ImageIcon className="h-5 w-5 text-accent" />;
  return <FileType2 className="h-5 w-5 text-tertiary" />;
}

export function SourceObjectDetailsPanel({
  workspaceId,
  projectId,
  selectedLibraryId,
  selected,
  onDownload,
}: SourceObjectDetailsPanelProps) {
  const t = useTranslations('sources');
  const selectedObject = selected.length === 1 && selected[0].kind === 'object' ? selected[0] : null;
  const [tab, setTab] = React.useState<'overview' | 'technical'>('overview');

  const metaQuery = useQuery({
    queryKey: selectedLibraryId && selectedObject
      ? queryKeys.sourceObjects.meta(workspaceId, projectId, selectedLibraryId, selectedObject.key)
      : ['source-object-meta', 'disabled', workspaceId, projectId],
    queryFn: async () => {
      if (!selectedLibraryId || !selectedObject) throw new Error('meta disabled');
      const api = new SourcesAPI(getApiClient());
      return api.getObjectMeta(workspaceId, projectId, selectedLibraryId, selectedObject.key);
    },
    enabled: !!selectedLibraryId && !!selectedObject,
    staleTime: 5_000,
  });

  const previewKind = React.useMemo(() => {
    if (!selectedObject || !metaQuery.data) return 'none';
    return resolvePreviewKind(metaQuery.data.content_type, metaQuery.data.key);
  }, [metaQuery.data, selectedObject]);

  const previewEnabled = !!selectedLibraryId && !!selectedObject && !!metaQuery.data && tab === 'overview' && previewSupportsInline(previewKind);
  const previewQuery = useQuery({
    queryKey: selectedLibraryId && selectedObject
      ? ['source-object-preview', workspaceId, projectId, selectedLibraryId, selectedObject.key]
      : ['source-object-preview', 'disabled', workspaceId, projectId],
    queryFn: async () => {
      if (!selectedLibraryId || !selectedObject) throw new Error('preview disabled');
      const api = new SourcesAPI(getApiClient());
      return api.downloadObject(workspaceId, projectId, selectedLibraryId, selectedObject.key);
    },
    enabled: previewEnabled,
    staleTime: 15_000,
  });

  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [textPreview, setTextPreview] = React.useState('');

  React.useEffect(() => {
    if (!previewQuery.data || !previewSupportsInline(previewKind)) {
      setTextPreview('');
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    if (previewKind === 'text') {
      void previewQuery.data
        .text()
        .then((raw) => {
          const maxChars = 20_000;
          const value = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n...` : raw;
          setTextPreview(value);
        })
        .catch(() => setTextPreview(t('file_manager.preview_failed')));
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    const url = URL.createObjectURL(previewQuery.data);
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setTextPreview('');
  }, [previewKind, previewQuery.data, t]);

  React.useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const copyKey = React.useCallback(async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t('file_manager.key_copied'));
    } catch {
      toast.error(t('file_manager.key_copy_failed'));
    }
  }, [t]);

  const renderEmpty = () => {
    if (!selectedLibraryId || selected.length === 0) {
      return <div className="text-tertiary">{t('file_manager.details_empty')}</div>;
    }
    if (selected.length > 1) {
      return <div className="text-tertiary">{t('file_manager.details_multi', { count: String(selected.length) })}</div>;
    }
    if (selected[0].kind === 'prefix') {
      return (
        <div className="space-y-2">
          <div className="text-xs text-tertiary">{t('file_manager.folder')}</div>
          <div className="font-mono text-xs break-all">{selected[0].prefix}</div>
        </div>
      );
    }
    return null;
  };

  const empty = renderEmpty();
  if (empty) {
    return (
      <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col" data-testid="sources__details-panel">
        <div className="px-3 py-2 border-b border-subtle text-sm text-primary">{t('file_manager.details')}</div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-sm">{empty}</div>
      </div>
    );
  }

  if (metaQuery.isLoading || !metaQuery.data) {
    return (
      <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col" data-testid="sources__details-panel">
        <div className="px-3 py-2 border-b border-subtle text-sm text-primary">{t('file_manager.details')}</div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-sm text-tertiary">{t('file_manager.loading')}</div>
      </div>
    );
  }

  const meta = metaQuery.data;
  const filename = basename(meta.key);
  const ext = extensionOf(filename);

  return (
    <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col" data-testid="sources__details-panel">
      <div className="px-3 py-2 border-b border-subtle text-sm text-primary">{t('file_manager.details')}</div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'overview' | 'technical')} className="w-full" data-testid="sources__details-tabs">
          <TabsList className="w-full grid grid-cols-2 h-9">
            <TabsTrigger value="overview" data-testid="sources__details-tab--overview">{t('file_manager.details_overview')}</TabsTrigger>
            <TabsTrigger value="technical" data-testid="sources__details-tab--technical">{t('file_manager.details_technical')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-3 space-y-3">
            <div className="rounded-md border border-subtle bg-surface-high/30 px-3 py-3" data-testid="sources__details-hero">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-md border border-subtle bg-surface flex items-center justify-center">
                  <FileKindIcon kind={previewKind} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-strong font-medium">{filename}</div>
                  <div className="mt-1 text-xs text-tertiary">
                    {ext ? ext.toUpperCase() : t('file_manager.unknown')} · {formatBytes(meta.size_bytes)} · {new Date(meta.last_modified).toLocaleString()}
                  </div>
                  <div className="mt-2 inline-flex items-center rounded-sm border border-subtle bg-surface px-2 py-0.5 text-[11px] text-tertiary">
                    {previewTypeLabel(previewKind, t)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button type="button" size="sm" className="h-8" onClick={onDownload} data-testid="sources__details-download">
                  <Download className="h-3.5 w-3.5" />
                  {t('file_manager.download')}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => copyKey(meta.key)}>
                  <Copy className="h-3.5 w-3.5" />
                  {t('file_manager.copy_key')}
                </Button>
              </div>
            </div>

            <PreviewSection
              meta={meta}
              previewKind={previewKind}
              previewLoading={previewQuery.isLoading}
              previewError={previewQuery.isError}
              objectUrl={objectUrl}
              textPreview={textPreview}
              onDownload={onDownload}
              t={t}
            />
          </TabsContent>

          <TabsContent value="technical" className="mt-3 space-y-3 text-sm">
            <div className="rounded-md border border-subtle bg-surface-high/30 p-3 space-y-3">
              <KeyValue label={t('file_manager.key')} value={meta.key} mono />
              <KeyValue label={t('file_manager.type')} value={meta.content_type} />
              <KeyValue label={t('file_manager.size')} value={`${meta.size_bytes.toLocaleString()} (${formatBytes(meta.size_bytes)})`} />
              <KeyValue label={t('file_manager.modified')} value={new Date(meta.last_modified).toLocaleString()} />
              <KeyValue label={t('file_manager.etag')} value={meta.etag ?? '-'} mono />
            </div>

            <div className="rounded-md border border-subtle bg-surface-high/20 p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-tertiary">{t('file_manager.user_metadata')}</div>
              <pre className="text-xs leading-relaxed text-primary overflow-auto max-h-[220px]">
                {JSON.stringify(meta.user_metadata ?? {}, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={onDownload}>
                {t('file_manager.download')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => copyKey(meta.key)}>
                {t('file_manager.copy_key')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-tertiary">{label}</div>
      <div className={mono ? 'font-mono text-xs break-all text-primary' : 'break-all text-primary'}>{value}</div>
    </div>
  );
}

function PreviewSection({
  meta,
  previewKind,
  previewLoading,
  previewError,
  objectUrl,
  textPreview,
  onDownload,
  t,
}: {
  meta: SourceObjectMeta;
  previewKind: PreviewKind;
  previewLoading: boolean;
  previewError: boolean;
  objectUrl: string | null;
  textPreview: string;
  onDownload: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="rounded-md border border-subtle bg-surface-high/20 p-3 space-y-2" data-testid="sources__details-preview">
      <div className="text-xs uppercase tracking-wide text-tertiary">{t('file_manager.preview')}</div>

      {previewKind === 'none' ? (
        <div className="h-40 rounded border border-subtle bg-surface flex flex-col items-center justify-center text-tertiary gap-2">
          <FileType2 className="h-5 w-5" />
          <span className="text-sm">{t('file_manager.preview_unsupported')}</span>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onDownload}>
            {t('file_manager.download_to_view')}
          </Button>
        </div>
      ) : previewLoading ? (
        <div className="h-40 rounded border border-subtle bg-surface flex items-center justify-center text-tertiary text-sm">
          {t('file_manager.preview_loading')}
        </div>
      ) : previewError ? (
        <div className="h-40 rounded border border-subtle bg-surface flex flex-col items-center justify-center text-tertiary text-sm gap-2">
          <span>{t('file_manager.preview_failed')}</span>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onDownload}>
            {t('file_manager.download_to_view')}
          </Button>
        </div>
      ) : previewKind === 'image' && objectUrl ? (
        <div className="rounded border border-subtle bg-black/10 p-2">
          <img src={objectUrl} alt={basename(meta.key)} className="max-h-[280px] w-full object-contain rounded" />
        </div>
      ) : previewKind === 'pdf' && objectUrl ? (
        <iframe src={objectUrl} title={basename(meta.key)} className="h-[320px] w-full rounded border border-subtle bg-surface" />
      ) : previewKind === 'text' ? (
        <div className="rounded border border-subtle bg-surface p-2 max-h-[320px] overflow-auto">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words text-primary">
            {textPreview || t('file_manager.preview_loading')}
          </pre>
        </div>
      ) : (
        <div className="h-40 rounded border border-subtle bg-surface flex items-center justify-center text-tertiary text-sm">
          {t('file_manager.preview_unsupported')}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-tertiary">
        {previewKind === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        <span>{meta.content_type}</span>
      </div>
    </div>
  );
}
