/**
 * Resource Policy Page
 *
 * Unified policy page for resource access and per-user limits.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bot, FolderOpen, Server } from 'lucide-react';
import { AgentAPI, EndpointAPI, MemberAPI, SourcesAPI, getApiClient } from '@/lib/api';
import type { Member, ProjectGroup } from '@/lib/api/endpoints/members';
import type {
  Agent,
  Endpoint,
  PolicyRule,
  PolicyRuleKey,
  PolicyResourceType,
  ResourcePolicy,
  ResourcePolicyUpdateRequest,
  SourceLibrary,
} from '@/lib/api/types';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { ResourcePolicyStatusBadge } from '@/components/resource-policy/ResourcePolicyStatusBadge';
import { Button } from '@/components/ui/button';
import {
  useMembers,
  useProjectGroups,
  useResourcePolicy,
  useUpdateResourcePolicy,
} from '@/lib/hooks/use-members';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import {
  getResourcePolicyStatus,
  getRuleDefinitionsForResource,
  getRuleLabel,
  mergeRuleSets,
} from '@/lib/constants/resource-policy';

interface ResourcePolicyPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

type ResourceRow = {
  id: string;
  type: 'endpoint' | 'source_library' | 'agent';
  name: string;
  subtitle?: string;
};

type EditableSubject = {
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
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string } | null>(null);
  const [selectedResource, setSelectedResource] = useState<ResourceRow | null>(null);
  const [accessMode, setAccessMode] = useState<'allow_all_members' | 'allow_list'>('allow_all_members');
  const [rootDraftRules, setRootDraftRules] = useState<Partial<Record<PolicyRuleKey, string>>>({});
  const [subjects, setSubjects] = useState<EditableSubject[]>([]);
  const canUpdatePolicy = useHasPermission('project:resource_policy:manage');
  const canReadPolicy = canUpdatePolicy;

  useEffect(() => {
    params.then((p) => {
      const workspace = validateWorkspaceParam(p.workspace);
      const project = validateProjectParam(p.project);
      setResolvedParams({ workspace, project });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const endpointAPI = useMemo(() => new EndpointAPI(getApiClient()), []);
  const sourcesAPI = useMemo(() => new SourcesAPI(getApiClient()), []);
  const agentAPI = useMemo(() => new AgentAPI(getApiClient()), []);
  const memberAPI = useMemo(() => new MemberAPI(getApiClient()), []);

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
    const sourceLibraries = (librariesData?.items ?? []).map((item: SourceLibrary) => ({
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
  const selectedType = selectedResource?.type ?? 'endpoint';
  const selectedId = selectedResource?.id ?? '';

  const {
    data: selectedPolicy,
    isLoading: policyLoading,
  } = useResourcePolicy(workspaceId, projectId, selectedType, selectedId);
  const { data: membersData } = useMembers(workspaceId, projectId);
  const { data: groupsData } = useProjectGroups(workspaceId, projectId);
  const updatePolicyMutation = useUpdateResourcePolicy(workspaceId, projectId, selectedType, selectedId);

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
        subject_id: subject.subject_id.trim(),
        rate_limits: subjectRuleSet.rateRules.length > 0 ? { rules: subjectRuleSet.rateRules } : undefined,
        quota_limits: subjectRuleSet.quotaRules.length > 0 ? { rules: subjectRuleSet.quotaRules } : undefined,
      };
    });
  const allowListInvalid = accessMode === 'allow_list' && validSubjects.length === 0;
  const draftRootRuleSet = buildRuleSetFromDraft(
    selectedType,
    selectedPolicy?.rate_limits?.rules,
    selectedPolicy?.quota_limits?.rules,
    rootDraftRules
  );

  const handleSave = async () => {
    if (!selectedResource || !selectedPolicy) return;
    if (allowListInvalid) return;

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

  const updateSubject = (rowId: string, patch: Partial<EditableSubject>) => {
    setSubjects((prev) =>
      prev.map((subject) => (subject.rowId === rowId ? { ...subject, ...patch } : subject))
    );
  };

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
          />
        )}
      >
        <div className="p-4 rounded-md border border-subtle bg-surface">
          <p className="text-sm text-tertiary mb-4">
            {tResource('default_model_hint')}
          </p>
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <div className="space-y-2" data-testid="resource-policy__table">
              {(['endpoint', 'agent', 'source_library'] as const).map((resourceType) => {
                const typeRows = groupedRows[resourceType];
                if (typeRows.length === 0) return null;
                return (
                  <section
                    key={resourceType}
                    className="rounded-sm border border-subtle bg-surface p-2.5 space-y-2"
                    data-testid={`resource-policy__group--${resourceType}`}
                  >
                    <div className="flex items-center justify-between px-1.5">
                      <p className="text-[11px] uppercase tracking-wide font-medium text-primary">
                        {tResource(`resource_type.${resourceType}`)}
                      </p>
                      <span className="text-[11px] text-tertiary">{typeRows.length}</span>
                    </div>
                    {typeRows.map((row) => {
                      const isSelected = selectedResource?.id === row.id && selectedResource.type === row.type;
                      const rowIndex = rows.findIndex((item) => item.id === row.id && item.type === row.type);
                      const rowKey = `${row.type}:${row.id}`;
                      const rowPolicyQuery = policyQueries[rowIndex];
                      const rowPolicy = policyByResourceKey.get(rowKey);
                      const rowStatus = getResourcePolicyStatus(rowPolicy);
                      return (
                        <Button
                          key={`${row.type}:${row.id}`}
                          type="button"
                          onClick={() => setSelectedResource(row)}
                          variant="secondary"
                          className={`w-full h-auto justify-between rounded-sm border p-2.5 text-left ${
                            isSelected
                              ? 'border-[rgb(var(--accent))] bg-surface-high'
                              : 'border-subtle bg-surface-high hover:bg-hover'
                          }`}
                          data-testid={`resource-policy__row--${row.type}--${row.id}`}
                        >
                          <div className="flex items-center gap-2">
                            {row.type === 'endpoint' && <Server className="h-4 w-4 text-icon-default" />}
                            {row.type === 'source_library' && <FolderOpen className="h-4 w-4 text-icon-default" />}
                            {row.type === 'agent' && <Bot className="h-4 w-4 text-icon-default" />}
                            <div>
                              <p className="text-sm text-foreground">{row.name}</p>
                              {row.subtitle ? <p className="text-xs text-tertiary">{row.subtitle}</p> : null}
                            </div>
                          </div>
                          <ResourcePolicyStatusBadge
                            data-testid={`resource-policy__row-status--${row.type}--${row.id}`}
                            status={rowPolicyQuery?.isLoading ? 'loading' : rowStatus.status}
                            label={
                              rowPolicyQuery?.isLoading
                                ? tResource('resource_status.loading')
                                : tResource(rowStatus.labelKey)
                            }
                            title={
                              rowPolicyQuery?.isLoading
                                ? tResource('resource_status_reason.loading')
                                : tResource(rowStatus.reasonKey)
                            }
                          />
                        </Button>
                      );
                    })}
                  </section>
                );
              })}
            </div>

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
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-tertiary">{tResource('subjects.title')}</p>
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
                    {subjects.length === 0 ? (
                      <p className="text-xs text-tertiary">{tResource('subjects.empty')}</p>
                    ) : (
                      <div className="space-y-2" data-testid="resource-policy__subjects">
                        {subjects.map((subject) => (
                          <div
                            key={subject.rowId}
                            className="rounded-sm border border-subtle bg-surface p-3 space-y-2"
                            data-testid={`resource-policy__subject--${subject.rowId}`}
                          >
                            <div className="grid gap-2 md:grid-cols-[120px_1fr_auto]">
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
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={!canUpdatePolicy || updatePolicyMutation.isPending || allowListInvalid}
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
                              key={`${subject.subject_type}:${subject.subject_id}`}
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
                </>
              )}
            </div>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function parsePositiveNumber(input: string): number | undefined {
  if (!input) return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function upsertRule(
  rules: PolicyRule[] | undefined,
  key: PolicyRuleKey,
  value: number | undefined,
  window?: 'day' | null
): PolicyRule[] {
  const base = [...(rules ?? [])].filter((rule) => rule.key !== key);
  if (value === undefined) return base;
  base.push({
    key,
    value,
    ...(window !== undefined ? { window } : {}),
  });
  return base;
}

function createSubjectRowId(): string {
  return `subject_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function buildDraftRuleValues(
  resourceType: PolicyResourceType,
  current: { rateRules?: PolicyRule[]; quotaRules?: PolicyRule[] }
): Partial<Record<PolicyRuleKey, string>> {
  const draft: Partial<Record<PolicyRuleKey, string>> = {};
  for (const definition of getRuleDefinitionsForResource(resourceType)) {
    const sourceRules = definition.bucket === 'rate' ? current.rateRules : current.quotaRules;
    const matched = sourceRules?.find((rule) => rule.key === definition.key);
    if (matched) {
      draft[definition.key] = String(matched.value);
    }
  }
  return draft;
}

function buildRuleSetFromDraft(
  resourceType: PolicyResourceType,
  currentRateRules: PolicyRule[] | undefined,
  currentQuotaRules: PolicyRule[] | undefined,
  draftValues: Partial<Record<PolicyRuleKey, string>>
): { rateRules: PolicyRule[]; quotaRules: PolicyRule[] } {
  let rateRules = [...(currentRateRules ?? [])];
  let quotaRules = [...(currentQuotaRules ?? [])];
  for (const definition of getRuleDefinitionsForResource(resourceType)) {
    const value = parsePositiveNumber(draftValues[definition.key] ?? '');
    if (definition.bucket === 'rate') {
      rateRules = upsertRule(rateRules, definition.key, value, definition.window);
    } else {
      quotaRules = upsertRule(quotaRules, definition.key, value, definition.window);
    }
  }
  return { rateRules, quotaRules };
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

function mergeRuleSources(
  rootRateRules: PolicyRule[],
  rootQuotaRules: PolicyRule[],
  subjectRateRules: PolicyRule[],
  subjectQuotaRules: PolicyRule[],
): Map<PolicyRuleKey, 'resource' | 'subject'> {
  const sourceMap = new Map<PolicyRuleKey, 'resource' | 'subject'>();
  [...rootRateRules, ...rootQuotaRules].forEach((rule) => {
    sourceMap.set(rule.key, 'resource');
  });
  [...subjectRateRules, ...subjectQuotaRules].forEach((rule) => {
    sourceMap.set(rule.key, 'subject');
  });
  return sourceMap;
}

function formatRuleValue(rule: PolicyRule, tResource: (key: string) => string): string {
  if (rule.key === 'endpoint.daily_token_limit') {
    return `${rule.value} ${tResource('units.tokens_per_day')}`;
  }
  if (rule.key === 'source_library.max_total_files') {
    return `${rule.value} ${tResource('units.files')}`;
  }
  if (rule.key === 'source_library.max_file_size_bytes') {
    return formatBytes(rule.value, tResource);
  }
  return `${rule.value} ${tResource('units.sessions')}`;
}

function formatBytes(bytes: number, tResource: (key: string) => string): string {
  if (bytes < 1024) return `${bytes} ${tResource('units.byte')}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number(kb.toFixed(1))} ${tResource('units.kib')}`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Number(mb.toFixed(1))} ${tResource('units.mib')}`;
  const gb = mb / 1024;
  return `${Number(gb.toFixed(1))} ${tResource('units.gib')}`;
}
