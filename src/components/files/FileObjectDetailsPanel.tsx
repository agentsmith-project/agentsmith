'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { getApiClient, FilesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes } from '@/lib/utils/formatters';
import { FileItemIcon } from '@/components/files/FileItemIcon';
import { PreviewDialog } from '@/components/files/file-object-details-panel/PreviewDialog';
import { PreviewSection } from '@/components/files/file-object-details-panel/PreviewSection';
import { ShareLinkDialog } from '@/components/files/file-object-details-panel/ShareLinkDialog';
import {
  basename,
  formatMetaSummary,
  previewSupportsInline,
  previewTypeLabel,
  resolvePreviewKind,
} from '@/components/files/file-object-details-panel/utils';

type SelectedItem =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'object'; key: string };

interface FileObjectDetailsPanelProps {
  workspaceId: string;
  projectId: string;
  selectedLibraryId: string | null;
  selected: SelectedItem[];
  onDownload: () => void;
}

export function FileObjectDetailsPanel({
  workspaceId,
  projectId,
  selectedLibraryId,
  selected,
  onDownload,
}: FileObjectDetailsPanelProps) {
  const t = useTranslations('files');
  const selectedObject = selected.length === 1 && selected[0].kind === 'object' ? selected[0] : null;
  const [tab, setTab] = React.useState<'overview' | 'technical'>('overview');

  const metaQuery = useQuery({
    queryKey: selectedLibraryId && selectedObject
      ? queryKeys.fileObjects.meta(workspaceId, projectId, selectedLibraryId, selectedObject.key)
      : ['source-object-meta', 'disabled', workspaceId, projectId],
    queryFn: async () => {
      if (!selectedLibraryId || !selectedObject) throw new Error('meta disabled');
      const api = new FilesAPI(getApiClient());
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
      const api = new FilesAPI(getApiClient());
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
      const api = new FilesAPI(getApiClient());
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
      <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col" data-testid="files__details-panel">
        <div className="px-3 py-2 border-b border-subtle text-sm text-primary">{t('file_manager.details')}</div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-sm">{empty}</div>
      </div>
    );
  }

  if (metaQuery.isLoading || !metaQuery.data) {
    return (
      <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col" data-testid="files__details-panel">
        <div className="px-3 py-2 border-b border-subtle text-sm text-primary">{t('file_manager.details')}</div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-sm text-tertiary">{t('file_manager.loading')}</div>
      </div>
    );
  }

  const meta = metaQuery.data;
  const { ext, filename, summary } = formatMetaSummary(meta, t, formatBytes);

  return (
    <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col" data-testid="files__details-panel">
      <div className="px-3 py-2 border-b border-subtle text-sm text-primary">{t('file_manager.details')}</div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'overview' | 'technical')} className="w-full" data-testid="files__details-tabs">
          <TabsList className="w-full grid grid-cols-2 h-9 rounded-md border border-subtle bg-surface-high/40 p-0.5 overflow-hidden">
            <TabsTrigger className="h-full text-xs sm:text-sm" value="overview" data-testid="files__details-tab--overview">{t('file_manager.details_overview')}</TabsTrigger>
            <TabsTrigger className="h-full text-xs sm:text-sm" value="technical" data-testid="files__details-tab--technical">{t('file_manager.details_technical')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-3 space-y-3">
            <div className="rounded-md border border-subtle bg-surface-high/30 px-3 py-3" data-testid="files__details-hero">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-md border border-subtle bg-surface flex items-center justify-center">
                  <FileItemIcon
                    kind="object"
                    name={filename}
                    contentType={meta.content_type}
                    className="h-5 w-5 text-tertiary"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-strong font-medium">{filename}</div>
                  <div className="mt-1 text-xs text-tertiary">{summary}</div>
                  <div className="mt-2 inline-flex items-center rounded-sm border border-subtle bg-surface px-2 py-0.5 text-[11px] text-tertiary">
                    {previewTypeLabel(previewKind, t)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="h-8" onClick={onDownload} data-testid="files__details-download">
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
                  data-testid="files__details-share"
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

      <ShareLinkDialog
        creatingShareLink={creatingShareLink}
        metaKey={meta.key}
        open={shareDialogOpen}
        shareExpirySeconds={shareExpirySeconds}
        shareExpiresAt={shareExpiresAt}
        shareLinkValue={shareLinkValue}
        t={t}
        onCopyShareLink={() => {
          void copyShareLink();
        }}
        onCreateShareLink={() => {
          void createShareLink();
        }}
        onOpenChange={setShareDialogOpen}
        onShareExpirySecondsChange={setShareExpirySeconds}
      />

      <PreviewDialog
        filename={filename}
        metaKey={meta.key}
        objectUrl={objectUrl}
        open={previewModalOpen}
        previewKind={previewKind}
        t={t}
        textPreview={textPreview}
        onOpenChange={setPreviewModalOpen}
      />
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
