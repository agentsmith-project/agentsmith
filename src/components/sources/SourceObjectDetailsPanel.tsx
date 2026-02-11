'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Expand, FileText, FileType2, Image as ImageIcon, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { getApiClient, SourcesAPI } from '@/lib/api';
import type { SourceObjectMeta } from '@/lib/api/types';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes } from '@/lib/utils/formatters';
import { SourceItemIcon } from '@/components/sources/SourceItemIcon';

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

function formatExpiry(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString();
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
  const [previewModalOpen, setPreviewModalOpen] = React.useState(false);
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [shareExpirySeconds, setShareExpirySeconds] = React.useState('3600');
  const [shareLinkValue, setShareLinkValue] = React.useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = React.useState<string | null>(null);
  const [creatingShareLink, setCreatingShareLink] = React.useState(false);

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

  React.useEffect(() => {
    setShareLinkValue(null);
    setShareExpiresAt(null);
  }, [selectedLibraryId, selectedObject?.key]);

  const copyPath = React.useCallback(async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t('file_manager.key_copied'));
    } catch {
      toast.error(t('file_manager.key_copy_failed'));
    }
  }, [t]);

  const copyShareLink = React.useCallback(async () => {
    if (!shareLinkValue) return;
    try {
      await navigator.clipboard.writeText(shareLinkValue);
      toast.success(t('file_manager.share_link_copied'));
    } catch {
      toast.error(t('file_manager.share_link_copy_failed'));
    }
  }, [shareLinkValue, t]);

  const createShareLink = React.useCallback(async () => {
    if (!selectedLibraryId || !selectedObject) return;
    setCreatingShareLink(true);
    try {
      const expires = Number.parseInt(shareExpirySeconds, 10);
      const api = new SourcesAPI(getApiClient());
      const shared = await api.createObjectShareLink(workspaceId, projectId, selectedLibraryId, {
        key: selectedObject.key,
        expires_in_seconds: Number.isFinite(expires) ? expires : undefined,
      });
      setShareLinkValue(shared.url);
      setShareExpiresAt(shared.expires_at);
      toast.success(t('file_manager.share_link_created'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('file_manager.share_link_failed');
      toast.error(message);
    } finally {
      setCreatingShareLink(false);
    }
  }, [projectId, selectedLibraryId, selectedObject, shareExpirySeconds, t, workspaceId]);

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
          <TabsList className="w-full grid grid-cols-2 h-9 rounded-md border border-subtle bg-surface-high/40 p-0.5 overflow-hidden">
            <TabsTrigger className="h-full text-xs sm:text-sm" value="overview" data-testid="sources__details-tab--overview">{t('file_manager.details_overview')}</TabsTrigger>
            <TabsTrigger className="h-full text-xs sm:text-sm" value="technical" data-testid="sources__details-tab--technical">{t('file_manager.details_technical')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-3 space-y-3">
            <div className="rounded-md border border-subtle bg-surface-high/30 px-3 py-3" data-testid="sources__details-hero">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-md border border-subtle bg-surface flex items-center justify-center">
                  <SourceItemIcon
                    kind="object"
                    name={filename}
                    contentType={meta.content_type}
                    className="h-5 w-5 text-tertiary"
                  />
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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="h-8" onClick={onDownload} data-testid="sources__details-download">
                  <Download className="h-3.5 w-3.5" />
                  {t('file_manager.download')}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => copyPath(meta.key)}>
                  <Copy className="h-3.5 w-3.5" />
                  {t('file_manager.copy_key')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setShareDialogOpen(true)}
                  data-testid="sources__details-share"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t('file_manager.share_link')}
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
              onExpand={() => setPreviewModalOpen(true)}
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
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => copyPath(meta.key)}>
                {t('file_manager.copy_key')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="sources__dialog__share-link">
          <DialogHeader>
            <DialogTitle>{t('file_manager.share_link')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-tertiary break-all">{meta.key}</div>
            <div className="space-y-1.5">
              <Label htmlFor="share-expiry">{t('file_manager.share_link_expiry')}</Label>
              <Select value={shareExpirySeconds} onValueChange={setShareExpirySeconds}>
                <SelectTrigger id="share-expiry" data-testid="sources__share-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="900">{t('file_manager.share_expiry_15m')}</SelectItem>
                  <SelectItem value="3600">{t('file_manager.share_expiry_1h')}</SelectItem>
                  <SelectItem value="86400">{t('file_manager.share_expiry_24h')}</SelectItem>
                  <SelectItem value="604800">{t('file_manager.share_expiry_7d')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => void createShareLink()} disabled={creatingShareLink} data-testid="sources__share-generate">
                {creatingShareLink ? t('file_manager.generating') : t('file_manager.generate_link')}
              </Button>
              {shareLinkValue && (
                <Button type="button" variant="outline" onClick={() => void copyShareLink()} data-testid="sources__share-copy">
                  {t('file_manager.copy_link')}
                </Button>
              )}
            </div>
            {shareLinkValue && (
              <div className="space-y-2">
                <Input readOnly value={shareLinkValue} data-testid="sources__share-link-value" />
                <div className="text-xs text-tertiary">
                  {t('file_manager.share_link_expires_at', { time: formatExpiry(shareExpiresAt ?? '') })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-6xl h-[86vh] flex flex-col" data-testid="sources__dialog__preview-expand">
          <DialogHeader>
            <DialogTitle className="truncate">{filename}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {previewKind === 'image' && objectUrl ? (
              <div className="h-full rounded border border-subtle bg-black/20 p-3">
                <img src={objectUrl} alt={basename(meta.key)} className="h-full w-full object-contain rounded" />
              </div>
            ) : previewKind === 'pdf' && objectUrl ? (
              <iframe src={objectUrl} title={basename(meta.key)} className="h-full w-full rounded border border-subtle bg-surface" />
            ) : previewKind === 'text' ? (
              <div className="h-full rounded border border-subtle bg-surface p-3 overflow-auto">
                <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words text-primary">
                  {textPreview || t('file_manager.preview_loading')}
                </pre>
              </div>
            ) : (
              <div className="h-full rounded border border-subtle bg-surface flex flex-col items-center justify-center gap-2 text-tertiary">
                <FileType2 className="h-5 w-5" />
                <span>{t('file_manager.preview_unsupported')}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
  onExpand,
  t,
}: {
  meta: SourceObjectMeta;
  previewKind: PreviewKind;
  previewLoading: boolean;
  previewError: boolean;
  objectUrl: string | null;
  textPreview: string;
  onDownload: () => void;
  onExpand: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const expandable = previewKind !== 'none' && !previewLoading && !previewError;
  return (
    <div className="rounded-md border border-subtle bg-surface-high/20 p-3 space-y-2" data-testid="sources__details-preview">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-tertiary">{t('file_manager.preview')}</div>
        {expandable && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={onExpand} data-testid="sources__preview-expand">
            <Expand className="h-3.5 w-3.5" />
            {t('file_manager.preview_expand')}
          </Button>
        )}
      </div>

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
