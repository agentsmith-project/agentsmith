'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';
import {
  getAuditActionLabel,
  getAuditActorLabel,
  getAuditEventCategory,
  getAuditErrorLabel,
  getAuditErrorMessageLabel,
  getAuditGovernanceReasonLabel,
  getAuditMembershipStatusLabel,
  getAuditResourceLabel,
  getAuditResourceTypeLabel,
  getAuditSummary,
} from './audit-event-presenter';

export interface AuditDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AuditEvent | null;
  basePath?: string;
}

function formatFullTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

function formatGovernanceValue(value?: number | string | null): string {
  if (value === undefined || value === null || value === '') return '--';
  return String(value);
}

function hasGovernanceContext(event: AuditEvent): boolean {
  return Boolean(
    event.decision_id
    || event.error_code
    || event.error_message
    || event.trace_ref
    || event.trace_incident_id
    || event.trace_escalation_id
    || event.trace_run_id,
  );
}

function getDefaultGovernanceAction(resourceType?: string): string {
  if (resourceType === 'source_library') return 'upload';
  if (resourceType === 'project') return 'read';
  return 'invoke';
}

function getEvidenceWindow(timestamp: string): { start_time: string; end_time: string } {
  const center = new Date(timestamp);
  if (Number.isNaN(center.getTime())) {
    const now = new Date();
    return {
      start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      end_time: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };
  }
  return {
    start_time: new Date(center.getTime() - 30 * 60 * 1000).toISOString(),
    end_time: new Date(center.getTime() + 30 * 60 * 1000).toISOString(),
  };
}

export function AuditDetailDrawer({
  open,
  onOpenChange,
  event,
  basePath,
}: AuditDetailDrawerProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const toastT = useTranslations('common.toast');
  if (!event) return null;
  const governance = getGovernanceEvidenceDetails({
    error_code: event.error_code,
    ...(event.metadata_json ?? {}),
  });
  const resourceLabel = getAuditResourceLabel(event);
  const membersHref = basePath && event.end_user_id
    ? `${basePath}/members${buildSharedOpsFilterQuery({}, {
      member_tab: 'people',
      member_id: event.end_user_id,
      authorize_resource_type: event.resource_type,
      authorize_resource_id: event.resource_id,
      authorize_action: getDefaultGovernanceAction(event.resource_type),
    })}`
    : null;
  const resourcePolicyHref = basePath && event.resource_id
    && (event.resource_type === 'endpoint' || event.resource_type === 'source_library' || event.resource_type === 'agent')
    ? `${basePath}/resource-policy${buildSharedOpsFilterQuery({}, {
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      explain_subject_type: event.end_user_id ? 'user' : undefined,
      explain_subject_id: event.end_user_id,
      explain_action: getDefaultGovernanceAction(event.resource_type),
    })}`
    : null;
  const evidenceWindow = getEvidenceWindow(event.timestamp);
  const usageHref = basePath
    ? `${basePath}/usage${buildSharedOpsFilterQuery(evidenceWindow, {
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      end_user_id: event.end_user_id,
      result: event.result,
      request_id: event.request_id,
      decision_id: event.decision_id,
      trace_ref: event.trace_ref,
      trace_incident_id: event.trace_incident_id,
      trace_escalation_id: event.trace_escalation_id,
      trace_run_id: event.trace_run_id,
    })}`
    : null;

  const handleCopyRequestId = () => {
    navigator.clipboard.writeText(event.request_id);
    toast.success(toastT('copied'));
  };
  const summary = getAuditSummary(event, t);
  const category = getAuditEventCategory(event);
  const showInvestigationRefs = hasGovernanceContext(event);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('detail.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('detail.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-md p-4 space-y-2" data-testid="audit__detail-summary">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={category === 'anomaly' ? 'destructive' : category === 'change' ? 'secondary' : 'outline'}>
                {t(`category.${category}`)}
              </Badge>
              {event.resource_type ? (
                <Badge variant="outline">{getAuditResourceTypeLabel(event.resource_type)}</Badge>
              ) : null}
            </div>
            <p className="text-sm font-medium text-foreground">{summary}</p>
            {event.error_message ? (
              <p className="text-sm text-tertiary">{getAuditErrorMessageLabel(event.error_message)}</p>
            ) : null}
          </div>

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
              <Badge variant="outline">{getAuditActionLabel(event.action)}</Badge>
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
                  {getAuditActorLabel(event.actor_type, t)}
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
                  <Badge variant="outline">{getAuditResourceTypeLabel(event.resource_type)}</Badge>
                  {resourceLabel && (
                    <span className="text-sm text-foreground font-mono">
                      {resourceLabel}
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
          </div>

          {showInvestigationRefs ? (
            <div className="bg-surface border border-border rounded-md p-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">{t('detail.error_information')}</h4>
              {event.error_code ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-tertiary">{t('table.error_code')}:</span>
                  <Badge variant="destructive">{getAuditErrorLabel(event.error_code)}</Badge>
                </div>
              ) : null}
              {event.request_id ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-tertiary">{t('table.request_id')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-mono">{event.request_id}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyRequestId}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : null}
              {event.decision_id ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-tertiary">{t('table.decision_id')}</span>
                  <span className="text-sm text-foreground font-mono">{event.decision_id}</span>
                </div>
              ) : null}
              {event.trace_ref ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-tertiary">{t('table.trace_ref')}</span>
                  <span className="text-sm text-foreground font-mono">{event.trace_ref}</span>
                </div>
              ) : null}
              {event.error_message ? (
                <div>
                  <span className="text-sm text-tertiary">{t('detail.error_message')}:</span>
                  <p className="text-sm text-foreground mt-1">{getAuditErrorMessageLabel(event.error_message)}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {governance ? (
            <div className="bg-surface border border-border rounded-md p-4 space-y-3" data-testid="audit__detail-governance">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground">{t('detail.governance_title')}</h4>
                <div className="flex flex-wrap items-center gap-2">
                  {membersHref ? (
                    <Link
                      href={membersHref}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      data-testid="audit__detail-open-member-access"
                    >
                      {t('detail.open_member_access')}
                    </Link>
                  ) : null}
                  {resourcePolicyHref ? (
                    <Link
                      href={resourcePolicyHref}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      data-testid="audit__detail-open-resource-policy"
                    >
                      {t('detail.open_resource_policy')}
                    </Link>
                  ) : null}
                  {usageHref ? (
                    <Link
                      href={usageHref}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      data-testid="audit__detail-open-usage"
                    >
                      {t('detail.open_usage')}
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <span className="text-sm text-tertiary">{t('detail.limit_key')}:</span>
                  <p className="mt-1 text-sm font-mono text-foreground">{formatGovernanceValue(governance.limit_key)}</p>
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
                  <span className="text-sm text-tertiary">{t('detail.reason_label')}:</span>
                  <p className="mt-1 text-sm text-foreground">
                    {formatGovernanceValue(getAuditGovernanceReasonLabel(governance.reason) ?? governance.reason)}
                  </p>
                </div>
              </div>
              {governance.authz_decision?.membership_status || (governance.missing_permissions?.length ?? 0) > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <span className="text-sm text-tertiary">{t('detail.membership_status')}:</span>
                    <p className="mt-1 text-sm text-foreground">
                      {formatGovernanceValue(
                        getAuditMembershipStatusLabel(governance.authz_decision?.membership_status)
                        ?? governance.authz_decision?.membership_status,
                      )}
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
