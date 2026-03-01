/**
 * Resource Policy Page
 *
 * Unified policy page for resource access and per-user limits.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AgentAPI, AuditAPI, EndpointAPI, MemberAPI, FilesAPI, getApiClient } from '@/lib/api';
import type { Member, ProjectGroup } from '@/lib/api/endpoints/members';
import type {
  Agent,
  Endpoint,
  PolicyRule,
  PolicyRuleKey,
  ResourcePolicy,
  ResourcePolicyUpdateRequest,
  FileLibrary,
} from '@/lib/api/types';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { FeatureAvailabilityBanner } from '@/components/ui/FeatureAvailabilityBanner';
import { ResourcePolicyTable, type ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  useMembers,
  useProjectGroups,
  useResourcePolicy,
  useUpdateResourcePolicy,
} from '@/lib/hooks/use-members';
import { useAuthorizationCheck } from '@/lib/hooks/use-governance-explainability';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import {
  getResourcePolicyStatus,
  getRuleDefinitionsForResource,
  getRuleLabel,
  mergeRuleSets,
} from '@/lib/constants/resource-policy';
import {
  findDuplicateSubjects,
  findStaleSubjectRowIds,
  normalizeSubjectId,
  type EditableSubjectDraft,
} from '@/lib/utils/resource-policy-subjects';
import {
  buildDraftRuleValues,
  buildRuleSetFromDraft,
  createSubjectRowId,
  formatRuleValue,
  mergeRuleSources,
} from '@/lib/resource-policy/editor-utils';
import { getFeatureAvailability, isFeatureBlockedInCurrentMode } from '@/lib/constants/feature-availability';
import { cn } from '@/lib/utils';
import type { GovernanceAuthorizationResponse } from '@/lib/api/endpoints/governance-explainability';

interface ResourcePolicyPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

type EditableSubject = EditableSubjectDraft & {
  rowId: string;
  subject_type: 'group' | 'user';
  subject_id: string;
  draftRules: Partial<Record<PolicyRuleKey, string>>;
  existingRateRules: PolicyRule[];
  existingQuotaRules: PolicyRule[];
};

export default function ResourcePolicyPage({ params }: ResourcePolicyPageProps) {
  const tNav = useTranslations('nav');
  const tErrors = useTranslations('errors');
  const tResource = useTranslations('resource_policy');
  const searchParams = useSearchParams();
  const featureAvailability = getFeatureAvailability('resource_policy');
  const isFeatureBlocked = isFeatureBlockedInCurrentMode('resource_policy');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const [selectedResource, setSelectedResource] = useState<ResourceRow | null>(null);
  const [accessMode, setAccessMode] = useState<'allow_all_members' | 'allow_list'>('allow_all_members');
  const [rootDraftRules, setRootDraftRules] = useState<Partial<Record<PolicyRuleKey, string>>>({});
  const [subjects, setSubjects] = useState<EditableSubject[]>([]);
  const [explainSubjectType, setExplainSubjectType] = useState<'user' | 'group'>('user');
  const [explainSubjectId, setExplainSubjectId] = useState('');
  const [explainAction, setExplainAction] = useState('invoke');
  const [authorizationResult, setAuthorizationResult] = useState<GovernanceAuthorizationResponse | null>(null);
  const canUpdatePolicy = useHasPermission('project:resource_policy:manage');
  const canReadPolicy = canUpdatePolicy;

  useEffect(() => {
    params.then((p) => {
      const workspace = validateWorkspaceParam(p.workspace);
      const project = validateProjectParam(p.project);
      setResolvedParams({ workspace, project, locale: p.locale });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const endpointAPI = useMemo(() => new EndpointAPI(getApiClient()), []);
  const sourcesAPI = useMemo(() => new FilesAPI(getApiClient()), []);
  const agentAPI = useMemo(() => new AgentAPI(getApiClient()), []);
  const memberAPI = useMemo(() => new MemberAPI(getApiClient()), []);
  const auditAPI = useMemo(() => new AuditAPI(getApiClient()), []);

  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ['resource-policy', 'endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadPolicy,
  });

  const { data: librariesData, isLoading: librariesLoading } = useQuery({
    queryKey: ['resource-policy', 'source-libraries', workspaceId, projectId],
    queryFn: () => sourcesAPI.listLibraries(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadPolicy,
  });
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['resource-policy', 'agents', workspaceId, projectId],
    queryFn: () => agentAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadPolicy,
  });

  const rows = useMemo<ResourceRow[]>(() => {
    const endpoints = (endpointsData?.items ?? []).map((item: Endpoint) => ({
      id: item.id,
      type: 'endpoint' as const,
      name: item.name,
      subtitle: item.openai_model,
    }));
    const sourceLibraries = (librariesData?.items ?? []).map((item: FileLibrary) => ({
      id: item.id,
      type: 'source_library' as const,
      name: item.name,
      subtitle: item.description,
    }));
    const agents = (agentsData?.items ?? []).map((item: Agent) => ({
      id: item.id,
      type: 'agent' as const,
      name: item.name,
      subtitle: item.mode,
    }));
    return [...endpoints, ...agents, ...sourceLibraries];
  }, [endpointsData?.items, librariesData?.items, agentsData?.items]);

  const groupedRows = useMemo(() => {
    return {
      endpoint: rows.filter((row) => row.type === 'endpoint'),
      agent: rows.filter((row) => row.type === 'agent'),
      source_library: rows.filter((row) => row.type === 'source_library'),
    };
  }, [rows]);

  const policyQueries = useQueries({
    queries: rows.map((row) => ({
      queryKey: ['resource-policy', 'detail', workspaceId, projectId, row.type, row.id],
      queryFn: () => memberAPI.getResourcePolicy(workspaceId, projectId, row.type, row.id),
      enabled: !!workspaceId && !!projectId && canReadPolicy,
      staleTime: 30 * 1000,
    })),
  });

  const policyByResourceKey = useMemo(() => {
    const map = new Map<string, ResourcePolicy>();
    rows.forEach((row, index) => {
      const policy = policyQueries[index]?.data;
      if (policy) {
        map.set(`${row.type}:${row.id}`, policy);
      }
    });
    return map;
  }, [policyQueries, rows]);

  const isLoading = endpointsLoading || librariesLoading || agentsLoading;
  const getRowPolicyState = (row: ResourceRow) => {
    const rowIndex = rows.findIndex((item) => item.id === row.id && item.type === row.type);
    const rowKey = `${row.type}:${row.id}`;
    const rowPolicyQuery = policyQueries[rowIndex];
    const rowPolicy = policyByResourceKey.get(rowKey);
    const rowStatus = getResourcePolicyStatus(rowPolicy);
    return {
      isLoading: !!rowPolicyQuery?.isLoading,
      status: rowStatus.status,
      label: rowPolicyQuery?.isLoading ? tResource('resource_status.loading') : tResource(rowStatus.labelKey),
      title: rowPolicyQuery?.isLoading ? tResource('resource_status_reason.loading') : tResource(rowStatus.reasonKey),
    };
  };

  const selectedType = selectedResource?.type ?? 'endpoint';
  const selectedId = selectedResource?.id ?? '';

  const {
    data: selectedPolicy,
    isLoading: policyLoading,
  } = useResourcePolicy(workspaceId, projectId, selectedType, selectedId);
  const { data: membersData } = useMembers(workspaceId, projectId);
  const { data: groupsData } = useProjectGroups(workspaceId, projectId);
  const updatePolicyMutation = useUpdateResourcePolicy(workspaceId, projectId, selectedType, selectedId);
  const authorizationCheck = useAuthorizationCheck(workspaceId, projectId);

  const auditTimeRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start_time: start.toISOString(), end_time: end.toISOString() };
  }, []);
  const { data: auditData } = useQuery({
    queryKey: ['resource-policy', 'governance-audit', workspaceId, projectId, auditTimeRange.start_time, auditTimeRange.end_time],
    queryFn: () =>
      auditAPI.list(workspaceId, projectId, {
        ...auditTimeRange,
        resource_type: 'resource_policy',
        page_size: 20,
        sort_by: 'timestamp',
        sort_order: 'desc',
      }),
    enabled: !!workspaceId && !!projectId && canReadPolicy,
    staleTime: 60 * 1000,
  });
  const policyAuditEvents = auditData?.items ?? [];

  const userOptions = useMemo(
    () =>
      (membersData ?? []).map((member: Member) => ({
        id: member.id,
        label: member.name ? `${member.name} (${member.email})` : member.email,
      })),
    [membersData]
  );
  const groupOptions = useMemo(
    () =>
      (groupsData ?? []).map((group: ProjectGroup) => ({
        id: group.id,
        label: group.name,
      })),
    [groupsData]
  );

  useEffect(() => {
    if (!selectedResource && rows.length > 0) {
      setSelectedResource(rows[0] ?? null);
    }
  }, [rows, selectedResource]);

  useEffect(() => {
    const resourceType = searchParams.get('resource_type');
    const resourceId = searchParams.get('resource_id');
    if (!resourceType || !resourceId) return;
    if (resourceType !== 'endpoint' && resourceType !== 'source_library' && resourceType !== 'agent') return;
    const matched = rows.find((row) => row.type === resourceType && row.id === resourceId);
    if (matched && (selectedResource?.type !== matched.type || selectedResource.id !== matched.id)) {
      setSelectedResource(matched);
    }
  }, [rows, searchParams, selectedResource]);

  useEffect(() => {
    if (!selectedPolicy) return;
    setAccessMode(selectedPolicy.access_mode);
    setRootDraftRules(buildDraftRuleValues(selectedResource?.type ?? selectedPolicy.resource_type, {
      rateRules: selectedPolicy.rate_limits?.rules,
      quotaRules: selectedPolicy.quota_limits?.rules,
    }));
    setSubjects(
      (selectedPolicy.allowed_subjects ?? []).map((subject) => ({
        rowId: createSubjectRowId(),
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        draftRules: buildDraftRuleValues(selectedResource?.type ?? selectedPolicy.resource_type, {
          rateRules: subject.rate_limits?.rules,
          quotaRules: subject.quota_limits?.rules,
        }),
        existingRateRules: subject.rate_limits?.rules ?? [],
        existingQuotaRules: subject.quota_limits?.rules ?? [],
      }))
    );
  }, [selectedPolicy, selectedResource?.type]);

  useEffect(() => {
    if (!selectedResource) return;
    setExplainAction(getDefaultActionForResourceType(selectedResource.type));
    setExplainSubjectType('user');
    setExplainSubjectId('');
    setAuthorizationResult(null);
  }, [selectedResource]);

  useEffect(() => {
    if (!selectedResource) return;
    const queryResourceType = searchParams.get('resource_type');
    const queryResourceId = searchParams.get('resource_id');
    if (
      queryResourceType
      && queryResourceId
      && (queryResourceType !== selectedResource.type || queryResourceId !== selectedResource.id)
    ) {
      return;
    }

    const subjectType = searchParams.get('explain_subject_type');
    const subjectId = searchParams.get('explain_subject_id');
    const action = searchParams.get('explain_action');
    if (subjectType === 'user' || subjectType === 'group') {
      setExplainSubjectType(subjectType);
    }
    if (subjectId) {
      setExplainSubjectId(subjectId);
    }
    if (action) {
      setExplainAction(action);
    }
  }, [searchParams, selectedResource]);

  const memberIds = useMemo(() => (userOptions ?? []).map((o) => o.id), [userOptions]);
  const groupIds = useMemo(() => (groupOptions ?? []).map((o) => o.id), [groupOptions]);
  const staleSubjectRowIds = useMemo(
    () => findStaleSubjectRowIds(subjects, memberIds, groupIds),
    [subjects, memberIds, groupIds],
  );
  const hasStaleSubjects = staleSubjectRowIds.length > 0;

  const duplicateSubjects = findDuplicateSubjects(subjects);
  const duplicateSubjectRowIds = new Set(duplicateSubjects.flatMap((subject) => subject.rows));

  const validSubjects = subjects
    .filter((subject) => subject.subject_id.trim().length > 0)
    .map((subject) => {
      const subjectRuleSet = buildRuleSetFromDraft(
        selectedType,
        subject.existingRateRules,
        subject.existingQuotaRules,
        subject.draftRules
      );
      return {
        subject_type: subject.subject_type,
        subject_id: normalizeSubjectId(subject.subject_id),
        rate_limits: subjectRuleSet.rateRules.length > 0 ? { rules: subjectRuleSet.rateRules } : undefined,
        quota_limits: subjectRuleSet.quotaRules.length > 0 ? { rules: subjectRuleSet.quotaRules } : undefined,
      };
    });
  const allowListInvalid = accessMode === 'allow_list' && validSubjects.length === 0;
  const hasDuplicateSubjects = duplicateSubjects.length > 0;
  const draftRootRuleSet = buildRuleSetFromDraft(
    selectedType,
    selectedPolicy?.rate_limits?.rules,
    selectedPolicy?.quota_limits?.rules,
    rootDraftRules
  );

  const handleSave = async () => {
    if (!selectedResource || !selectedPolicy) return;
    if (allowListInvalid || hasDuplicateSubjects) return;

    const nextRuleSet = buildRuleSetFromDraft(
      selectedResource.type,
      selectedPolicy.rate_limits?.rules,
      selectedPolicy.quota_limits?.rules,
      rootDraftRules
    );

    const payload: ResourcePolicyUpdateRequest = {
      access_mode: accessMode,
      allowed_subjects: validSubjects,
      rate_limits: nextRuleSet.rateRules.length > 0 ? { rules: nextRuleSet.rateRules } : undefined,
      quota_limits: nextRuleSet.quotaRules.length > 0 ? { rules: nextRuleSet.quotaRules } : undefined,
    };

    await updatePolicyMutation.mutateAsync(payload);
  };

  const handleAuthorizationExplain = async () => {
    if (!selectedResource || !explainSubjectId.trim()) return;
    const result = await authorizationCheck.mutateAsync({
      subject: {
        type: explainSubjectType,
        id: explainSubjectId.trim(),
      },
      resource: {
        type: selectedResource.type,
        id: selectedResource.id,
      },
      action: explainAction.trim() || getDefaultActionForResourceType(selectedResource.type),
    });
    setAuthorizationResult(result);
  };

  const addSubject = () => {
    setSubjects((prev) => [
      ...prev,
      {
        rowId: createSubjectRowId(),
        subject_type: 'user',
        subject_id: '',
        draftRules: {},
        existingRateRules: [],
        existingQuotaRules: [],
      },
    ]);
  };

  const removeSubject = (rowId: string) => {
    setSubjects((prev) => prev.filter((subject) => subject.rowId !== rowId));
  };

  const removeStaleSubjects = () => {
    setSubjects((prev) => prev.filter((subject) => !staleSubjectRowIds.includes(subject.rowId)));
  };

  const updateSubject = (rowId: string, patch: Partial<EditableSubject>) => {
    setSubjects((prev) =>
      prev.map((subject) => (subject.rowId === rowId ? { ...subject, ...patch } : subject))
    );
  };

  const explainOptions = explainSubjectType === 'user' ? userOptions : groupOptions;
  const explainMatchedPolicy = authorizationResult?.matched_policy;

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadPolicy) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  if (isFeatureBlocked) {
    return (
      <PageState state="success">
        <PageLayout
          header={(
            <PageHeader
              title={tNav('resource_policy')}
              subtitle={tResource('subtitle')}
              actions={(
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`${basePath}/members`}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    data-testid="resource-policy__open-members"
                  >
                    {tResource('open_members')}
                  </Link>
                  <Link
                    href={`${basePath}/credentials`}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    data-testid="resource-policy__open-credentials"
                  >
                    {tResource('open_credentials')}
                  </Link>
                  <Link
                    href={`${basePath}/audit`}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    data-testid="resource-policy__open-audit"
                  >
                    {tResource('open_audit')}
                  </Link>
                </div>
              )}
            />
          )}
        >
          <div className="mx-auto w-full max-w-5xl p-4">
            <FeatureAvailabilityBanner availability={featureAvailability} />
          </div>
        </PageLayout>
      </PageState>
    );
  }

  if (isLoading) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={tNav('resource_policy')}
            subtitle={tResource('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/members`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="resource-policy__open-members"
                >
                  {tResource('open_members')}
                </Link>
                <Link
                  href={`${basePath}/credentials`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="resource-policy__open-credentials"
                >
                  {tResource('open_credentials')}
                </Link>
                <Link
                  href={`${basePath}/audit`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="resource-policy__open-audit"
                >
                  {tResource('open_audit')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <div className="p-4 rounded-md border border-subtle bg-surface">
          <p className="text-sm text-tertiary mb-4">
            {tResource('default_model_hint')}
          </p>
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <ResourcePolicyTable
              groupedRows={groupedRows}
              selectedResource={selectedResource}
              onSelectResource={setSelectedResource}
              getRowPolicyState={getRowPolicyState}
            />

            <div
              className="rounded-sm border border-subtle bg-surface-high p-4 space-y-4"
              data-testid="resource-policy__editor"
            >
              {!selectedResource ? (
                <p className="text-sm text-tertiary">{tResource('select_resource')}</p>
              ) : policyLoading ? (
                <p className="text-sm text-tertiary">{tResource('loading_policy')}</p>
              ) : (
                <>
                  <div className="rounded-sm border border-subtle bg-surface p-3 space-y-1">
                    <h3 className="text-sm font-medium text-foreground">{selectedResource.name}</h3>
                    <p className="text-xs text-tertiary">{tResource(`resource_type.${selectedResource.type}`)}</p>
                    <p className="text-xs text-tertiary">
                      {tResource(`editor_hint.${selectedResource.type}`)}
                    </p>
                  </div>

                  <div className="rounded-sm border border-subtle bg-surface p-3 space-y-2">
                    <label htmlFor="resource-policy-access-mode" className="text-xs text-tertiary">
                      {tResource('access_mode.label')}
                    </label>
                    <select
                      id="resource-policy-access-mode"
                      value={accessMode}
                      onChange={(event) =>
                        setAccessMode(event.target.value as 'allow_all_members' | 'allow_list')
                      }
                      disabled={!canUpdatePolicy}
                      className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground"
                      data-testid="resource-policy__access-mode"
                    >
                      <option value="allow_all_members">{tResource('access_mode.allow_all_members')}</option>
                      <option value="allow_list">{tResource('access_mode.allow_list')}</option>
                    </select>
                    <p className="text-xs text-tertiary">
                      {tResource(`access_mode_description.${accessMode}`)}
                    </p>
                  </div>

                  <div className="rounded-sm border border-subtle bg-surface p-3 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="text-xs text-tertiary">{tResource('subjects.title')}</p>
                      <div className="flex items-center gap-2">
                        {hasStaleSubjects ? (
                          <Button
                            type="button"
                            onClick={removeStaleSubjects}
                            disabled={!canUpdatePolicy}
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 text-xs"
                            data-testid="resource-policy__remove-stale"
                          >
                            {tResource('subjects.remove_stale')}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          onClick={addSubject}
                          disabled={!canUpdatePolicy}
                          variant="outline"
                          size="sm"
                          className="h-8 px-3 text-xs"
                          data-testid="resource-policy__add-subject"
                        >
                          {tResource('subjects.add')}
                        </Button>
                      </div>
                    </div>
                    {subjects.length === 0 ? (
                      <p className="text-xs text-tertiary">{tResource('subjects.empty')}</p>
                    ) : (
                      <div className="space-y-2" data-testid="resource-policy__subjects">
                        {subjects.map((subject) => (
                          <div
                            key={subject.rowId}
                            className={`rounded-sm border bg-surface p-3 space-y-2 ${
                              duplicateSubjectRowIds.has(subject.rowId) ? 'border-error/60' : 'border-subtle'
                            } ${staleSubjectRowIds.includes(subject.rowId) ? 'border-warning/50' : ''}`}
                            data-testid={`resource-policy__subject--${subject.rowId}`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="grid gap-2 md:grid-cols-[120px_1fr_auto] flex-1 min-w-0">
                              <select
                                value={subject.subject_type}
                                onChange={(event) =>
                                  updateSubject(subject.rowId, {
                                    subject_type: event.target.value as 'group' | 'user',
                                    subject_id: '',
                                  })
                                }
                                disabled={!canUpdatePolicy}
                                className="h-9 rounded-sm border border-subtle bg-surface-high px-2 text-sm text-foreground"
                                data-testid="resource-policy__subject-type"
                              >
                                <option value="user">{tResource('subjects.user')}</option>
                                <option value="group">{tResource('subjects.group')}</option>
                              </select>
                              <select
                                value={subject.subject_id}
                                onChange={(event) =>
                                  updateSubject(subject.rowId, { subject_id: event.target.value })
                                }
                                disabled={!canUpdatePolicy}
                                className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                                data-testid="resource-policy__subject-id-select"
                              >
                                <option value="">{tResource('subjects.select_subject')}</option>
                                {(subject.subject_type === 'user' ? userOptions : groupOptions).map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                                {subject.subject_id &&
                                !(subject.subject_type === 'user' ? userOptions : groupOptions).some(
                                  (option) => option.id === subject.subject_id
                                ) ? (
                                  <option value={subject.subject_id}>{subject.subject_id}</option>
                                ) : null}
                              </select>
                              <Button
                                type="button"
                                onClick={() => removeSubject(subject.rowId)}
                                disabled={!canUpdatePolicy}
                                variant="outline"
                                size="sm"
                                className="h-9 px-3 text-xs"
                              >
                                {tResource('subjects.remove')}
                              </Button>
                              </div>
                            {staleSubjectRowIds.includes(subject.rowId) ? (
                              <span
                                className="shrink-0 text-xs text-warning border border-warning/50 rounded px-2 py-0.5"
                                data-testid={`resource-policy__subject-stale--${subject.rowId}`}
                              >
                                {tResource('subjects.stale')}
                              </span>
                            ) : null}
                            </div>
                            {duplicateSubjectRowIds.has(subject.rowId) ? (
                              <p
                                className="text-xs text-error"
                                data-testid={`resource-policy__subject-duplicate--${subject.rowId}`}
                              >
                                {tResource('subjects.duplicate')}
                              </p>
                            ) : null}
                            <div className="grid gap-2 md:grid-cols-2">
                              {getRuleDefinitionsForResource(selectedResource.type).map((rule) => (
                                <input
                                  key={rule.key}
                                  type="number"
                                  min={1}
                                  value={subject.draftRules[rule.key] ?? ''}
                                  onChange={(event) =>
                                    updateSubject(subject.rowId, {
                                      draftRules: {
                                        ...subject.draftRules,
                                        [rule.key]: event.target.value,
                                      },
                                    })
                                  }
                                  disabled={!canUpdatePolicy}
                                  placeholder={tResource(rule.subjectPlaceholderKey)}
                                  className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-sm border border-subtle bg-surface p-3 space-y-3">
                    {getRuleDefinitionsForResource(selectedResource.type).map((rule) => (
                      <div key={rule.key} className="space-y-2">
                        <label htmlFor={rule.rootInputId} className="text-xs text-tertiary">
                          {tResource(rule.labelKey)}
                        </label>
                        <input
                          id={rule.rootInputId}
                          type="number"
                          min={1}
                          value={rootDraftRules[rule.key] ?? ''}
                          onChange={(event) =>
                            setRootDraftRules((prev) => ({ ...prev, [rule.key]: event.target.value }))
                          }
                          disabled={!canUpdatePolicy}
                          className="h-9 w-full rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                          data-testid={rule.rootTestId}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    {allowListInvalid ? (
                      <p
                        className="mr-3 self-center text-xs text-error"
                        data-testid="resource-policy__allow-list-required"
                      >
                        {tResource('allow_list_required')}
                      </p>
                    ) : null}
                    {hasDuplicateSubjects ? (
                      <p
                        className="mr-3 self-center text-xs text-error"
                        data-testid="resource-policy__duplicate-subjects"
                      >
                        {tResource('subjects.duplicate')}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={!canUpdatePolicy || updatePolicyMutation.isPending || allowListInvalid || hasDuplicateSubjects}
                      variant="action"
                      size="sm"
                      className="h-9 px-4"
                      data-testid="resource-policy__save"
                    >
                      {updatePolicyMutation.isPending ? tResource('saving') : tResource('save_policy')}
                    </Button>
                  </div>

                  <div
                    className="rounded-sm border border-subtle bg-surface p-3 space-y-2"
                    data-testid="resource-policy__effective-summary"
                  >
                    <p className="text-xs font-medium text-foreground">{tResource('effective_summary.title')}</p>
                    <p className="text-xs text-tertiary">
                      {tResource('effective_summary.access')}:{' '}
                      <span className="text-primary">{tResource(`access_mode.${accessMode}`)}</span>
                    </p>
                    <div className="space-y-1">
                      {renderRuleSummary(
                        draftRootRuleSet.rateRules,
                        draftRootRuleSet.quotaRules,
                        (key) => tResource(getRuleLabel(key)),
                        tResource('effective_summary.no_explicit_limits'),
                        (rule) => formatRuleValue(rule, tResource),
                        () => tResource('effective_summary.source_resource')
                      )}
                    </div>
                    {validSubjects.length > 0 ? (
                      <div className="pt-2 border-t border-subtle space-y-2">
                        {validSubjects.map((subject, index) => {
                          const effectiveRate = mergeRuleSets(
                            draftRootRuleSet.rateRules,
                            subject.rate_limits?.rules ?? []
                          );
                          const effectiveQuota = mergeRuleSets(
                            draftRootRuleSet.quotaRules,
                            subject.quota_limits?.rules ?? []
                          );
                          const effectiveTrace = mergeRuleSources(
                            draftRootRuleSet.rateRules,
                            draftRootRuleSet.quotaRules,
                            subject.rate_limits?.rules ?? [],
                            subject.quota_limits?.rules ?? [],
                          );
                          return (
                            <div
                              key={`${subject.subject_type}:${subject.subject_id}:${index}`}
                              className="space-y-1"
                              data-testid={`resource-policy__effective-subject--${index}`}
                            >
                              <p className="text-xs text-tertiary">
                                {tResource(`subjects.${subject.subject_type}`)}:{' '}
                                <span className="text-primary">{subject.subject_id}</span>
                              </p>
                              {renderRuleSummary(
                                effectiveRate,
                                effectiveQuota,
                                (key) => tResource(getRuleLabel(key)),
                                tResource('effective_summary.no_explicit_limits'),
                                (rule) => formatRuleValue(rule, tResource),
                                (rule) =>
                                  tResource(
                                    effectiveTrace.get(rule.key) === 'subject'
                                      ? 'effective_summary.source_subject'
                                      : 'effective_summary.source_resource',
                                  )
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="rounded-sm border border-subtle bg-surface p-3 space-y-3"
                    data-testid="resource-policy__explainability"
                  >
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-foreground">{tResource('explainability.title')}</p>
                      <p className="text-xs text-tertiary">{tResource('explainability.description')}</p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[120px_1fr]">
                      <div className="rounded-sm border border-subtle bg-bg-base/10 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-tertiary">
                          {tResource('explainability.current_resource')}
                        </p>
                        <p className="mt-1 text-sm text-foreground">{selectedResource.name}</p>
                        <p className="text-xs text-tertiary">
                          {tResource(`resource_type.${selectedResource.type}`)} / {selectedResource.id}
                        </p>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <select
                          value={explainSubjectType}
                          onChange={(event) => {
                            setExplainSubjectType(event.target.value as 'user' | 'group');
                            setExplainSubjectId('');
                            setAuthorizationResult(null);
                          }}
                          className="h-9 rounded-sm border border-subtle bg-surface-high px-2 text-sm text-foreground"
                          data-testid="resource-policy__explain-subject-type"
                        >
                          <option value="user">{tResource('subjects.user')}</option>
                          <option value="group">{tResource('subjects.group')}</option>
                        </select>
                        <select
                          value={explainSubjectId}
                          onChange={(event) => {
                            setExplainSubjectId(event.target.value);
                            setAuthorizationResult(null);
                          }}
                          className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                          data-testid="resource-policy__explain-subject-id"
                        >
                          <option value="">{tResource('explainability.select_subject')}</option>
                          {explainOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={explainAction}
                          onChange={(event) => {
                            setExplainAction(event.target.value);
                            setAuthorizationResult(null);
                          }}
                          className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                          placeholder={tResource('explainability.action_placeholder')}
                          data-testid="resource-policy__explain-action"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={handleAuthorizationExplain}
                        disabled={!explainSubjectId.trim() || authorizationCheck.isPending}
                        variant="outline"
                        size="sm"
                        className="h-9 px-4"
                        data-testid="resource-policy__explain-run"
                      >
                        {authorizationCheck.isPending
                          ? tResource('explainability.checking')
                          : tResource('explainability.run')}
                      </Button>
                    </div>
                    {authorizationResult ? (
                      <div
                        className="rounded-sm border border-subtle bg-bg-base/10 p-3 space-y-2"
                        data-testid="resource-policy__explain-result"
                      >
                        <p className="text-xs text-tertiary">
                          {tResource('explainability.decision')}:{' '}
                          <span className="text-primary">
                            {authorizationResult.allowed
                              ? tResource('explainability.allowed')
                              : tResource('explainability.denied')}
                          </span>
                        </p>
                        <p className="text-xs text-tertiary">
                          {tResource('explainability.source')}:{' '}
                          <span className="text-primary">{authorizationResult.decision.source}</span>
                        </p>
                        <p className="text-xs text-tertiary">
                          {tResource('explainability.reason')}:{' '}
                          <span className="text-primary">{authorizationResult.decision.reason}</span>
                        </p>
                        {explainMatchedPolicy ? (
                          <div
                            className="rounded-sm border border-subtle bg-surface px-3 py-2 text-xs text-tertiary"
                            data-testid="resource-policy__matched-policy"
                          >
                            <p>
                              {tResource('explainability.matched_policy')}:{' '}
                              <span className="text-primary">{explainMatchedPolicy.id}</span>
                            </p>
                            <p>
                              {tResource('explainability.access_mode')}:{' '}
                              <span className="text-primary">
                                {tResource(`access_mode.${explainMatchedPolicy.access_mode}`)}
                              </span>
                            </p>
                            {explainMatchedPolicy.matched_subject ? (
                              <p>
                                {tResource('explainability.matched_subject')}:{' '}
                                <span className="text-primary">
                                  {tResource(`subjects.${explainMatchedPolicy.matched_subject.type}`)} /{' '}
                                  {explainMatchedPolicy.matched_subject.id}
                                </span>
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="rounded-sm border border-subtle bg-surface p-3 space-y-2"
                    data-testid="resource-policy__governance-audit"
                  >
                    <p className="text-xs font-medium text-foreground">{tResource('governance_audit.title')}</p>
                    {policyAuditEvents.length === 0 ? (
                      <p className="text-xs text-tertiary">{tResource('governance_audit.empty')}</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {policyAuditEvents.map((event) => (
                          <li
                            key={event.id}
                            className="text-xs text-tertiary flex flex-wrap gap-x-2 gap-y-0.5"
                            data-testid="resource-policy__audit-event"
                          >
                            <span>{new Date(event.timestamp).toLocaleString()}</span>
                            <span className="text-primary">{tResource('governance_audit.actor')}: {event.actor_id}</span>
                            <span className="text-primary">{tResource('governance_audit.action')}: {event.action}</span>
                            {event.resource_type != null || event.resource_id != null ? (
                              <span className="text-primary">
                                {tResource('governance_audit.resource')}: {[event.resource_type, event.resource_id].filter(Boolean).join(' / ')}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function getDefaultActionForResourceType(resourceType: ResourceRow['type']): string {
  if (resourceType === 'source_library') return 'upload';
  return 'invoke';
}

function renderRuleSummary(
  rateRules: PolicyRule[],
  quotaRules: PolicyRule[],
  labelForKey: (key: PolicyRuleKey) => string,
  noRulesText: string,
  valueForRule: (rule: PolicyRule) => string,
  sourceForRule?: (rule: PolicyRule) => string
) {
  const rules = [...rateRules, ...quotaRules];
  if (rules.length === 0) {
    return <p className="text-xs text-tertiary">{noRulesText}</p>;
  }
  return rules.map((rule) => (
    <p key={`${rule.key}-${rule.value}`} className="text-xs text-tertiary">
      {labelForKey(rule.key)}:{' '}
      <span className="text-primary">{valueForRule(rule)}</span>
      {sourceForRule ? (
        <span className="ml-1 text-[11px] text-tertiary">({sourceForRule(rule)})</span>
      ) : null}
    </p>
  ));
}
