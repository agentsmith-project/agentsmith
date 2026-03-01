'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { JSONViewer } from './JSONViewer';
import { Copy } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import type { AuditEvent } from '@/lib/api/types';
import { getGovernanceEvidenceDetails } from '@/lib/api/endpoints/governance-explainability';

export interface AuditDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AuditEvent | null;
}

function formatFullTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

function formatGovernanceValue(value?: number | string | null): string {
  if (value === undefined || value === null || value === '') return '--';
  return String(value);
}

export function AuditDetailDrawer({
  open,
  onOpenChange,
  event,
}: AuditDetailDrawerProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const toastT = useTranslations('common.toast');
  if (!event) return null;
  const governance = getGovernanceEvidenceDetails({
    error_code: event.error_code,
    ...(event.metadata_json ?? {}),
  });

  const handleCopyRequestId = () => {
    navigator.clipboard.writeText(event.request_id);
    toast.success(toastT('copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('detail.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basic Info Card */}
          <div className="bg-surface border border-border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">{t('table.timestamp')}</span>
              <span className="text-sm text-foreground font-mono">
                {formatFullTimestamp(event.timestamp)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">{t('table.action')}</span>
              <Badge variant="outline">{event.action}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">{t('table.actor')}</span>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    event.actor_type === 'user'
                      ? 'default'
                      : event.actor_type === 'agent'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {event.actor_type}
                </Badge>
                <span className="text-sm text-foreground font-mono">{event.actor_id}</span>
              </div>
            </div>
            {event.end_user_id && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-tertiary">{t('table.end_user')}</span>
                <span className="text-sm text-foreground font-mono">{event.end_user_id}</span>
              </div>
            )}
            {event.resource_type && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-tertiary">{t('table.resource')}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{event.resource_type}</Badge>
                  {event.resource_id && (
                    <span className="text-sm text-foreground font-mono">
                      {event.resource_id}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">{t('table.result')}</span>
              <Badge variant={event.result === 'ok' ? 'default' : 'destructive'}>
                {event.result === 'ok' ? commonT('success') : commonT('error')}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">{t('table.request_id')}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground font-mono">{event.request_id}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyRequestId}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Error Info Card */}
          {event.result === 'error' && (
            <div className="bg-surface border border-border rounded-md p-4 space-y-2">
              <h4 className="text-sm font-semibold text-foreground">{t('detail.error_information')}</h4>
              {event.error_code && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-tertiary">{t('table.error_code')}:</span>
                  <Badge variant="destructive">{event.error_code}</Badge>
                </div>
              )}
              {event.error_message && (
                <div>
                  <span className="text-sm text-tertiary">{t('detail.error_message')}:</span>
                  <p className="text-sm text-foreground mt-1">{event.error_message}</p>
                </div>
              )}
            </div>
          )}

          {governance ? (
            <div className="bg-surface border border-border rounded-md p-4 space-y-3" data-testid="audit__detail-governance">
              <h4 className="text-sm font-semibold text-foreground">{t('detail.governance_title')}</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <span className="text-sm text-tertiary">{t('detail.governance_kind')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.governance_kind)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.enforcement_kind')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.enforcement_kind)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.quota_key')}:</span>
                  <p className="mt-1 text-sm font-mono text-foreground">{formatGovernanceValue(governance.quota_key)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.scope')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.scope)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.effective_limit')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.effective_limit)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.current_usage')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.current_usage)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.usage_unit')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.usage_unit)}</p>
                </div>
                <div>
                  <span className="text-sm text-tertiary">{t('detail.reason_label')}:</span>
                  <p className="mt-1 text-sm text-foreground">{formatGovernanceValue(governance.reason)}</p>
                </div>
              </div>
              {governance.authz_decision?.membership_status || (governance.missing_permissions?.length ?? 0) > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <span className="text-sm text-tertiary">{t('detail.membership_status')}:</span>
                    <p className="mt-1 text-sm text-foreground">
                      {formatGovernanceValue(governance.authz_decision?.membership_status)}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-tertiary">{t('detail.missing_permissions')}:</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(governance.missing_permissions ?? []).length > 0 ? (
                        governance.missing_permissions?.map((permission) => (
                          <code key={permission} className="rounded bg-surface-high px-2 py-1 text-xs text-foreground">
                            {permission}
                          </code>
                        ))
                      ) : (
                        <span className="text-sm text-foreground">--</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Metadata JSON Card */}
          <JSONViewer data={event.metadata_json || {}} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
