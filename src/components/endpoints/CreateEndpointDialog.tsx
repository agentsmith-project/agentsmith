'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EndpointAPI, CredentialsAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import { toast } from '@/components/ui/toast';

export interface CreateEndpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function CreateEndpointDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: CreateEndpointDialogProps) {
  const t = useTranslations('endpoints');
  const commonT = useTranslations('common');
  const locale = useLocale();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [openaiModel, setOpenaiModel] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [provider, setProvider] = React.useState<'openai' | 'anthropic' | 'custom'>('openai');
  const [credentialRef, setCredentialRef] = React.useState<string>('');
  const [limitsExpanded, setLimitsExpanded] = React.useState(false);
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = React.useState<string>('');
  const [timeoutSeconds, setTimeoutSeconds] = React.useState<string>('');

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials', workspaceId, projectId],
    queryFn: () => credentialsAPI.list(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateEndpointRequest) => {
      return endpointAPI.create(workspaceId, projectId, data);
    },
    onSuccess: () => {
      onOpenChange(false);
      resetForm();
      toast.success(t('create_dialog.success'));
      onSuccess?.();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.errorCode === 'ENDPOINT_MODEL_CONFLICT') {
        toast.error(t('create_dialog.model_conflict'));
      } else {
        handleErrorForToast(error);
      }
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setOpenaiModel('');
    setBaseUrl('');
    setProvider('openai');
    setCredentialRef('');
    setLimitsExpanded(false);
    setMaxRequestsPerMinute('');
    setTimeoutSeconds('');
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !openaiModel.trim() || !credentialRef) {
      if (!credentialRef) {
        toast.error(t('create_dialog.credential_required'));
      }
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      toast.error(t('create_dialog.base_url_required'));
      return;
    }

    const defaultBaseUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
    };
    const url = baseUrl.trim() || defaultBaseUrls[provider] || '';

    const data: CreateEndpointRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      openai_model: openaiModel.trim(),
      type: provider,
      base_url: url,
      credential_ref: credentialRef,
    };

    if (limitsExpanded && (maxRequestsPerMinute || timeoutSeconds)) {
      data.limits = {};
      if (maxRequestsPerMinute.trim()) {
        data.limits.max_requests_per_minute = parseInt(maxRequestsPerMinute, 10);
      }
      if (timeoutSeconds.trim()) {
        data.limits.timeout_seconds = parseInt(timeoutSeconds, 10);
      }
    }

    createMutation.mutate(data);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !createMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit =
    name.trim().length > 0 &&
    openaiModel.trim().length > 0 &&
    credentialRef.length > 0 &&
    (provider !== 'custom' || baseUrl.trim().length > 0) &&
    !createMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="endpoints__create-dialog"
      >
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('create_dialog.title')}</SheetTitle>
          <SheetDescription>{t('create_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            <label htmlFor="endpoint-name" className="text-sm font-medium text-foreground">
              {t('create_dialog.name')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create_dialog.name_placeholder')}
              disabled={createMutation.isPending}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-description" className="text-sm font-medium text-foreground">
              {t('create_dialog.description')}
            </label>
            <textarea
              id="endpoint-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={commonT('placeholders.enter_description')}
              rows={2}
              disabled={createMutation.isPending}
              className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-model" className="text-sm font-medium text-foreground">
              {t('create_dialog.model_id')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-model"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              placeholder="e.g. gpt-4o, claude-3.5-sonnet"
              disabled={createMutation.isPending}
              required
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t('create_dialog.provider')} <span className="text-error">*</span>
            </label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as 'openai' | 'anthropic' | 'custom')}
              disabled={createMutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t('create_dialog.provider_openai')}</SelectItem>
                <SelectItem value="anthropic">{t('create_dialog.provider_anthropic')}</SelectItem>
                <SelectItem value="custom">{t('create_dialog.provider_custom')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-base-url" className="text-sm font-medium text-foreground">
              {t('create_dialog.base_url')}
              {provider === 'custom' && <span className="text-error"> *</span>}
            </label>
            <Input
              id="endpoint-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === 'openai'
                  ? 'https://api.openai.com/v1'
                  : provider === 'anthropic'
                    ? 'https://api.anthropic.com/v1'
                    : 'https://your-api.example.com/v1'
              }
              disabled={createMutation.isPending}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t('create_dialog.credential')} <span className="text-error">*</span>
            </label>
            {credentials.length === 0 ? (
              <div className="rounded-sm border border-subtle bg-surface-low p-4 text-sm text-tertiary">
                {t('create_dialog.no_credentials')}{' '}
                <Link
                  href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/credentials`}
                  className="text-accent hover:underline"
                >
                  {t('create_dialog.create_credential_first')}
                </Link>
              </div>
            ) : (
              <Select
                value={credentialRef}
                onValueChange={setCredentialRef}
                disabled={createMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={commonT('placeholders.select')} />
                </SelectTrigger>
                <SelectContent>
                  {credentials.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.fingerprint})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setLimitsExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm text-primary hover:text-foreground"
            >
              {limitsExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              {t('create_dialog.limits')}
            </button>
            {limitsExpanded && (
              <div className="grid grid-cols-2 gap-4 pl-6">
                <div className="space-y-1">
                  <label htmlFor="endpoint-rpm" className="text-xs text-tertiary">
                    {t('create_dialog.max_rpm')}
                  </label>
                  <Input
                    id="endpoint-rpm"
                    type="number"
                    min={1}
                    value={maxRequestsPerMinute}
                    onChange={(e) => setMaxRequestsPerMinute(e.target.value)}
                    placeholder="Optional"
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="endpoint-timeout" className="text-xs text-tertiary">
                    {t('create_dialog.timeout_seconds')}
                  </label>
                  <Input
                    id="endpoint-timeout"
                    type="number"
                    min={1}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                    placeholder="Optional"
                    disabled={createMutation.isPending}
                  />
                </div>
              </div>
            )}
          </div>

          </div>

          <div className="flex flex-shrink-0 justify-end gap-2 border-t border-subtle px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button
              type="submit"
              variant="action"
              disabled={!canSubmit || credentials.length === 0}
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                commonT('create')
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
