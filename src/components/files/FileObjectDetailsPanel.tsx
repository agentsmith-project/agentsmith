'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { getApiClient, FilesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes } from '@/lib/utils/formatters';
import {
  useAuthStore,
  useAuthStoreHydration,
  selectIsAuthenticated,
  selectToken,
} from '@/lib/stores/authStore';
import { FileItemIcon } from '@/components/files/FileItemIcon';
import { PreviewDialog } from '@/components/files/file-object-details-panel/PreviewDialog';
import { PreviewSection } from '@/components/files/file-object-details-panel/PreviewSection';
import {
  formatMetaSummary,
  previewSupportsInline,
  previewTypeLabel,
  resolvePreviewKind,
} from '@/components/files/file-object-details-panel/utils';
import { getRuntimeSystemDotFolderInfo } from '@/components/files/files-page/utils';

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
  const authHydrated = useAuthStoreHydration();
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const token = useAuthStore(selectToken);
  const [apiClientAuthReady, setApiClientAuthReady] = React.useState(false);
  React.useEffect(() => {
    if (!authHydrated) {
      setApiClientAuthReady(false);
      return;
    }
    const client = getApiClient();
    if (token) {
      client.setToken(token);
      setApiClientAuthReady(true);
      return;
    }
    client.clearToken();
    setApiClientAuthReady(false);
  }, [authHydrated, token]);
  const authReady = authHydrated && isAuthenticated && !!token && apiClientAuthReady;
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
    enabled: authReady && !!selectedLibraryId && !!selectedObject,
    staleTime: 5_000,
  });

  const previewKind = React.useMemo(() => {
    if (!selectedObject || !metaQuery.data) return 'none';
    return resolvePreviewKind(metaQuery.data.content_type, metaQuery.data.key);
  }, [metaQuery.data, selectedObject]);

  const previewEnabled = authReady && !!selectedLibraryId && !!selectedObject && !!metaQuery.data && tab === 'overview' && previewSupportsInline(previewKind);
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

  const copyPath = React.useCallback(async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t('file_manager.key_copied'));
    } catch {
      toast.error(t('file_manager.key_copy_failed'));
    }
  }, [t]);

  const renderEmpty = () => {
    if (!selectedLibraryId || selected.length === 0) {
      return (
        <div className="space-y-3" data-testid="files__details-empty-state">
          <div>
            <div className="text-xs uppercase tracking-wide text-tertiary">{t('file_manager.details')}</div>
            <div className="mt-1 text-sm font-medium text-primary">{t('file_manager.details_empty')}</div>
            <div className="mt-2 text-sm text-tertiary">{t('file_manager.details_empty_description')}</div>
          </div>
        </div>
      );
    }
    if (selected.length > 1) {
      return <div className="text-tertiary">{t('file_manager.details_multi', { count: String(selected.length) })}</div>;
    }
    if (selected[0].kind === 'prefix') {
      const runtimeSystemDotFolder = getRuntimeSystemDotFolderInfo(selected[0]);
      return (
        <div className="space-y-3" data-testid="files__details-prefix-state">
          <div>
            <div className="text-xs uppercase tracking-wide text-tertiary">{t('file_manager.folder')}</div>
            <div className="mt-1 text-sm font-medium text-primary">{selected[0].prefix}</div>
            {runtimeSystemDotFolder ? (
              <div className="mt-2">
                <span
                  className="inline-flex rounded-sm border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-warning"
                  data-testid={`files__details__runtime-system-badge--${runtimeSystemDotFolder.testIdSegment}`}
                  title={t('file_manager.runtime_system_badge')}
                >
                  {t('file_manager.runtime_system_badge')}
                </span>
              </div>
            ) : null}
            <div className="mt-2 text-sm text-tertiary">{t('file_manager.details_prefix_description')}</div>
          </div>
        </div>
      );
    }
    return null;
  };

  const empty = renderEmpty();
  if (empty) {
    return (
      <div className="min-h-0 flex flex-col" data-testid="files__details-panel">
        <div className="px-0 py-2 text-sm text-primary">{t('file_manager.details')}</div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-sm">{empty}</div>
      </div>
    );
  }

  if (metaQuery.isLoading || !metaQuery.data) {
    return (
      <div className="min-h-0 flex flex-col" data-testid="files__details-panel">
        <div className="px-0 py-2 text-sm text-primary">{t('file_manager.details')}</div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-sm text-tertiary">{t('file_manager.loading')}</div>
      </div>
    );
  }

  const meta = metaQuery.data;
  const { filename, summary } = formatMetaSummary(meta, t, formatBytes);

  return (
    <div className="min-h-0 flex flex-col" data-testid="files__details-panel">
      <div className="px-0 py-2 text-sm text-primary">{t('file_manager.details')}</div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'overview' | 'technical')} className="w-full" data-testid="files__details-tabs">
          <TabsList className="w-full grid grid-cols-2 h-8 rounded-none border-b border-subtle/60 bg-transparent p-0 overflow-hidden">
            <TabsTrigger className="h-full text-xs sm:text-sm" value="overview" data-testid="files__details-tab--overview">{t('file_manager.details_overview')}</TabsTrigger>
            <TabsTrigger className="h-full text-xs sm:text-sm" value="technical" data-testid="files__details-tab--technical">{t('file_manager.details_technical')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-3 space-y-3">
            <div className="space-y-3" data-testid="files__details-inspector">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-subtle/60 bg-transparent">
                  <FileItemIcon
                    kind="object"
                    name={filename}
                    contentType={meta.content_type}
                    className="h-5 w-5 text-tertiary"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{filename}</div>
                  <div className="mt-1 text-xs text-tertiary">{summary}</div>
                  <div className="mt-1 text-[11px] text-tertiary">
                    {previewTypeLabel(previewKind, t)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="h-8" onClick={onDownload} data-testid="files__details-download">
                  <Download className="h-3.5 w-3.5" />
                  {t('file_manager.download')}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => copyPath(meta.key)}>
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
              onExpand={() => setPreviewModalOpen(true)}
              t={t}
            />
          </TabsContent>

          <TabsContent value="technical" className="mt-3 space-y-3 text-sm">
            <div className="space-y-3">
              <KeyValue label={t('file_manager.key')} value={meta.key} mono />
              <KeyValue label={t('file_manager.type')} value={meta.content_type} />
              <KeyValue label={t('file_manager.size')} value={`${meta.size_bytes.toLocaleString()} (${formatBytes(meta.size_bytes)})`} />
              <KeyValue label={t('file_manager.modified')} value={new Date(meta.last_modified).toLocaleString()} />
            </div>

            <div className="space-y-2 border-t border-subtle/60 pt-3">
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
