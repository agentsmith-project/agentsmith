'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ContextAPI, getApiClient } from '@/lib/api';
import type { ContextContentType, ContextScope } from '@/lib/api/types';
import { APIError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageLoading } from '@/components/ui/loading';
import { toast } from '@/components/ui/toast';

type ContextManagerProps = {
  scope: Extract<ContextScope, 'member' | 'project_member' | 'project' | 'workspace'>;
  workspaceId: string;
  projectId?: string;
  surface?: 'workspace' | 'project';
};

const CONTENT_TYPES: ContextContentType[] = ['text', 'json', 'markdown', 'yaml'];

export function ContextManager({
  scope,
  workspaceId,
  projectId,
  surface: _surface = projectId ? 'project' : 'workspace',
}: ContextManagerProps) {
  const t = useTranslations('context_store');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new ContextAPI(getApiClient()), []);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [draftKey, setDraftKey] = React.useState('');
  const [draftContent, setDraftContent] = React.useState('');
  const [draftContentType, setDraftContentType] = React.useState<ContextContentType>('text');
  const isWorkspacePersonalScope = scope === 'member';
  const isProjectPersonalScope = scope === 'project_member';
  const requestProjectId = scope === 'project' || scope === 'project_member' ? projectId : undefined;

  const queryKey = ['context-store', scope, workspaceId, requestProjectId ?? ''];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.list({
      scope,
      workspace_id: workspaceId,
      project_id: requestProjectId,
    }),
    enabled: Boolean(workspaceId),
  });

  const items = React.useMemo(() => data ?? [], [data]);
  const selectedEntry = selectedKey ? items.find((item) => item.key === selectedKey) ?? null : null;

  React.useEffect(() => {
    if (selectedEntry) {
      setDraftKey(selectedEntry.key);
      setDraftContent(selectedEntry.content);
      setDraftContentType(selectedEntry.content_type);
      return;
    }
    setDraftKey('');
    setDraftContent('');
    setDraftContentType('text');
  }, [selectedEntry]);

  React.useEffect(() => {
    if (selectedKey) return;
    if (items.length === 0) return;
    setSelectedKey(items[0]?.key ?? null);
  }, [items, selectedKey]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey });
  };

  const saveMutation = useMutation({
    mutationFn: async () => api.put({
      scope,
      key: draftKey,
      content: draftContent,
      content_type: draftContentType,
      workspace_id: workspaceId,
      project_id: requestProjectId,
    }),
    onSuccess: async (saved) => {
      setSelectedKey(saved.key);
      await invalidate();
      toast.success(tCommon('refreshed_data'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => api.remove({
      scope,
      key: draftKey,
      workspace_id: workspaceId,
      project_id: requestProjectId,
    }),
    onSuccess: async () => {
      setSelectedKey(null);
      await invalidate();
      toast.success(tCommon('refreshed_data'));
    },
  });

  const onCreateNew = () => {
    setSelectedKey(null);
    setDraftKey('');
    setDraftContent('');
    setDraftContentType('text');
  };

  const saveDisabled = draftKey.trim().length === 0 || saveMutation.isPending;
  const deleteDisabled = !selectedEntry || deleteMutation.isPending;

  if (isLoading) {
    return <PageLoading />;
  }

  const listDescription = isWorkspacePersonalScope
    ? t('member_list_description')
    : isProjectPersonalScope
      ? t('project_member_list_description')
      : t('list_description');
  const emptyDescription = isWorkspacePersonalScope
    ? t('member_empty_description')
    : isProjectPersonalScope
      ? t('project_member_empty_description')
      : t('empty_description');
  const editorDescription = isWorkspacePersonalScope
    ? t('member_editor_description')
    : isProjectPersonalScope
      ? t('project_member_editor_description')
      : t('editor_description');
  const keyPlaceholder = isWorkspacePersonalScope
    ? t('member_key_placeholder')
    : isProjectPersonalScope
      ? t('project_member_key_placeholder')
      : t('key_placeholder');
  const contentPlaceholder = isWorkspacePersonalScope
    ? t('member_content_placeholder')
    : isProjectPersonalScope
      ? t('project_member_content_placeholder')
      : t('content_placeholder');

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card data-testid="context-store__list-card">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t('list_title')}</CardTitle>
            <Button size="sm" variant="outline" onClick={onCreateNew} data-testid="context-store__new">
              {t('new_entry')}
            </Button>
          </div>
          <p className="text-sm text-tertiary">{listDescription}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-subtle bg-bg-base/10 px-4 py-5 text-sm text-tertiary">
              <div className="font-medium text-foreground">{t('empty_title')}</div>
              <div className="mt-1">{emptyDescription}</div>
            </div>
          ) : (
            items.map((item) => {
              const active = item.key === selectedKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedKey(item.key)}
                  className={`w-full rounded-md border px-3 py-3 text-left transition ${
                    active
                      ? 'border-accent/35 bg-accent/10'
                      : 'border-subtle bg-bg-base/10 hover:border-white/15 hover:bg-surface-low'
                  }`}
                  data-testid={`context-store__item--${item.key}`}
                >
                  <div className="truncate text-sm font-medium text-foreground">{item.key}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.14em] text-tertiary">{item.content_type}</div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card data-testid="context-store__editor-card">
        <CardHeader>
          <CardTitle>{selectedEntry ? t('edit_entry') : t('create_entry')}</CardTitle>
          <p className="text-sm text-tertiary">{editorDescription}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="context-key">{t('key_label')}</Label>
            <Input
              id="context-key"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder={keyPlaceholder}
              data-testid="context-store__key"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-content-type">{t('content_type_label')}</Label>
            <Select
              value={draftContentType}
              onValueChange={(value) => setDraftContentType(value as ContextContentType)}
            >
              <SelectTrigger id="context-content-type" data-testid="context-store__content-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-content">{t('content_label')}</Label>
            <Textarea
              id="context-content"
              rows={14}
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              placeholder={contentPlaceholder}
              data-testid="context-store__content"
            />
          </div>

          {saveMutation.error instanceof APIError ? (
            <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {saveMutation.error.message}
            </div>
          ) : null}

          {deleteMutation.error instanceof APIError ? (
            <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {deleteMutation.error.message}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveDisabled}
              data-testid="context-store__save"
            >
              {saveMutation.isPending ? t('saving') : t('save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteDisabled}
              data-testid="context-store__delete"
            >
              {deleteMutation.isPending ? t('deleting') : t('delete')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
