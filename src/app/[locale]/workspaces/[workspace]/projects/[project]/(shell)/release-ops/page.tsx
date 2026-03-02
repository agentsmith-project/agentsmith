'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Copy, Download, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useRuntimeObservability, useUsageOperationsSummary, useUsageReportEvidence, useUsageReportSchedules } from '@/lib/hooks/use-audit-usage';
import {
  useAcknowledgeReleaseEscalation,
  useAssignReleaseEscalation,
  useCreateReleasePolicyOverride,
  useDecideReleasePolicyOverride,
  useReleaseEscalationDetail,
  useReleaseEscalationList,
  useReleaseGateRunDetail,
  useReleaseGateRunList,
  useReleaseGateRunnerStatus,
  useReleasePolicyOverrides,
  useReleaseReportDetail,
  useReleaseReportList,
  useResolveReleaseEscalation,
  useTriggerReleaseGateRun,
} from '@/lib/hooks/use-release-ops';
import { ReleaseOpsDashboard } from '@/components/runtime/ReleaseOpsDashboard';
import { UsageOperationsSummary } from '@/components/audit-usage/UsageOperationsSummary';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { SectionHeading } from '@/components/ui/section-heading';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { evaluateReleasePolicy } from '@/lib/release-policy';
import { Textarea } from '@/components/ui/textarea';
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';
import { buildGovernanceDrilldownQuery, parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';
import { buildReleaseOpsGovernanceEvidenceSnapshot } from '@/lib/release-ops-governance-evidence';

interface ReleaseOpsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

function defaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

function defaultOverrideExpiryLocal() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDateTime(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function yesNoBadge(value: boolean | undefined) {
  return value ? 'outline' : 'secondary';
}

function mapReleaseDecisionStatus(value?: string): React.ComponentProps<typeof StatusBadge>['status'] {
  if (value === 'blocked') return 'blocked';
  if (value === 'warning') return 'warning';
  if (value === 'pending_override') return 'pending_override';
  if (value === 'releasable_with_override') return 'releasable_with_override';
  return 'ready';
}

function mapSlaStatus(value?: string): React.ComponentProps<typeof StatusBadge>['status'] {
  if (value === 'overdue') return 'overdue';
  if (value === 'due_soon') return 'due_soon';
  if (value === 'resolved') return 'ready';
  return 'info';
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
}

function formatDurationMs(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${Math.round(value)}ms`;
}

function formatAgeMs(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return '--';
  const totalMinutes = Math.round(value / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function recommendationForCheck(category?: string, name?: string): string {
  const normalized = `${category ?? ''} ${name ?? ''}`.toLowerCase();
  if (normalized.includes('governance')) return 'Re-run governance smoke with a clean real-backend session and verify auth/workspace recovery.';
  if (normalized.includes('pricing')) return 'Review runtime pricing coverage and clear missing-price blockers before accepting the report.';
  if (normalized.includes('visual')) return 'Regenerate visual baselines only after confirming the UI delta is intentional.';
  if (normalized.includes('typecheck')) return 'Fix type or contract regressions before continuing with broader verification.';
  if (normalized.includes('runtime')) return 'Check runtime guardrails, provider routing, and fallback evidence before retrying the gate.';
  return 'Inspect the failed check in its owning workflow and re-run the release gate after the underlying issue is corrected.';
}

function commandForCheck(category?: string, name?: string): string {
  const normalized = `${category ?? ''} ${name ?? ''}`.toLowerCase();
  if (normalized.includes('governance')) return 'make governance-release-smoke';
  if (normalized.includes('pricing')) return 'npm run release:report -- --name pricing-coverage-recheck';
  if (normalized.includes('visual')) return 'BASE_URL=http://localhost:3002 npx playwright test --project=visual e2e/visual.spec.ts --update-snapshots';
  if (normalized.includes('typecheck')) return 'npm run ws:typecheck';
  if (normalized.includes('runtime')) return 'make notebook-agent-release-smoke-full';
  return 'npm run release:report -- --name rerun-release-check';
}

function downloadTextFile(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export default function ReleaseOpsPage({ params }: ReleaseOpsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drilldownContext = useMemo(() => parseGovernanceDrilldownContext(searchParams), [searchParams]);
  const errorsT = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const usageT = useTranslations('usage');
  const commonT = useTranslations('common');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const [timeRange] = useState(defaultTimeRange);
  const canReadUsage = useHasPermission('project:usage:view');
  const searchParamsKey = searchParams.toString();
  const [selectedReportName, setSelectedReportName] = useState<string | undefined>(searchParams.get('report') ?? undefined);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(searchParams.get('run') ?? undefined);
  const [selectedEscalationId, setSelectedEscalationId] = useState<string | undefined>(searchParams.get('escalation') ?? undefined);
  const [reportSearch, setReportSearch] = useState(searchParams.get('report_search') ?? '');
  const [reportStatusFilter, setReportStatusFilter] = useState<'all' | 'pass' | 'fail'>(
    searchParams.get('report_status') === 'pass' || searchParams.get('report_status') === 'fail'
      ? searchParams.get('report_status') as 'pass' | 'fail'
      : 'all',
  );
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'pass' | 'fail'>(
    searchParams.get('run_status') === 'pass' || searchParams.get('run_status') === 'fail'
      ? searchParams.get('run_status') as 'pass' | 'fail'
      : 'all',
  );
  const [runTriggerFilter, setRunTriggerFilter] = useState<'all' | 'manual' | 'scheduled' | 'ci' | 'unknown'>(
    searchParams.get('run_trigger') === 'manual'
      || searchParams.get('run_trigger') === 'scheduled'
      || searchParams.get('run_trigger') === 'ci'
      || searchParams.get('run_trigger') === 'unknown'
      ? searchParams.get('run_trigger') as 'manual' | 'scheduled' | 'ci' | 'unknown'
      : 'all',
  );
  const [failedCheckCategoryFilter, setFailedCheckCategoryFilter] = useState<string>(searchParams.get('failed_check_category') ?? 'all');
  const [overrideIssueId, setOverrideIssueId] = useState<string>('none');
  const [overrideReasonCategory, setOverrideReasonCategory] = useState<'upstream_transient' | 'known_acceptable_risk' | 'rollout_exception' | 'governance_window'>('rollout_exception');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideExpiresAt, setOverrideExpiresAt] = useState(defaultOverrideExpiryLocal);
  const [resolutionReason, setResolutionReason] = useState('');
  const [resolutionCategory, setResolutionCategory] = useState<'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred'>('mitigated');
  const [escalationAssigneeUserId, setEscalationAssigneeUserId] = useState('');
  const [escalationAssigneeName, setEscalationAssigneeName] = useState('');
  const [escalationDueAt, setEscalationDueAt] = useState('');
  const [gateRunNotes, setGateRunNotes] = useState('');

  useEffect(() => {
    params.then((p) => setResolvedParams({
      workspace: validateWorkspaceParam(p.workspace),
      project: validateProjectParam(p.project),
      locale: p.locale,
    }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const enabled = !!workspaceId && !!projectId && canReadUsage;

  const runtimeQuery = useRuntimeObservability(workspaceId, projectId, timeRange, { enabled });
  const summaryQuery = useUsageOperationsSummary(workspaceId, projectId, timeRange, { enabled });
  const evidenceQuery = useUsageReportEvidence(workspaceId, projectId, { enabled });
  const schedulesQuery = useUsageReportSchedules(workspaceId, projectId, { enabled });
  const reportsQuery = useReleaseReportList({ workspaceId, projectId }, { enabled });
  const escalationsQuery = useReleaseEscalationList({ enabled });
  const escalationDetailQuery = useReleaseEscalationDetail(selectedEscalationId, { enabled });
  const runsQuery = useReleaseGateRunList({ workspaceId, projectId }, { enabled });
  const runDetailQuery = useReleaseGateRunDetail(selectedRunId, { workspaceId, projectId }, { enabled });
  const gateRunnerQuery = useReleaseGateRunnerStatus({ enabled, refetchInterval: 3000 });
  const reportDetailQuery = useReleaseReportDetail(selectedReportName, { workspaceId, projectId }, { enabled });
  const overridesQuery = useReleasePolicyOverrides(workspaceId, projectId, selectedReportName, { enabled });
  const acknowledgeEscalationMutation = useAcknowledgeReleaseEscalation();
  const assignEscalationMutation = useAssignReleaseEscalation();
  const resolveEscalationMutation = useResolveReleaseEscalation();
  const triggerGateRunMutation = useTriggerReleaseGateRun();
  const createOverrideMutation = useCreateReleasePolicyOverride();
  const decideOverrideMutation = useDecideReleasePolicyOverride();

  const refresh = () => {
    runtimeQuery.refetch();
    summaryQuery.refetch();
    evidenceQuery.refetch();
    schedulesQuery.refetch();
    reportsQuery.refetch();
    escalationsQuery.refetch();
    escalationDetailQuery.refetch();
    runsQuery.refetch();
    runDetailQuery.refetch();
    gateRunnerQuery.refetch();
    reportDetailQuery.refetch();
  };

  const blockers = evidenceQuery.data?.blockers ?? [];
  const warnings = evidenceQuery.data?.warnings ?? [];
  const topSchedules = useMemo(
    () => (schedulesQuery.data?.items ?? []).slice(0, 5),
    [schedulesQuery.data?.items],
  );
  const releaseReports = useMemo(
    () => reportsQuery.data?.items ?? [],
    [reportsQuery.data?.items],
  );
  const filteredReleaseReports = useMemo(
    () => releaseReports.filter((item) => {
      const matchesSearch = !reportSearch.trim()
        || item.name.toLowerCase().includes(reportSearch.trim().toLowerCase())
        || (item.branch ?? '').toLowerCase().includes(reportSearch.trim().toLowerCase())
        || (item.commit_short ?? '').toLowerCase().includes(reportSearch.trim().toLowerCase());
      const matchesStatus = reportStatusFilter === 'all' || item.status === reportStatusFilter;
      return matchesSearch && matchesStatus;
    }),
    [releaseReports, reportSearch, reportStatusFilter],
  );
  const releaseRuns = useMemo(
    () => runsQuery.data?.items ?? [],
    [runsQuery.data?.items],
  );
  const filteredReleaseRuns = useMemo(
    () => releaseRuns.filter((item) => {
      const matchesStatus = runStatusFilter === 'all' || item.status === runStatusFilter;
      const matchesTrigger = runTriggerFilter === 'all' || item.trigger === runTriggerFilter;
      return matchesStatus && matchesTrigger;
    }),
    [releaseRuns, runStatusFilter, runTriggerFilter],
  );
  const releaseEscalations = useMemo(
    () => (escalationsQuery.data?.items ?? []).slice(0, 6),
    [escalationsQuery.data?.items],
  );
  const governanceEvidenceSnapshot = useMemo(() => {
    if (!drilldownContext) {
      return null;
    }
    return buildReleaseOpsGovernanceEvidenceSnapshot({
      context: drilldownContext,
      runtime: runtimeQuery.data,
      usageEvidence: evidenceQuery.data,
      runs: releaseRuns,
      escalations: releaseEscalations,
    });
  }, [drilldownContext, evidenceQuery.data, releaseEscalations, releaseRuns, runtimeQuery.data]);
  const governanceQuery = useMemo(
    () => (drilldownContext ? buildGovernanceDrilldownQuery(drilldownContext) : ''),
    [drilldownContext],
  );
  const recentReleaseReports = filteredReleaseReports.slice(0, 6);
  const recentPassRate = recentReleaseReports.length > 0
    ? recentReleaseReports.filter((item) => item.status === 'pass').length / recentReleaseReports.length
    : undefined;
  const recentRuntimeBlocked = recentReleaseReports.filter((item) => item.runtime_release_readiness === 'blocked').length;
  const recentUsageBlocked = recentReleaseReports.filter((item) => item.usage_release_readiness === 'blocked').length;

  useEffect(() => {
    const nextReport = searchParams.get('report') ?? undefined;
    const nextRun = searchParams.get('run') ?? undefined;
    const nextEscalation = searchParams.get('escalation') ?? undefined;
    const nextSearch = searchParams.get('report_search') ?? '';
    const nextStatus = searchParams.get('report_status') === 'pass' || searchParams.get('report_status') === 'fail'
      ? searchParams.get('report_status') as 'pass' | 'fail'
      : 'all';
    const nextRunStatus = searchParams.get('run_status') === 'pass' || searchParams.get('run_status') === 'fail'
      ? searchParams.get('run_status') as 'pass' | 'fail'
      : 'all';
    const nextRunTrigger = searchParams.get('run_trigger') === 'manual'
      || searchParams.get('run_trigger') === 'scheduled'
      || searchParams.get('run_trigger') === 'ci'
      || searchParams.get('run_trigger') === 'unknown'
      ? searchParams.get('run_trigger') as 'manual' | 'scheduled' | 'ci' | 'unknown'
      : 'all';
    const nextCategory = searchParams.get('failed_check_category') ?? 'all';
    setSelectedReportName((prev) => prev === nextReport ? prev : nextReport);
    setSelectedRunId((prev) => prev === nextRun ? prev : nextRun);
    setSelectedEscalationId((prev) => prev === nextEscalation ? prev : nextEscalation);
    setReportSearch((prev) => prev === nextSearch ? prev : nextSearch);
    setReportStatusFilter((prev) => prev === nextStatus ? prev : nextStatus);
    setRunStatusFilter((prev) => prev === nextRunStatus ? prev : nextRunStatus);
    setRunTriggerFilter((prev) => prev === nextRunTrigger ? prev : nextRunTrigger);
    setFailedCheckCategoryFilter((prev) => prev === nextCategory ? prev : nextCategory);
  }, [searchParams, searchParamsKey]);

  useEffect(() => {
    if (!selectedReportName && filteredReleaseReports.length > 0) {
      setSelectedReportName(filteredReleaseReports[0]?.name);
      return;
    }
    if (selectedReportName && !filteredReleaseReports.some((item) => item.name === selectedReportName)) {
      setSelectedReportName(filteredReleaseReports[0]?.name);
    }
  }, [filteredReleaseReports, selectedReportName]);

  useEffect(() => {
    if (!selectedRunId && filteredReleaseRuns.length > 0) {
      setSelectedRunId(filteredReleaseRuns[0]?.id);
      return;
    }
    if (selectedRunId && !filteredReleaseRuns.some((item) => item.id === selectedRunId)) {
      setSelectedRunId(filteredReleaseRuns[0]?.id);
    }
  }, [filteredReleaseRuns, selectedRunId]);

  useEffect(() => {
    if (!selectedEscalationId && releaseEscalations.length > 0) {
      setSelectedEscalationId(releaseEscalations[0]?.id);
      return;
    }
    if (selectedEscalationId && !releaseEscalations.some((item) => item.id === selectedEscalationId)) {
      setSelectedEscalationId(releaseEscalations[0]?.id);
    }
  }, [releaseEscalations, selectedEscalationId]);

  useEffect(() => {
    const params = new URLSearchParams(searchParamsKey);
    const nextReport = selectedReportName ?? '';
    const nextSearch = reportSearch.trim();
    const nextStatus = reportStatusFilter;
    const nextCategory = failedCheckCategoryFilter;
    let changed = false;

    if ((params.get('report') ?? '') !== nextReport) {
      changed = true;
      if (nextReport) params.set('report', nextReport);
      else params.delete('report');
    }
    if ((params.get('run') ?? '') !== (selectedRunId ?? '')) {
      changed = true;
      if (selectedRunId) params.set('run', selectedRunId);
      else params.delete('run');
    }
    if ((params.get('escalation') ?? '') !== (selectedEscalationId ?? '')) {
      changed = true;
      if (selectedEscalationId) params.set('escalation', selectedEscalationId);
      else params.delete('escalation');
    }
    if ((params.get('report_search') ?? '') !== nextSearch) {
      changed = true;
      if (nextSearch) params.set('report_search', nextSearch);
      else params.delete('report_search');
    }
    const currentStatus = params.get('report_status') ?? 'all';
    if (currentStatus !== nextStatus) {
      changed = true;
      if (nextStatus === 'all') params.delete('report_status');
      else params.set('report_status', nextStatus);
    }
    const currentRunStatus = params.get('run_status') ?? 'all';
    if (currentRunStatus !== runStatusFilter) {
      changed = true;
      if (runStatusFilter === 'all') params.delete('run_status');
      else params.set('run_status', runStatusFilter);
    }
    const currentRunTrigger = params.get('run_trigger') ?? 'all';
    if (currentRunTrigger !== runTriggerFilter) {
      changed = true;
      if (runTriggerFilter === 'all') params.delete('run_trigger');
      else params.set('run_trigger', runTriggerFilter);
    }
    const currentCategory = params.get('failed_check_category') ?? 'all';
    if (currentCategory !== nextCategory) {
      changed = true;
      if (nextCategory === 'all') params.delete('failed_check_category');
      else params.set('failed_check_category', nextCategory);
    }

    if (!changed) return;
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [failedCheckCategoryFilter, pathname, reportSearch, reportStatusFilter, router, runStatusFilter, runTriggerFilter, searchParamsKey, selectedEscalationId, selectedReportName, selectedRunId]);

  const reportSummary = (reportDetailQuery.data?.report as {
    summary?: {
      status?: string;
      runtime_release_evidence?: {
        generated_at?: string;
        guardrails?: {
          release_readiness?: 'ready' | 'blocked';
          target?: string;
          planned_attempts?: number;
          blockers?: string[];
          warnings?: string[];
        };
        pricing_version_coverage?: {
          total_usage_facts?: number;
          covered_usage_facts?: number;
          missing_usage_facts?: number;
          missing_price_facts?: number;
          coverage_ratio?: number;
        };
      };
      usage_report_evidence?: {
        release_readiness?: 'ready' | 'blocked';
        active_schedules?: number;
        required_schedules?: number;
        successful_deliveries_last_7d?: number;
        failed_deliveries_last_7d?: number;
        unacknowledged_required_deliveries?: number;
        blockers?: string[];
        warnings?: string[];
        runner_health?: {
          enabled?: boolean;
          last_status?: 'idle' | 'success' | 'failed';
          run_count?: number;
        };
      };
      release_policy?: {
        decision?: 'ready' | 'warning' | 'blocked';
        blockers?: Array<{ id?: string; source?: string; message?: string; overridable?: boolean }>;
        warnings?: Array<{ id?: string; source?: string; message?: string; overridable?: boolean }>;
        summary?: {
          total_issues?: number;
          blocker_count?: number;
          warning_count?: number;
          overridable_count?: number;
        };
      };
    };
  } | undefined)?.summary;
  const reportExecution = (reportDetailQuery.data?.report as {
    execution?: {
      total_checks?: number;
      passed?: number;
      failed?: number;
      skipped?: number;
      checks?: Array<{
        name?: string;
        category?: string;
        status?: string;
        duration_ms?: number;
      }>;
    };
  } | undefined)?.execution;
  const selectedReportSummary = JSON.stringify(reportSummary ?? {}, null, 2);
  const failedChecks = (reportExecution?.checks ?? []).filter((check) => check.status === 'fail');
  const failedCheckCategories = Array.from(new Set(failedChecks.map((check) => check.category ?? 'uncategorized')));
  const filteredFailedChecks = failedChecks.filter((check) => failedCheckCategoryFilter === 'all' || (check.category ?? 'uncategorized') === failedCheckCategoryFilter);
  const latestReport = filteredReleaseReports[0];
  const latestRuntimeReadiness = latestReport?.runtime_release_readiness ?? '--';
  const latestUsageReadiness = latestReport?.usage_release_readiness ?? '--';
  const currentRuntimeReadiness = runtimeQuery.data && runtimeQuery.data.health_summary.terminal_error_requests === 0 ? 'ready' : 'blocked';
  const currentUsageReadiness = evidenceQuery.data?.release_readiness ?? '--';
  const runtimeReadinessChanged = String(currentRuntimeReadiness) !== String(latestRuntimeReadiness);
  const usageReadinessChanged = String(currentUsageReadiness) !== String(latestUsageReadiness);
  const currentRuntimeBlockerCount = runtimeQuery.data?.health_summary.terminal_error_requests ?? 0;
  const currentUsageBlockerCount = blockers.length;
  const latestRuntimeBlockerCount = reportSummary?.runtime_release_evidence?.guardrails?.blockers?.length ?? 0;
  const latestUsageBlockerCount = reportSummary?.usage_report_evidence?.blockers?.length ?? 0;
  const latestRuntimeWarningCount = reportSummary?.runtime_release_evidence?.guardrails?.warnings?.length ?? 0;
  const latestUsageWarningCount = reportSummary?.usage_report_evidence?.warnings?.length ?? 0;
  const selectedReportTimestamp = ((reportDetailQuery.data?.report as { metadata?: { timestamp?: string } } | undefined)?.metadata?.timestamp)
    ?? reportSummary?.runtime_release_evidence?.generated_at;
  const contextWindowEnd = selectedReportTimestamp;
  const contextWindowStart = selectedReportTimestamp
    ? new Date(new Date(selectedReportTimestamp).getTime() - 24 * 60 * 60 * 1000).toISOString()
    : undefined;
  const traceSharedFilters = {
    start_time: contextWindowStart ?? timeRange.start_time,
    end_time: contextWindowEnd ?? timeRange.end_time,
    result: 'error' as const,
  };
  const runtimeContextHref = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/runtime-observability${buildSharedOpsFilterQuery({
    start_time: contextWindowStart,
    end_time: contextWindowEnd,
    result: reportSummary?.runtime_release_evidence?.guardrails?.release_readiness === 'blocked' ? 'error' : undefined,
  })}`;
  const usageContextHref = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage${buildSharedOpsFilterQuery({
    start_time: contextWindowStart,
    end_time: contextWindowEnd,
    result: (reportSummary?.usage_report_evidence?.failed_deliveries_last_7d ?? 0) > 0 ? 'error' : undefined,
  }, { panel: 'usage' })}`;
  const longRangeReports = filteredReleaseReports.slice(0, 12);
  const longRangePassRate = longRangeReports.length > 0
    ? longRangeReports.filter((item) => item.status === 'pass').length / longRangeReports.length
    : undefined;
  const longRangeRuntimeBlocked = longRangeReports.filter((item) => item.runtime_release_readiness === 'blocked').length;
  const longRangeUsageBlocked = longRangeReports.filter((item) => item.usage_release_readiness === 'blocked').length;
  const recentReleaseRuns = filteredReleaseRuns.slice(0, 8);
  const selectedRun = runDetailQuery.data;
  const selectedEscalation = escalationDetailQuery.data;
  useEffect(() => {
    setEscalationAssigneeUserId(selectedEscalation?.assignee_user_id ?? '');
    setEscalationAssigneeName(selectedEscalation?.assignee_name ?? '');
    setEscalationDueAt(selectedEscalation?.due_at ? selectedEscalation.due_at.slice(0, 16) : '');
    setResolutionCategory(selectedEscalation?.resolution_category ?? 'mitigated');
    setResolutionReason(selectedEscalation?.resolution_reason ?? '');
  }, [
    selectedEscalation?.assignee_name,
    selectedEscalation?.assignee_user_id,
    selectedEscalation?.due_at,
    selectedEscalation?.resolution_category,
    selectedEscalation?.resolution_reason,
  ]);
  const runPassRate = recentReleaseRuns.length > 0
    ? recentReleaseRuns.filter((item) => item.status === 'pass').length / recentReleaseRuns.length
    : undefined;
  const livePolicy = evaluateReleasePolicy({
    runtime: runtimeQuery.data ? {
      release_readiness: currentRuntimeReadiness === 'ready' ? 'ready' : 'blocked',
      blockers: currentRuntimeReadiness === 'blocked' ? ['live_runtime_terminal_errors_present'] : [],
      warnings: [],
      missing_price_facts: runtimeQuery.data.health_summary.missing_price_facts,
    } : undefined,
    usage: evidenceQuery.data ? {
      release_readiness: evidenceQuery.data.release_readiness,
      blockers: evidenceQuery.data.blockers,
      warnings: evidenceQuery.data.warnings,
      required_schedules: evidenceQuery.data.required_schedules,
      unacknowledged_required_deliveries: evidenceQuery.data.unacknowledged_required_deliveries,
      runner_health: evidenceQuery.data.runner_health ? {
        enabled: evidenceQuery.data.runner_health.enabled,
        last_status: evidenceQuery.data.runner_health.last_status,
        run_count: evidenceQuery.data.runner_health.run_count,
      } : undefined,
    } : undefined,
    governance: {
      open_escalations: releaseEscalations.filter((item) => item.status !== 'resolved').length,
      critical_unassigned: releaseEscalations.filter((item) =>
        item.status !== 'resolved' && item.severity === 'critical' && !(item.assignee_user_id ?? '').trim()).length,
      critical_overdue: releaseEscalations.filter((item) =>
        item.status !== 'resolved' && item.severity === 'critical' && item.sla_status === 'overdue').length,
      due_soon: releaseEscalations.filter((item) =>
        item.status !== 'resolved' && item.sla_status === 'due_soon').length,
    },
  });
  const artifactPolicy = reportSummary?.release_policy;
  const artifactPolicyEnforcement = reportDetailQuery.data?.policy_enforcement;
  const latestArtifactEnforcement = latestReport?.policy_enforcement;
  const overridablePolicyIssues = [
    ...(artifactPolicy?.warnings ?? []),
    ...(artifactPolicy?.blockers ?? []).filter((issue) => issue.overridable),
  ];
  const selectedIncidentId = selectedEscalation?.incident_id
    ?? selectedRun?.incident_id
    ?? overridesQuery.data?.items[0]?.incident_id
    ?? (selectedReportName ? `incident-${selectedReportName}` : undefined);
  const incidentEscalations = releaseEscalations.filter((item) => !selectedIncidentId || item.incident_id === selectedIncidentId);
  const incidentRuns = releaseRuns.filter((item) => !selectedIncidentId || item.incident_id === selectedIncidentId);
  const incidentOverrides = (overridesQuery.data?.items ?? []).filter((item) => !selectedIncidentId || item.incident_id === selectedIncidentId);
  const incidentLatestRun = [...incidentRuns].sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0];
  const incidentPrimaryEscalation = selectedEscalation ?? incidentEscalations[0];
  const incidentSummary = selectedIncidentId ? {
    openEscalations: incidentEscalations.filter((item) => item.status !== 'resolved').length,
    resolvedEscalations: incidentEscalations.filter((item) => item.status === 'resolved').length,
    pendingOverrides: incidentOverrides.filter((item) => item.effective_status === 'pending' || item.status === 'pending').length,
    approvedOverrides: incidentOverrides.filter((item) => item.effective_status === 'approved' || item.status === 'approved').length,
    latestRunStatus: incidentLatestRun?.status,
    latestRunId: incidentLatestRun?.id,
    owner: incidentPrimaryEscalation?.assignee_name ?? incidentPrimaryEscalation?.assignee_user_id,
    slaStatus: incidentPrimaryEscalation?.sla_status,
    resolutionCategory: incidentPrimaryEscalation?.resolution_category,
  } : null;
  const incidentTrace = [
    ...incidentEscalations
      .map((item) => ({
        id: `escalation-${item.id}`,
        kind: 'escalation',
        timestamp: item.created_at,
        title: item.title,
        meta: `${item.event_type} · ${item.status}`,
      })),
    ...(selectedEscalation?.acknowledged_at ? [{
      id: `escalation-ack-${selectedEscalation.id}`,
      kind: 'ack',
      timestamp: selectedEscalation.acknowledged_at,
      title: settingsT('release_ops_escalations_acknowledge'),
      meta: selectedEscalation.acknowledged_by_name ?? selectedEscalation.acknowledged_by_user_id ?? '--',
    }] : []),
    ...((selectedEscalation?.incident_history ?? []).map((item) => ({
      id: `history-${item.id}`,
      kind: 'assignment',
      timestamp: item.created_at,
      title: settingsT('release_ops_escalations_assignment'),
      meta: `${item.previous_assignee_name ?? item.previous_assignee_user_id ?? '--'} -> ${item.next_assignee_name ?? item.next_assignee_user_id} · ${item.actor_name ?? item.actor_user_id}`,
    }))),
    ...(selectedEscalation?.resolved_at ? [{
      id: `escalation-resolution-${selectedEscalation.id}`,
      kind: 'resolution',
      timestamp: selectedEscalation.resolved_at,
      title: selectedEscalation.status === 'resolved'
        ? settingsT('release_ops_escalations_resolve')
        : settingsT('release_ops_escalations_reopen'),
      meta: `${selectedEscalation.resolution_category ?? '--'} · ${selectedEscalation.resolved_by_name ?? selectedEscalation.resolved_by_user_id ?? '--'}`,
    }] : []),
    ...incidentRuns
      .map((item) => ({
        id: `run-${item.id}`,
        kind: 'run',
        timestamp: item.completed_at,
        title: item.id,
        meta: `${item.trigger} · ${item.status}`,
      })),
    ...(incidentOverrides
      .map((item) => ({
      id: `override-${item.id}`,
      kind: 'override',
      timestamp: item.decided_at ?? item.created_at,
      title: item.issue_message,
      meta: `${item.issue_source} · ${item.status}`,
    }))),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // no-op; command is still visible inline
    }
  };
  const submitOverride = async () => {
    const selectedIssue = overridablePolicyIssues.find((issue) => issue.id === overrideIssueId);
    if (!selectedIssue || !selectedReportName || !overrideReason.trim() || !overrideExpiresAt) return;
    await createOverrideMutation.mutateAsync({
      workspace_id: workspaceId,
      project_id: projectId,
      report_name: selectedReportName,
      incident_id: selectedIncidentId ?? `incident-${selectedReportName}`,
      issue_id: selectedIssue.id ?? 'unknown_issue',
      issue_source: (selectedIssue.source as 'execution' | 'runtime' | 'usage') ?? 'runtime',
      issue_message: selectedIssue.message ?? '',
      reason_category: overrideReasonCategory,
      reason: overrideReason.trim(),
      expires_at: new Date(overrideExpiresAt).toISOString(),
    });
    setOverrideIssueId('none');
    setOverrideReasonCategory('rollout_exception');
    setOverrideReason('');
    setOverrideExpiresAt(defaultOverrideExpiryLocal());
  };
  const decideOverride = async (overrideId: string, status: 'approved' | 'rejected') => {
    if (!selectedReportName) return;
    await decideOverrideMutation.mutateAsync({
      overrideId,
      workspaceId,
      projectId,
      reportName: selectedReportName,
      status,
    });
  };
  const triggerGateRun = async (mode: 'full' | 'failed_only') => {
    await triggerGateRunMutation.mutateAsync({
      mode,
      source_run_id: mode === 'failed_only' ? selectedRunId : undefined,
      notes: gateRunNotes.trim() || undefined,
    });
    setGateRunNotes('');
  };
  const acknowledgeEscalation = async () => {
    if (!selectedEscalationId) return;
    await acknowledgeEscalationMutation.mutateAsync({ escalationId: selectedEscalationId });
  };
  const assignEscalation = async () => {
    if (!selectedEscalationId || !escalationAssigneeUserId.trim()) return;
    await assignEscalationMutation.mutateAsync({
      escalationId: selectedEscalationId,
      assignee_user_id: escalationAssigneeUserId.trim(),
      assignee_name: escalationAssigneeName.trim() || undefined,
      due_at: escalationDueAt ? new Date(escalationDueAt).toISOString() : undefined,
    });
  };
  const updateEscalationResolution = async (status: 'open' | 'resolved') => {
    if (!selectedEscalationId) return;
    await resolveEscalationMutation.mutateAsync({
      escalationId: selectedEscalationId,
      status,
      reason: resolutionReason.trim() || undefined,
      category: status === 'resolved' ? resolutionCategory : undefined,
    });
    if (status === 'resolved') {
      setResolutionReason('');
      setResolutionCategory('mitigated');
    }
  };

  if (!resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{errorsT('validation_error')}</h2>
          <p className="text-sm text-tertiary">{errorsT('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadUsage) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{errorsT('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{errorsT('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={settingsT('release_ops_title')}
            subtitle={settingsT('release_ops_subtitle')}
            actions={(
              <>
                <Button
                  type="button"
                  variant="action"
                  size="sm"
                  onClick={() => void triggerGateRun('full')}
                  disabled={gateRunnerQuery.data?.running || triggerGateRunMutation.isPending}
                  data-testid="release-ops__header-trigger-full"
                >
                  {settingsT('release_ops_runner_trigger_full')}
                </Button>
                <Link
                  href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/runtime-observability`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="release-ops__open-runtime-observability"
                >
                  {settingsT('runtime_observability_open_console')}
                </Link>
                <Link
                  href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="release-ops__open-usage"
                >
                  {usageT('title')}
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refresh}
                  disabled={runtimeQuery.isFetching || summaryQuery.isFetching || evidenceQuery.isFetching}
                  data-testid="release-ops__refresh"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${(runtimeQuery.isFetching || summaryQuery.isFetching || evidenceQuery.isFetching) ? 'animate-spin' : ''}`} />
                  {commonT('refresh')}
                </Button>
              </>
            )}
          />
        )}
      >
        {drilldownContext ? (
          <GovernanceDrilldownBanner context={drilldownContext} locale={locale} />
        ) : null}
        <div className="space-y-3" data-testid="release-ops__page">
          {governanceEvidenceSnapshot ? (
            <section className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__governance-evidence-bridge">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <SectionHeading
                  eyebrow={commonT('review')}
                  title={settingsT('release_ops_governance_evidence_title')}
                  subtitle={settingsT('release_ops_governance_evidence_subtitle')}
                />
                <StatusBadge status={governanceEvidenceSnapshot.focus === 'other' ? 'info' : 'warning'}>
                  {settingsT(`release_ops_governance_focus_${governanceEvidenceSnapshot.focus}`)}
                </StatusBadge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <GovernanceEvidenceMetric
                  testId="release-ops__governance-signals-total"
                  label={settingsT('release_ops_governance_metric_total_signals')}
                  value={governanceEvidenceSnapshot.totalSignals}
                />
                <GovernanceEvidenceMetric
                  testId="release-ops__governance-signals-blocked"
                  label={settingsT('release_ops_governance_metric_blocked_signals')}
                  value={governanceEvidenceSnapshot.blockedSignals}
                />
                <GovernanceEvidenceMetric
                  testId="release-ops__governance-signals-warning"
                  label={settingsT('release_ops_governance_metric_warning_signals')}
                  value={governanceEvidenceSnapshot.warningSignals}
                />
                {governanceEvidenceSnapshot.metrics.map((metric) => (
                  <GovernanceEvidenceMetric
                    key={metric.key}
                    testId={`release-ops__governance-metric-${metric.key}`}
                    label={settingsT(`release_ops_governance_metric_${metric.key}`)}
                    value={metric.value}
                  />
                ))}
              </div>
              <div className="mt-3 space-y-2" data-testid="release-ops__governance-evidence-trace">
                <p className="text-[11px] uppercase tracking-wide text-tertiary">
                  {settingsT('release_ops_governance_trace_title')}
                </p>
                {governanceEvidenceSnapshot.trace.length === 0 ? (
                  <p className="text-xs text-tertiary">{settingsT('release_ops_governance_trace_empty')}</p>
                ) : (
                  governanceEvidenceSnapshot.trace.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-subtle bg-bg-base/10 px-3 py-2 text-xs text-tertiary"
                      data-testid={`release-ops__governance-trace-item--${item.id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-medium text-foreground">
                            {settingsT(`release_ops_governance_trace_source_${item.source}`)}
                          </span>
                          {' · '}
                          <span>{item.message}</span>
                          {item.timestamp ? (
                            <>
                              {' · '}
                              <span>{formatDateTime(item.timestamp)}</span>
                            </>
                          ) : null}
                        </div>
                        <Link
                          href={buildTraceDetailHref({
                            locale,
                            workspaceId,
                            projectId,
                            source: item.source,
                            sharedFilters: traceSharedFilters,
                            governanceQuery,
                          })}
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                          data-testid={`release-ops__governance-trace-open--${item.id}`}
                        >
                          {settingsT('release_ops_governance_trace_open')}
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
          <ReleaseOpsDashboard
            runtime={runtimeQuery.data}
            usageEvidence={evidenceQuery.data}
            operationsSummary={summaryQuery.data}
            loading={runtimeQuery.isLoading || summaryQuery.isLoading || evidenceQuery.isLoading}
          />

          <div className="grid gap-3 xl:grid-cols-[1.38fr_1fr]">
            <UsageOperationsSummary
              summary={summaryQuery.data}
              loading={summaryQuery.isLoading}
            />

            <section className="space-y-3">
              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__evidence-summary">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <SectionHeading
                    eyebrow={commonT('review')}
                    title={usageT('report_schedules.evidence_title')}
                    subtitle={usageT('report_schedules.evidence_subtitle')}
                  />
                  {evidenceQuery.data ? (
                    <Badge variant={evidenceQuery.data.release_readiness === 'ready' ? 'outline' : 'secondary'}>
                      {usageT(`report_schedules.release_${evidenceQuery.data.release_readiness}`)}
                    </Badge>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__evidence-blockers">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{usageT('report_schedules.evidence_failed')}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{blockers.length}</div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__evidence-warnings">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{usageT('report_schedules.evidence_unacknowledged')}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{warnings.length}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-xs text-tertiary">
                  {blockers.length === 0 && warnings.length === 0 ? (
                    <div>{settingsT('release_ops_webhook_empty')}</div>
                  ) : null}
                  {blockers.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-lg border border-subtle bg-bg-base/10 px-3 py-2" data-testid={`release-ops__blocker-${index}`}>
                      {item}
                    </div>
                  ))}
                  {warnings.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-lg border border-subtle bg-bg-base/10 px-3 py-2" data-testid={`release-ops__warning-${index}`}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__online-vs-latest">
                <SectionHeading
                  eyebrow={commonT('decide')}
                  title={settingsT('release_ops_compare_title')}
                  subtitle={settingsT('release_ops_compare_subtitle')}
                  className="mb-3"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__compare-runtime">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_runtime')}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={currentRuntimeReadiness === 'ready' ? 'outline' : 'secondary'}>{String(currentRuntimeReadiness)}</Badge>
                      <span className="text-xs text-tertiary">vs {String(latestRuntimeReadiness)}</span>
                      <Badge variant={yesNoBadge(runtimeReadinessChanged)}>{runtimeReadinessChanged ? settingsT('runtime_release_yes') : settingsT('runtime_release_no')}</Badge>
                    </div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__compare-usage">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_usage')}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={currentUsageReadiness === 'ready' ? 'outline' : 'secondary'}>{String(currentUsageReadiness)}</Badge>
                      <span className="text-xs text-tertiary">vs {String(latestUsageReadiness)}</span>
                      <Badge variant={yesNoBadge(usageReadinessChanged)}>{usageReadinessChanged ? settingsT('runtime_release_yes') : settingsT('runtime_release_no')}</Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="release-ops__compare-details">
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__compare-runtime-details">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_runtime_details')}</div>
                    <div className="mt-2 grid gap-2 text-sm text-foreground">
                      <div>{settingsT('release_ops_compare_live_blockers')}: {currentRuntimeBlockerCount}</div>
                      <div>{settingsT('release_ops_compare_report_blockers')}: {latestRuntimeBlockerCount}</div>
                      <div>{settingsT('release_ops_compare_report_warnings')}: {latestRuntimeWarningCount}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__compare-usage-details">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_usage_details')}</div>
                    <div className="mt-2 grid gap-2 text-sm text-foreground">
                      <div>{settingsT('release_ops_compare_live_blockers')}: {currentUsageBlockerCount}</div>
                      <div>{settingsT('release_ops_compare_report_blockers')}: {latestUsageBlockerCount}</div>
                      <div>{settingsT('release_ops_compare_report_warnings')}: {latestUsageWarningCount}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/20 p-3 sm:col-span-2" data-testid="release-ops__compare-policy-details">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_policy_details')}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={livePolicy.decision === 'ready' ? 'outline' : 'secondary'}>{livePolicy.decision}</Badge>
                      <span className="text-xs text-tertiary">vs {latestArtifactEnforcement?.decision ?? artifactPolicy?.decision ?? '--'}</span>
                      <span className="text-xs text-tertiary">
                        {settingsT('release_ops_compare_live_blockers')}: {livePolicy.summary.blocker_count}
                        {' · '}
                        {settingsT('release_ops_compare_report_blockers')}: {artifactPolicy?.summary?.blocker_count ?? 0}
                        {' · '}
                        {settingsT('release_ops_compare_report_warnings')}: {artifactPolicy?.summary?.warning_count ?? 0}
                      </span>
                      {latestArtifactEnforcement ? (
                        <span className="text-xs text-tertiary">
                          approved:{latestArtifactEnforcement.approved_override_count}
                          {' · '}
                          pending:{latestArtifactEnforcement.pending_override_count}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__schedules">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <SectionHeading
                    eyebrow={commonT('act')}
                    title={usageT('report_schedules.title')}
                    subtitle={usageT('report_schedules.subtitle')}
                  />
                  <Badge variant="outline">{topSchedules.length}</Badge>
                </div>
                <div className="space-y-2">
                  {topSchedules.length === 0 ? (
                    <div className="text-sm text-tertiary">{commonT('empty')}</div>
                  ) : topSchedules.map((schedule, index) => (
                    <div key={schedule.id} className="rounded-lg border border-subtle bg-bg-base/10 px-3 py-2" data-testid={`release-ops__schedule-${index}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                          <div className="text-xs text-tertiary">{schedule.delivery_channel} · {schedule.format} · {schedule.cadence}</div>
                        </div>
                        <StatusBadge status={schedule.status === 'active' ? 'active' : 'paused'}>{schedule.status}</StatusBadge>
                      </div>
                      <div className="mt-2 text-xs text-tertiary">
                        {formatDateTime(schedule.next_run_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__escalations">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <SectionHeading
                    eyebrow={commonT('act')}
                    title={settingsT('release_ops_escalations_title')}
                    subtitle={settingsT('release_ops_escalations_subtitle')}
                  />
                  <Badge variant="outline">{releaseEscalations.length}</Badge>
                </div>
                <div className="space-y-2">
                  {releaseEscalations.length === 0 ? (
                    <div className="text-sm text-tertiary">{settingsT('release_ops_escalations_empty')}</div>
                  ) : releaseEscalations.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left',
                        selectedEscalationId === item.id ? 'border-border bg-bg-base/60' : 'border-subtle bg-bg-base/40 hover:bg-bg-base/60',
                      )}
                      onClick={() => {
                        setSelectedEscalationId(item.id);
                        if (item.artifact_name) setSelectedReportName(item.artifact_name);
                        if (item.run_id) setSelectedRunId(item.run_id);
                      }}
                      data-testid={`release-ops__escalation-${index}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                          <div className="text-xs text-tertiary">{item.event_type} · {formatDateTime(item.created_at)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.severity === 'critical' ? 'secondary' : 'outline'}>{item.severity}</Badge>
                          <StatusBadge status={item.status === 'resolved' ? 'ready' : 'warning'}>{item.status}</StatusBadge>
                        </div>
                      </div>
                      {item.body ? (
                        <div className="mt-2 text-sm text-tertiary">{item.body}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
                {selectedEscalation ? (
                  <div className="mt-3 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__escalation-detail">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={selectedEscalation.severity === 'critical' ? 'secondary' : 'outline'}>{selectedEscalation.severity}</Badge>
                      <StatusBadge status={selectedEscalation.status === 'resolved' ? 'ready' : 'warning'}>{selectedEscalation.status}</StatusBadge>
                      {selectedEscalation.sla_status ? (
                        <StatusBadge status={mapSlaStatus(selectedEscalation.sla_status)}>
                          sla:{selectedEscalation.sla_status}
                        </StatusBadge>
                      ) : null}
                      {selectedEscalation.webhook_delivery ? (
                        <StatusBadge status={selectedEscalation.webhook_delivery.status === 'success' ? 'ready' : selectedEscalation.webhook_delivery.status === 'skipped' ? 'warning' : 'blocked'}>
                          webhook:{selectedEscalation.webhook_delivery.status}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_escalations_delivery')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {selectedEscalation.webhook_delivery?.status ?? '--'}
                          {selectedEscalation.webhook_delivery?.response_status ? ` · ${selectedEscalation.webhook_delivery.response_status}` : ''}
                          {selectedEscalation.webhook_delivery?.duration_ms ? ` · ${formatDurationMs(selectedEscalation.webhook_delivery.duration_ms)}` : ''}
                        </div>
                        {selectedEscalation.webhook_delivery?.error ? (
                          <div className="mt-1 text-xs text-tertiary">{selectedEscalation.webhook_delivery.error}</div>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_escalations_ack')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {selectedEscalation.acknowledged_at
                            ? `${selectedEscalation.acknowledged_by_name ?? selectedEscalation.acknowledged_by_user_id ?? '--'} · ${formatDateTime(selectedEscalation.acknowledged_at)}`
                            : commonT('empty')}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_escalations_owner')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {selectedEscalation.assignee_name ?? selectedEscalation.assignee_user_id ?? commonT('empty')}
                        </div>
                        <div className="mt-1 text-xs text-tertiary">
                          {selectedEscalation.due_at ? `${settingsT('release_ops_escalations_due_at')} · ${formatDateTime(selectedEscalation.due_at)}` : commonT('empty')}
                          {selectedEscalation.age_ms ? ` · ${settingsT('release_ops_escalations_age')} ${formatAgeMs(selectedEscalation.age_ms)}` : ''}
                        </div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_escalations_assignment')}</div>
                        <div className="mt-2 grid gap-2">
                          <Input
                            value={escalationAssigneeUserId}
                            onChange={(event) => setEscalationAssigneeUserId(event.target.value)}
                            placeholder={settingsT('release_ops_escalations_assignee_user_placeholder')}
                            data-testid="release-ops__escalation-assignee-user"
                          />
                          <Input
                            value={escalationAssigneeName}
                            onChange={(event) => setEscalationAssigneeName(event.target.value)}
                            placeholder={settingsT('release_ops_escalations_assignee_name_placeholder')}
                            data-testid="release-ops__escalation-assignee-name"
                          />
                          <Input
                            type="datetime-local"
                            value={escalationDueAt}
                            onChange={(event) => setEscalationDueAt(event.target.value)}
                            data-testid="release-ops__escalation-due-at"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={assignEscalation}
                            disabled={assignEscalationMutation.isPending || !escalationAssigneeUserId.trim()}
                            data-testid="release-ops__escalation-assign"
                          >
                            {settingsT('release_ops_escalations_assign')}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto_auto]">
                      <Textarea
                        value={resolutionReason}
                        onChange={(event) => setResolutionReason(event.target.value)}
                        placeholder={settingsT('release_ops_escalations_resolution_reason_placeholder')}
                        data-testid="release-ops__escalation-resolution-reason"
                      />
                      <Select value={resolutionCategory} onValueChange={(value) => setResolutionCategory(value as typeof resolutionCategory)}>
                        <SelectTrigger data-testid="release-ops__escalation-resolution-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mitigated">{settingsT('release_ops_escalations_category_mitigated')}</SelectItem>
                          <SelectItem value="accepted_risk">{settingsT('release_ops_escalations_category_accepted_risk')}</SelectItem>
                          <SelectItem value="false_positive">{settingsT('release_ops_escalations_category_false_positive')}</SelectItem>
                          <SelectItem value="deferred">{settingsT('release_ops_escalations_category_deferred')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={acknowledgeEscalation}
                        disabled={acknowledgeEscalationMutation.isPending}
                        data-testid="release-ops__escalation-acknowledge"
                      >
                        {settingsT('release_ops_escalations_acknowledge')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => updateEscalationResolution(selectedEscalation.status === 'resolved' ? 'open' : 'resolved')}
                        disabled={resolveEscalationMutation.isPending}
                        data-testid="release-ops__escalation-resolve"
                      >
                        {selectedEscalation.status === 'resolved'
                          ? settingsT('release_ops_escalations_reopen')
                          : settingsT('release_ops_escalations_resolve')}
                      </Button>
                    </div>
                    {selectedEscalation.resolved_at ? (
                      <div className="mt-2 text-xs text-tertiary">
                        {selectedEscalation.resolved_by_name ?? selectedEscalation.resolved_by_user_id} · {formatDateTime(selectedEscalation.resolved_at)}
                        {selectedEscalation.resolution_category ? ` · ${selectedEscalation.resolution_category}` : ''}
                        {selectedEscalation.resolution_reason ? ` · ${selectedEscalation.resolution_reason}` : ''}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {incidentSummary ? (
                  <div className="mt-3 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__incident-summary">
                    <SectionHeading
                      eyebrow={commonT('review')}
                      title={settingsT('release_ops_incident_summary_title')}
                      subtitle={selectedIncidentId}
                      className="mb-3"
                    />
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__incident-summary-escalations">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_incident_summary_escalations')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {incidentSummary.openEscalations} open · {incidentSummary.resolvedEscalations} resolved
                        </div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__incident-summary-overrides">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_incident_summary_overrides')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {incidentSummary.pendingOverrides} pending · {incidentSummary.approvedOverrides} approved
                        </div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__incident-summary-run">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_incident_summary_latest_run')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {incidentSummary.latestRunId ?? '--'}
                        </div>
                        <div className="mt-1 text-xs text-tertiary">{incidentSummary.latestRunStatus ?? '--'}</div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__incident-summary-owner">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_incident_summary_owner')}</div>
                        <div className="mt-1 text-sm text-foreground">{incidentSummary.owner ?? commonT('empty')}</div>
                        <div className="mt-1 text-xs text-tertiary">
                          {incidentSummary.slaStatus ?? '--'}
                          {incidentSummary.resolutionCategory ? ` · ${incidentSummary.resolutionCategory}` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__incident-trace">
                  <SectionHeading
                    eyebrow={commonT('monitor')}
                    title={settingsT('release_ops_incident_trace_title')}
                    subtitle={settingsT('release_ops_incident_trace_subtitle')}
                    className="mb-3"
                  />
                  <div className="space-y-2">
                    {incidentTrace.length === 0 ? (
                      <div className="text-sm text-tertiary">{commonT('empty')}</div>
                    ) : incidentTrace.map((item, index) => (
                      <div key={item.id} className="rounded-lg border border-subtle bg-bg-base/10 px-3 py-2" data-testid={`release-ops__incident-trace-item-${index}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                            <div className="text-xs text-tertiary">{item.meta}</div>
                          </div>
                          <Badge variant="outline">{formatDateTime(item.timestamp)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__reports">
                <SectionHeading
                  eyebrow={commonT('review')}
                  title={settingsT('release_ops_reports_title')}
                  subtitle={settingsT('release_ops_reports_subtitle')}
                  className="mb-3"
                />
                <div className="mb-3 grid gap-3 md:grid-cols-[1fr_180px]">
                  <Input
                    value={reportSearch}
                    onChange={(event) => setReportSearch(event.target.value)}
                    placeholder={settingsT('release_ops_reports_search_placeholder')}
                    data-testid="release-ops__report-search"
                  />
                  <Select value={reportStatusFilter} onValueChange={(value: 'all' | 'pass' | 'fail') => setReportStatusFilter(value)}>
                    <SelectTrigger data-testid="release-ops__report-status-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{settingsT('release_ops_reports_filter_all')}</SelectItem>
                      <SelectItem value="pass">{settingsT('release_ops_reports_filter_pass')}</SelectItem>
                      <SelectItem value="fail">{settingsT('release_ops_reports_filter_fail')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {filteredReleaseReports.length === 0 ? (
                    <div className="text-sm text-tertiary">{settingsT('release_ops_reports_empty')}</div>
                  ) : filteredReleaseReports.slice(0, 6).map((item, index) => (
                    <button
                      key={item.name}
                      type="button"
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left transition-colors',
                        selectedReportName === item.name
                          ? 'border-border bg-bg-base/60'
                          : 'border-subtle bg-bg-base/40 hover:bg-bg-base/60',
                      )}
                      onClick={() => setSelectedReportName(item.name)}
                      data-testid={`release-ops__report-item-${index}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-foreground">{item.name}</div>
                          <div className="text-xs text-tertiary">
                            {item.branch ?? '--'} · {item.commit_short ?? '--'} · {formatDateTime(item.generated_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.status === 'pass' ? 'ready' : 'blocked'}>{item.status}</StatusBadge>
                          {item.policy_enforcement?.decision ?? item.release_policy_decision ? (
                            <Badge variant={(item.policy_enforcement?.decision ?? item.release_policy_decision) === 'ready' ? 'outline' : 'secondary'}>
                              {item.policy_enforcement?.decision ?? item.release_policy_decision}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__timeline">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <SectionHeading
                      eyebrow={commonT('monitor')}
                      title={settingsT('release_ops_timeline_title')}
                      subtitle={settingsT('release_ops_timeline_subtitle')}
                    />
                    <Badge variant="outline">{recentReleaseReports.length}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__timeline-pass-rate">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_timeline_pass_rate')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{formatPercent(recentPassRate)}</div>
                    </div>
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__timeline-runtime-blocked">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_timeline_runtime_blocked')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{recentRuntimeBlocked}</div>
                    </div>
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__timeline-usage-blocked">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_timeline_usage_blocked')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{recentUsageBlocked}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {recentReleaseReports.map((item, index) => (
                      <button
                        key={`timeline-${item.name}`}
                        type="button"
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left',
                          selectedReportName === item.name
                            ? 'border-border bg-surface'
                            : 'border-subtle bg-bg-base/30 hover:bg-bg-base/50',
                        )}
                        onClick={() => setSelectedReportName(item.name)}
                        data-testid={`release-ops__timeline-item-${index}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-foreground">{item.name}</div>
                          <div className="text-xs text-tertiary">{formatDateTime(item.generated_at)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.status === 'pass' ? 'ready' : 'blocked'}>{item.status}</StatusBadge>
                          <Badge variant={item.runtime_release_readiness === 'ready' ? 'outline' : 'secondary'}>{item.runtime_release_readiness ?? '--'}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__history-trend">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <SectionHeading
                      eyebrow={commonT('monitor')}
                      title={settingsT('release_ops_history_title')}
                      subtitle={settingsT('release_ops_history_subtitle')}
                    />
                    <Badge variant="outline">{longRangeReports.length}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__history-pass-rate">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_timeline_pass_rate')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{formatPercent(longRangePassRate)}</div>
                    </div>
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__history-runtime-blocked">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_timeline_runtime_blocked')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{longRangeRuntimeBlocked}</div>
                    </div>
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__history-usage-blocked">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_timeline_usage_blocked')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{longRangeUsageBlocked}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {longRangeReports.map((item, index) => (
                      <div
                        key={`history-${item.name}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-subtle bg-bg-base/10 px-3 py-2"
                        data-testid={`release-ops__history-item-${index}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-foreground">{item.name}</div>
                          <div className="text-xs text-tertiary">{formatDateTime(item.generated_at)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.status === 'pass' ? 'ready' : 'blocked'}>{item.status}</StatusBadge>
                          <Badge variant={item.runtime_release_readiness === 'ready' ? 'outline' : 'secondary'}>
                            {item.runtime_release_readiness ?? '--'}
                          </Badge>
                          <Badge variant={item.usage_release_readiness === 'ready' ? 'outline' : 'secondary'}>
                            {item.usage_release_readiness ?? '--'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__runs">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <SectionHeading
                      eyebrow={commonT('act')}
                      title={settingsT('release_ops_runs_title')}
                      subtitle={settingsT('release_ops_runs_subtitle')}
                    />
                    <Badge variant="outline">{recentReleaseRuns.length}</Badge>
                  </div>
                  <div className="mb-4 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__runner">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runner_title')}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant={gateRunnerQuery.data?.running ? 'secondary' : 'outline'}>
                            {gateRunnerQuery.data?.running ? settingsT('release_ops_runner_running') : settingsT('release_ops_runner_idle')}
                          </Badge>
                          <span className="text-xs text-tertiary">{gateRunnerQuery.data?.current_operation?.report_name ?? '--'}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => triggerGateRun('full')}
                          disabled={gateRunnerQuery.data?.running || triggerGateRunMutation.isPending}
                          data-testid="release-ops__runner-trigger-full"
                        >
                          {settingsT('release_ops_runner_trigger_full')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => triggerGateRun('failed_only')}
                          disabled={gateRunnerQuery.data?.running || triggerGateRunMutation.isPending || !selectedRunId}
                          data-testid="release-ops__runner-trigger-failed-only"
                        >
                          {settingsT('release_ops_runner_trigger_failed_only')}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      className="mt-3"
                      value={gateRunNotes}
                      onChange={(event) => setGateRunNotes(event.target.value)}
                      placeholder={settingsT('release_ops_runner_notes_placeholder')}
                      data-testid="release-ops__runner-notes"
                    />
                    {gateRunnerQuery.data?.recent_operations?.length ? (
                      <div className="mt-3 space-y-2">
                        {gateRunnerQuery.data.recent_operations.slice(0, 3).map((item, index) => (
                          <div key={item.id} className="rounded-lg border border-subtle bg-bg-base/10 px-3 py-2 text-xs text-tertiary" data-testid={`release-ops__runner-operation-${index}`}>
                            {item.mode} · {item.status} · {item.report_name}
                            {item.source_run_id ? ` · source:${item.source_run_id}` : ''}
                            {item.notes ? ` · ${item.notes}` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-[180px_180px_1fr]">
                    <Select value={runStatusFilter} onValueChange={(value: 'all' | 'pass' | 'fail') => setRunStatusFilter(value)}>
                      <SelectTrigger data-testid="release-ops__run-status-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{settingsT('release_ops_reports_filter_all')}</SelectItem>
                        <SelectItem value="pass">{settingsT('release_ops_reports_filter_pass')}</SelectItem>
                        <SelectItem value="fail">{settingsT('release_ops_reports_filter_fail')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={runTriggerFilter} onValueChange={(value: 'all' | 'manual' | 'scheduled' | 'ci' | 'unknown') => setRunTriggerFilter(value)}>
                      <SelectTrigger data-testid="release-ops__run-trigger-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{settingsT('release_ops_runs_filter_all_triggers')}</SelectItem>
                        <SelectItem value="manual">{settingsT('release_ops_runs_trigger_manual')}</SelectItem>
                        <SelectItem value="scheduled">{settingsT('release_ops_runs_trigger_scheduled')}</SelectItem>
                        <SelectItem value="ci">{settingsT('release_ops_runs_trigger_ci')}</SelectItem>
                        <SelectItem value="unknown">{settingsT('release_ops_runs_trigger_unknown')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__run-pass-rate">
                      <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_pass_rate')}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{formatPercent(runPassRate)}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {recentReleaseRuns.length === 0 ? (
                      <div className="text-sm text-tertiary">{settingsT('release_ops_runs_empty')}</div>
                    ) : recentReleaseRuns.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left',
                          selectedRunId === item.id ? 'border-border bg-surface' : 'border-subtle bg-bg-base/30 hover:bg-bg-base/50',
                        )}
                        onClick={() => setSelectedRunId(item.id)}
                        data-testid={`release-ops__run-item-${index}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-foreground">{item.id}</div>
                          <div className="text-xs text-tertiary">
                            {item.trigger} · {formatDurationMs(item.duration_ms)} · {formatDateTime(item.completed_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.status === 'pass' ? 'ready' : 'blocked'}>{item.status}</StatusBadge>
                          {item.failed_step_name ? (
                            <Badge variant="secondary">{item.failed_step_name}</Badge>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                  {selectedRun ? (
                    <div className="mt-3 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__run-detail">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{selectedRun.id}</Badge>
                        <StatusBadge status={selectedRun.status === 'pass' ? 'ready' : 'blocked'}>{selectedRun.status}</StatusBadge>
                        <Badge variant="outline">{selectedRun.trigger}</Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedReportName(selectedRun.artifact_name)}
                          data-testid="release-ops__run-open-artifact"
                        >
                          {settingsT('release_ops_runs_open_artifact')}
                        </Button>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_duration')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{formatDurationMs(selectedRun.duration_ms)}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_failed_step')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{selectedRun.failed_step_name ?? '--'}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_policy')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {selectedRun.policy_enforcement?.decision ?? selectedRun.release_policy_decision ?? '--'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_checks')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{selectedRun.passed_checks}/{selectedRun.total_checks}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_actor')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{selectedRun.actor_name ?? selectedRun.actor_user_id ?? '--'}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3 lg:col-span-2">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_notes')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{selectedRun.notes ?? '--'}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_runtime_readiness')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{selectedRun.runtime_release_readiness ?? '--'}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_usage_readiness')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{selectedRun.usage_release_readiness ?? '--'}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_failed_steps')}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedRun.failed_step_names.length === 0 ? (
                              <span className="text-sm text-tertiary">{commonT('empty')}</span>
                            ) : selectedRun.failed_step_names.map((item, index) => (
                              <Badge key={`${item}-${index}`} variant="secondary">{item}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_runs_failure_categories')}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedRun.failure_categories.length === 0 ? (
                              <span className="text-sm text-tertiary">{commonT('empty')}</span>
                            ) : selectedRun.failure_categories.map((item, index) => (
                              <Badge key={`${item}-${index}`} variant="secondary">{item}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                {reportDetailQuery.data ? (
                  <div className="mt-4 space-y-3 rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__report-detail">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{reportDetailQuery.data.name}</Badge>
                      {reportDetailQuery.data.markdown ? (
                        <Badge variant="outline">{settingsT('release_ops_reports_markdown')}</Badge>
                      ) : null}
                      {reportDetailQuery.data.markdown ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => downloadTextFile(`${reportDetailQuery.data?.name}.md`, reportDetailQuery.data?.markdown ?? '', 'text/markdown; charset=utf-8')}
                          data-testid="release-ops__report-download-markdown"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          {settingsT('release_ops_reports_download_markdown')}
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3" data-testid="release-ops__report-metadata">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_reports_meta_branch')}</div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {((reportDetailQuery.data.report as { metadata?: { git?: { branch?: string } } }).metadata?.git?.branch) ?? '--'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_reports_meta_commit')}</div>
                        <div className="mt-1 font-mono text-sm text-foreground">
                          {((reportDetailQuery.data.report as { metadata?: { git?: { commit_short?: string } } }).metadata?.git?.commit_short) ?? '--'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_reports_meta_generated_at')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {formatDateTime(((reportDetailQuery.data.report as { metadata?: { timestamp?: string } }).metadata?.timestamp))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2" data-testid="release-ops__report-structured-summary">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid="release-ops__report-policy">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_policy_title')}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={mapReleaseDecisionStatus(artifactPolicy?.decision)}>
                            {artifactPolicy?.decision ?? '--'}
                          </StatusBadge>
                          <span className="text-xs text-tertiary">
                            b:{artifactPolicy?.summary?.blocker_count ?? 0}
                            {' · '}
                            w:{artifactPolicy?.summary?.warning_count ?? 0}
                          </span>
                        </div>
                        {artifactPolicyEnforcement ? (
                          <div className="mt-3 rounded-lg border border-subtle bg-bg-base/10 px-3 py-2" data-testid="release-ops__report-policy-enforcement">
                            <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_policy_enforcement')}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <StatusBadge status={mapReleaseDecisionStatus(artifactPolicyEnforcement.decision)}>
                                {artifactPolicyEnforcement.decision}
                              </StatusBadge>
                              <span className="text-xs text-tertiary">
                                base:{artifactPolicyEnforcement.base_decision}
                                {' · '}
                                approved:{artifactPolicyEnforcement.approved_override_count}
                                {' · '}
                                pending:{artifactPolicyEnforcement.pending_override_count}
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-tertiary">
                              unresolved:{artifactPolicyEnforcement.unresolved_blockers.length}
                              {' · '}
                              overridden:{artifactPolicyEnforcement.overridden_blockers.length}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_runtime')}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={reportSummary?.runtime_release_evidence?.guardrails?.release_readiness === 'ready' ? 'ready' : 'blocked'}>
                            {reportSummary?.runtime_release_evidence?.guardrails?.release_readiness ?? '--'}
                          </StatusBadge>
                          <span className="text-xs text-tertiary">
                            b:{reportSummary?.runtime_release_evidence?.guardrails?.blockers?.length ?? 0}
                            {' · '}
                            w:{reportSummary?.runtime_release_evidence?.guardrails?.warnings?.length ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_usage')}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={reportSummary?.usage_report_evidence?.release_readiness === 'ready' ? 'ready' : 'blocked'}>
                            {reportSummary?.usage_report_evidence?.release_readiness ?? '--'}
                          </StatusBadge>
                          <span className="text-xs text-tertiary">
                            b:{reportSummary?.usage_report_evidence?.blockers?.length ?? 0}
                            {' · '}
                            w:{reportSummary?.usage_report_evidence?.warnings?.length ?? 0}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-overrides">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_overrides_title')}</div>
                          <Badge variant="outline">{overridesQuery.data?.items.length ?? 0}</Badge>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[220px_220px_200px_1fr_auto]">
                          <Select value={overrideIssueId} onValueChange={setOverrideIssueId}>
                            <SelectTrigger data-testid="release-ops__override-issue-select">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{settingsT('release_ops_overrides_select_issue')}</SelectItem>
                              {overridablePolicyIssues.map((issue) => (
                                <SelectItem key={issue.id} value={issue.id ?? 'unknown_issue'}>
                                  {issue.source}: {issue.message}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={overrideReasonCategory} onValueChange={(value) => setOverrideReasonCategory(value as typeof overrideReasonCategory)}>
                            <SelectTrigger data-testid="release-ops__override-reason-category">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="upstream_transient">{settingsT('release_ops_overrides_reason_category_upstream_transient')}</SelectItem>
                              <SelectItem value="known_acceptable_risk">{settingsT('release_ops_overrides_reason_category_known_acceptable_risk')}</SelectItem>
                              <SelectItem value="rollout_exception">{settingsT('release_ops_overrides_reason_category_rollout_exception')}</SelectItem>
                              <SelectItem value="governance_window">{settingsT('release_ops_overrides_reason_category_governance_window')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="datetime-local"
                            value={overrideExpiresAt}
                            onChange={(event) => setOverrideExpiresAt(event.target.value)}
                            data-testid="release-ops__override-expires-at"
                          />
                          <Textarea
                            value={overrideReason}
                            onChange={(event) => setOverrideReason(event.target.value)}
                            placeholder={settingsT('release_ops_overrides_reason_placeholder')}
                            data-testid="release-ops__override-reason"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={submitOverride}
                            disabled={overrideIssueId === 'none' || !overrideReason.trim() || createOverrideMutation.isPending}
                            data-testid="release-ops__override-submit"
                          >
                            {settingsT('release_ops_overrides_submit')}
                          </Button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(overridesQuery.data?.items ?? []).length === 0 ? (
                            <div className="text-sm text-tertiary" data-testid="release-ops__override-empty">
                              {settingsT('release_ops_overrides_empty')}
                            </div>
                          ) : (overridesQuery.data?.items ?? []).map((item, index) => (
                            <div key={item.id} className="rounded-md border border-subtle px-3 py-2" data-testid={`release-ops__override-item-${index}`}>
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">{item.issue_source}: {item.issue_message}</div>
                                  <div className="text-xs text-tertiary">{item.created_by_name ?? item.created_by_user_id} · {formatDateTime(item.created_at)}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <StatusBadge status={item.effective_status === 'approved' ? 'releasable_with_override' : item.effective_status === 'expired' ? 'overdue' : item.status === 'pending' ? 'pending_override' : 'warning'}>{item.effective_status ?? item.status}</StatusBadge>
                                  <Badge variant="outline">{item.issue_id}</Badge>
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-tertiary">{item.reason}</div>
                              <div className="mt-1 text-xs text-tertiary">
                                {item.reason_category} · expires {formatDateTime(item.expires_at)}
                              </div>
                              {item.decided_at ? (
                                <div className="mt-2 text-xs text-tertiary">
                                  {item.decided_by_name ?? item.decided_by_user_id} · {formatDateTime(item.decided_at)}
                                </div>
                              ) : null}
                              {item.status === 'pending' ? (
                                <div className="mt-3 flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => decideOverride(item.id, 'approved')}
                                    disabled={decideOverrideMutation.isPending}
                                    data-testid={`release-ops__override-approve-${index}`}
                                  >
                                    {settingsT('release_ops_overrides_approve')}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => decideOverride(item.id, 'rejected')}
                                    disabled={decideOverrideMutation.isPending}
                                    data-testid={`release-ops__override-reject-${index}`}
                                  >
                                    {settingsT('release_ops_overrides_reject')}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-runtime-evidence">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_runtime_evidence')}</div>
                          <Link
                            href={runtimeContextHref}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                            data-testid="release-ops__report-open-runtime-context"
                          >
                            {settingsT('release_ops_open_runtime_context')}
                          </Link>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_target')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.runtime_release_evidence?.guardrails?.target ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_planned_attempts')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.runtime_release_evidence?.guardrails?.planned_attempts ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_coverage')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{formatPercent(reportSummary?.runtime_release_evidence?.pricing_version_coverage?.coverage_ratio)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_missing_price')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.runtime_release_evidence?.pricing_version_coverage?.missing_price_facts ?? '--'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-usage-evidence">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_usage_evidence')}</div>
                          <Link
                            href={usageContextHref}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                            data-testid="release-ops__report-open-usage-context"
                          >
                            {settingsT('release_ops_open_usage_context')}
                          </Link>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_active_schedules')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.active_schedules ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_required_schedules')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.required_schedules ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_successful_deliveries')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.successful_deliveries_last_7d ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_failed_deliveries')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.failed_deliveries_last_7d ?? '--'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-execution-checks">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_execution_checks')}</div>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_total')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.total_checks ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_passed')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.passed ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_failed')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.failed ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_skipped')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.skipped ?? '--'}</div>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(reportExecution?.checks ?? []).slice(0, 5).map((check, index) => (
                            <div key={`${check.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-subtle px-3 py-2" data-testid={`release-ops__report-check-${index}`}>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{check.name ?? '--'}</div>
                                <div className="text-xs text-tertiary">{check.category ?? '--'}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusBadge status={check.status === 'pass' ? 'ready' : 'blocked'}>{check.status ?? '--'}</StatusBadge>
                                <span className="text-xs text-tertiary">{formatDurationMs(check.duration_ms)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-failed-checks">
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_failed_checks')}</div>
                          <Select value={failedCheckCategoryFilter} onValueChange={setFailedCheckCategoryFilter}>
                            <SelectTrigger className="w-[200px]" data-testid="release-ops__failed-check-category-filter">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{settingsT('release_ops_failed_checks_filter_all')}</SelectItem>
                              {failedCheckCategories.map((category) => (
                                <SelectItem key={category} value={category}>{category}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {failedChecks.length === 0 ? (
                          <div className="text-sm text-tertiary" data-testid="release-ops__report-failed-checks-empty">
                            {settingsT('release_ops_failed_checks_empty')}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {filteredFailedChecks.map((check, index) => (
                              <div key={`${check.name}-${index}`} className="rounded-md border border-subtle px-3 py-2" data-testid={`release-ops__report-failed-check-${index}`}>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-foreground">{check.name ?? '--'}</div>
                                    <div className="text-xs text-tertiary">{check.category ?? '--'} · {formatDurationMs(check.duration_ms)}</div>
                                  </div>
                                  <StatusBadge status="blocked">{check.status ?? 'fail'}</StatusBadge>
                                </div>
                                <div className="mt-2 text-xs text-tertiary">
                                  {recommendationForCheck(check.category, check.name)}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <code className="rounded bg-bg-base/60 px-2 py-1 text-[11px] text-foreground" data-testid={`release-ops__report-failed-check-command-${index}`}>
                                    {commandForCheck(check.category, check.name)}
                                  </code>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyCommand(commandForCheck(check.category, check.name))}
                                    data-testid={`release-ops__report-failed-check-copy-${index}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    {settingsT('release_ops_copy_command')}
                                  </Button>
                                  {String(check.category ?? '').includes('governance') ? (
                                    <Link
                                      href={usageContextHref}
                                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                                      data-testid={`release-ops__report-failed-check-open-context-${index}`}
                                    >
                                      {settingsT('release_ops_open_usage_context')}
                                    </Link>
                                  ) : (
                                    <Link
                                      href={runtimeContextHref}
                                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                                      data-testid={`release-ops__report-failed-check-open-context-${index}`}
                                    >
                                      {settingsT('release_ops_open_runtime_context')}
                                    </Link>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <pre className="overflow-x-auto rounded-lg border border-subtle bg-bg-base/20 p-3 text-xs text-foreground" data-testid="release-ops__report-summary-json">
                      {selectedReportSummary}
                    </pre>
                    {reportDetailQuery.data.markdown ? (
                      <div className="rounded-lg border border-subtle bg-bg-base/20 p-3 text-xs text-tertiary" data-testid="release-ops__report-markdown-preview">
                        {reportDetailQuery.data.markdown.slice(0, 600)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function GovernanceEvidenceMetric({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border border-subtle bg-bg-base/20 p-3" data-testid={testId}>
      <div className="text-[11px] uppercase tracking-wide text-tertiary">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function mergeQueryStrings(baseQuery: string, governanceQuery: string): string {
  if (!governanceQuery) {
    return baseQuery;
  }
  if (!baseQuery) {
    return governanceQuery;
  }
  return `${baseQuery}&${governanceQuery.replace(/^\?/, '')}`;
}

function buildTraceDetailHref(args: {
  locale: string;
  workspaceId: string;
  projectId: string;
  source: 'usage_blocker' | 'usage_warning' | 'escalation';
  sharedFilters: {
    start_time: string;
    end_time: string;
    result: 'error';
  };
  governanceQuery: string;
}): string {
  const sharedQuery =
    args.source === 'escalation'
      ? buildSharedOpsFilterQuery(args.sharedFilters)
      : buildSharedOpsFilterQuery(args.sharedFilters, { panel: 'usage' });
  const mergedQuery = mergeQueryStrings(sharedQuery, args.governanceQuery);
  if (args.source === 'escalation') {
    return `/${args.locale}/workspaces/${args.workspaceId}/projects/${args.projectId}/audit${mergedQuery}`;
  }
  return `/${args.locale}/workspaces/${args.workspaceId}/projects/${args.projectId}/usage${mergedQuery}`;
}
