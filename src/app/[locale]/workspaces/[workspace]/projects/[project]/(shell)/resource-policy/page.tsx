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
import { AuditAPI, EndpointAPI, MemberAPI, getApiClient } from '@/lib/api';
import type { Member, ProjectGroup } from '@/lib/api/endpoints/members';
import type {
  Endpoint,
  PolicyRule,
  PolicyRuleKey,
  ResourcePolicy,
  ResourcePolicyUpdateRequest,
} from '@/lib/api/types';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { FeatureAvailabilityBanner } from '@/components/ui/FeatureAvailabilityBanner';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';
import { ResourcePolicyTable, type ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';
import { buttonVariants } from '@/components/ui/button';
import { useMembers, useProjectGroups, useResourcePolicy, useUpdateResourcePolicy } from '@/lib/hooks/use-members';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { useAuthorizationCheck } from '@/lib/hooks/use-governance-explainability';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import {
  getResourcePolicyStatus,
} from '@/lib/constants/resource-policy';
import {
  findDuplicateSubjects,
  findStaleSubjectRowIds,
  normalizeSubjectId,
} from '@/lib/utils/resource-policy-subjects';
import {
  buildDraftRuleValues,
  buildRuleSetFromDraft,
  createSubjectRowId,
} from '@/lib/resource-policy/editor-utils';
import { getFeatureAvailability, isFeatureBlockedInCurrentMode } from '@/lib/constants/feature-availability';
import { cn } from '@/lib/utils';
import { parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import type { GovernanceAuthorizationResponse } from '@/lib/api/endpoints/governance-explainability';
import { ResourcePolicyHeaderActions } from './_components/ResourcePolicyHeaderActions';
import { ResourcePolicyEditor } from './_components/ResourcePolicyEditor';
import type { EditableSubject } from './resource-policy-page-types';
import { getDefaultActionForResourceType } from './resource-policy-page-utils';

interface ResourcePolicyPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ResourcePolicyPage({ params }: ResourcePolicyPageProps) {
  const tNav = useTranslations('nav');
  const tErrors = useTranslations('errors');
  const tResource = useTranslations('resource_policy');
  const searchParams = useSearchParams();
  const drilldownContext = useMemo(() => parseGovernanceDrilldownContext(searchParams), [searchParams]);
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
  const canUpdatePolicy = useHasPermission('project:governance:update');
  const canReadPolicy = canUpdatePolicy;

  useEffect(() => {
    params.then((p) => {
      const nextParams = {
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      };
      setResolvedParams((previous) =>
        previous &&
        previous.workspace === nextParams.workspace &&
        previous.project === nextParams.project &&
        previous.locale === nextParams.locale
          ? previous
          : nextParams,
      );
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const { isLoading: permissionLoading } = useProject(workspaceId, projectId);
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const endpointAPI = useMemo(() => new EndpointAPI(getApiClient()), []);
  const memberAPI = useMemo(() => new MemberAPI(getApiClient()), []);
  const auditAPI = useMemo(() => new AuditAPI(getApiClient()), []);

  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ['resource-policy', 'endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadPolicy,
  });

  const rows = useMemo<ResourceRow[]>(() => {
    const endpoints = (endpointsData?.items ?? []).map((item: Endpoint) => ({
      id: item.id,
      type: 'endpoint' as const,
      name: item.name,
      subtitle: item.model,
    }));
    return endpoints;
  }, [endpointsData?.items]);

  const groupedRows = useMemo(() => {
    return {
      endpoint: rows.filter((row) => row.type === 'endpoint'),
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

  const isLoading = endpointsLoading;
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
    const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
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
    if (resourceType !== 'endpoint') return;
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
      spendingRules: selectedPolicy.spending_limits?.rules,
    }));
    setSubjects(
      (selectedPolicy.allowed_subjects ?? []).map((subject) => ({
        ...subject,
        rowId: createSubjectRowId(),
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        draftRules: buildDraftRuleValues(selectedResource?.type ?? selectedPolicy.resource_type, {
          rateRules: subject.rate_limits?.rules,
          spendingRules: subject.spending_limits?.rules,
        }),
        existingRateRules: subject.rate_limits?.rules ?? [],
        existingSpendingRules: subject.spending_limits?.rules ?? [],
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
        subject.existingSpendingRules,
        subject.draftRules
      );
      return {
        subject_type: subject.subject_type,
        subject_id: normalizeSubjectId(subject.subject_id),
        rate_limits: subjectRuleSet.rateRules.length > 0 ? { rules: subjectRuleSet.rateRules } : undefined,
        spending_limits: subjectRuleSet.spendingRules.length > 0 ? { rules: subjectRuleSet.spendingRules } : undefined,
      };
    });
  const allowListInvalid = accessMode === 'allow_list' && validSubjects.length === 0;
  const hasDuplicateSubjects = duplicateSubjects.length > 0;

  const handleSave = async () => {
    if (!selectedResource || !selectedPolicy) return;
    if (allowListInvalid || hasDuplicateSubjects) return;

    const nextRuleSet = buildRuleSetFromDraft(
      selectedResource.type,
      selectedPolicy.rate_limits?.rules,
      selectedPolicy.spending_limits?.rules,
      rootDraftRules
    );

    const payload: ResourcePolicyUpdateRequest = {
      access_mode: accessMode,
      allowed_subjects: validSubjects,
      rate_limits: nextRuleSet.rateRules.length > 0 ? { rules: nextRuleSet.rateRules } : undefined,
      spending_limits: nextRuleSet.spendingRules.length > 0 ? { rules: nextRuleSet.spendingRules } : undefined,
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
        existingSpendingRules: [],
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

  if (permissionLoading && !canReadPolicy) {
    return (
      <PageState state="loading">
        <PageLoading />
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
                <ResourcePolicyHeaderActions
                  basePath={basePath}
                  openMembersLabel={tResource('open_members')}
                  openCredentialsLabel={tResource('open_credentials')}
                  openAuditLabel={tResource('open_audit')}
                />
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
              <ResourcePolicyHeaderActions
                basePath={basePath}
                openMembersLabel={tResource('open_members')}
                openCredentialsLabel={tResource('open_credentials')}
                openAuditLabel={tResource('open_audit')}
              />
            )}
          />
        )}
      >
        {drilldownContext ? (
          <GovernanceDrilldownBanner context={drilldownContext} locale={locale} />
        ) : null}
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
            <ResourcePolicyEditor
              tResource={tResource}
              selectedResource={selectedResource}
              policyLoading={policyLoading}
              selectedPolicy={selectedPolicy}
              selectedType={selectedType}
              canUpdatePolicy={canUpdatePolicy}
              accessMode={accessMode}
              onAccessModeChange={setAccessMode}
              rootDraftRules={rootDraftRules}
              onRootDraftRuleChange={(key, value) => setRootDraftRules((prev) => ({ ...prev, [key]: value }))}
              subjects={subjects}
              duplicateSubjectRowIds={duplicateSubjectRowIds}
              staleSubjectRowIds={staleSubjectRowIds}
              hasStaleSubjects={hasStaleSubjects}
              allowListInvalid={allowListInvalid}
              hasDuplicateSubjects={hasDuplicateSubjects}
              validSubjects={validSubjects}
              userOptions={userOptions}
              groupOptions={groupOptions}
              onAddSubject={addSubject}
              onRemoveSubject={removeSubject}
              onRemoveStaleSubjects={removeStaleSubjects}
              onUpdateSubject={updateSubject}
              onSave={handleSave}
              saving={updatePolicyMutation.isPending}
              explainSubjectType={explainSubjectType}
              explainSubjectId={explainSubjectId}
              explainAction={explainAction}
              explainOptions={explainOptions}
              onExplainSubjectTypeChange={(value) => {
                setExplainSubjectType(value);
                setExplainSubjectId('');
                setAuthorizationResult(null);
              }}
              onExplainSubjectIdChange={(value) => {
                setExplainSubjectId(value);
                setAuthorizationResult(null);
              }}
              onExplainActionChange={(value) => {
                setExplainAction(value);
                setAuthorizationResult(null);
              }}
              onRunExplain={handleAuthorizationExplain}
              explainChecking={authorizationCheck.isPending}
              authorizationResult={authorizationResult}
              policyAuditEvents={policyAuditEvents}
            />
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
