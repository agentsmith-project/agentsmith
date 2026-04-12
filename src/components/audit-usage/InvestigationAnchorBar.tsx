'use client';

import * as React from 'react';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';

export interface InvestigationAnchorBarProps {
  requestId?: string;
  decisionId?: string;
  traceRef?: string;
  traceIncidentId?: string;
  traceEscalationId?: string;
  traceRunId?: string;
  traceSource?: string;
  onClear?: () => void;
  compact?: boolean;
}

type AnchorItem = {
  key: string;
  label: string;
  value: string;
};

export function InvestigationAnchorBar({
  requestId,
  decisionId,
  traceRef,
  traceIncidentId,
  traceEscalationId,
  traceRunId,
  traceSource,
  onClear,
  compact = false,
}: InvestigationAnchorBarProps) {
  const commonT = useTranslations('common');
  const toastT = useTranslations('common.toast');
  const items = React.useMemo<AnchorItem[]>(() => {
    const next: AnchorItem[] = [];
    if (traceSource) next.push({ key: 'trace_source', label: commonT('investigation_trace_source'), value: traceSource });
    if (requestId) next.push({ key: 'request_id', label: commonT('investigation_request_id'), value: requestId });
    if (decisionId) next.push({ key: 'decision_id', label: commonT('investigation_decision_id'), value: decisionId });
    if (traceRef) next.push({ key: 'trace_ref', label: commonT('investigation_trace_ref'), value: traceRef });
    if (traceIncidentId) next.push({ key: 'trace_incident_id', label: commonT('investigation_trace_incident_id'), value: traceIncidentId });
    if (traceEscalationId) next.push({ key: 'trace_escalation_id', label: commonT('investigation_trace_escalation_id'), value: traceEscalationId });
    if (traceRunId) next.push({ key: 'trace_run_id', label: commonT('investigation_trace_run_id'), value: traceRunId });
    return next;
  }, [commonT, decisionId, requestId, traceEscalationId, traceIncidentId, traceRef, traceRunId, traceSource]);

  if (items.length === 0) return null;

  return (
    <div
      className={compact ? 'space-y-2' : 'rounded-md border border-subtle bg-bg-base/20 p-3'}
      data-testid="investigation-anchor__bar"
    >
      <div className={compact ? 'flex flex-wrap items-center justify-between gap-2' : 'flex flex-wrap items-center justify-between gap-2'}>
        <p className="text-xs font-medium text-foreground">{commonT('investigation_context_title')}</p>
        {onClear ? (
          <Button variant="outline" size="sm" className="h-7" onClick={onClear} data-testid="investigation-anchor__clear">
            {commonT('investigation_clear')}
          </Button>
        ) : null}
      </div>
      <div className={compact ? 'flex flex-wrap gap-2' : 'mt-2 flex flex-wrap gap-2'}>
        {items.map((item) => (
          <Badge key={item.key} variant="outline" className="flex items-center gap-2">
            <span className="text-xs text-tertiary">{item.label}:</span>
            <code className="text-xs text-foreground">{item.value}</code>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => {
                navigator.clipboard.writeText(item.value);
                toast.success(toastT('copied'));
              }}
              data-testid={`investigation-anchor__copy-${item.key}`}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
