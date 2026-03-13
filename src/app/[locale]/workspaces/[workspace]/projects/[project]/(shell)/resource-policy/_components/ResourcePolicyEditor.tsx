'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { GovernanceAuthorizationResponse } from '@/lib/api/endpoints/governance-explainability';
import type { PolicyRule, PolicyRuleKey, ResourcePolicy } from '@/lib/api/types';
import {
  getRuleDefinitionsForResource,
  getRuleLabel,
  mergeRuleSets,
} from '@/lib/constants/resource-policy';
import {
  buildRuleSetFromDraft,
  formatRuleValue,
  mergeRuleSources,
} from '@/lib/resource-policy/editor-utils';
import type { ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';
import { renderRuleSummary } from '../resource-policy-page-utils';
import type { EditableSubject, SubjectOption } from '../resource-policy-page-types';

export function ResourcePolicyEditor(args: {
  tResource: (key: string) => string;
  selectedResource: ResourceRow | null;
  policyLoading: boolean;
  selectedPolicy?: ResourcePolicy;
  selectedType: ResourceRow['type'];
  canUpdatePolicy: boolean;
  accessMode: 'allow_all_members' | 'allow_list';
  onAccessModeChange: (value: 'allow_all_members' | 'allow_list') => void;
  rootDraftRules: Partial<Record<PolicyRuleKey, string>>;
  onRootDraftRuleChange: (key: PolicyRuleKey, value: string) => void;
  subjects: EditableSubject[];
  duplicateSubjectRowIds: Set<string>;
  staleSubjectRowIds: string[];
  hasStaleSubjects: boolean;
  allowListInvalid: boolean;
  hasDuplicateSubjects: boolean;
  validSubjects: Array<{
    subject_type: 'group' | 'user';
    subject_id: string;
    rate_limits?: { rules: PolicyRule[] };
    spending_limits?: { rules: PolicyRule[] };
  }>;
  userOptions: SubjectOption[];
  groupOptions: SubjectOption[];
  onAddSubject: () => void;
  onRemoveSubject: (rowId: string) => void;
  onRemoveStaleSubjects: () => void;
  onUpdateSubject: (rowId: string, patch: Partial<EditableSubject>) => void;
  onSave: () => void;
  saving: boolean;
  explainSubjectType: 'user' | 'group';
  explainSubjectId: string;
  explainAction: string;
  explainOptions: SubjectOption[];
  onExplainSubjectTypeChange: (value: 'user' | 'group') => void;
  onExplainSubjectIdChange: (value: string) => void;
  onExplainActionChange: (value: string) => void;
  onRunExplain: () => void;
  explainChecking: boolean;
  authorizationResult: GovernanceAuthorizationResponse | null;
  policyAuditEvents: Array<{
    id: string;
    timestamp: string;
    actor_id: string;
    action: string;
    resource_type?: string | null;
    resource_id?: string | null;
  }>;
}) {
  const {
    tResource,
    selectedResource,
    policyLoading,
    selectedPolicy,
    selectedType,
    canUpdatePolicy,
    accessMode,
    onAccessModeChange,
    rootDraftRules,
    onRootDraftRuleChange,
    subjects,
    duplicateSubjectRowIds,
    staleSubjectRowIds,
    hasStaleSubjects,
    allowListInvalid,
    hasDuplicateSubjects,
    validSubjects,
    userOptions,
    groupOptions,
    onAddSubject,
    onRemoveSubject,
    onRemoveStaleSubjects,
    onUpdateSubject,
    onSave,
    saving,
    explainSubjectType,
    explainSubjectId,
    explainAction,
    explainOptions,
    onExplainSubjectTypeChange,
    onExplainSubjectIdChange,
    onExplainActionChange,
    onRunExplain,
    explainChecking,
    authorizationResult,
    policyAuditEvents,
  } = args;

  if (!selectedResource) {
    return (
      <div
        className="rounded-sm border border-subtle bg-surface-high p-4 space-y-4"
        data-testid="resource-policy__editor"
      >
        <p className="text-sm text-tertiary">{tResource('select_resource')}</p>
      </div>
    );
  }

  if (policyLoading) {
    return (
      <div
        className="rounded-sm border border-subtle bg-surface-high p-4 space-y-4"
        data-testid="resource-policy__editor"
      >
        <p className="text-sm text-tertiary">{tResource('loading_policy')}</p>
      </div>
    );
  }

  const draftRootRuleSet = buildRuleSetFromDraft(
    selectedType,
    selectedPolicy?.rate_limits?.rules,
    selectedPolicy?.spending_limits?.rules,
    rootDraftRules,
  );
  const explainMatchedPolicy = authorizationResult?.matched_policy;

  return (
    <div
      className="rounded-sm border border-subtle bg-surface-high p-4 space-y-4"
      data-testid="resource-policy__editor"
    >
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
          onChange={(event) => onAccessModeChange(event.target.value as 'allow_all_members' | 'allow_list')}
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

      <SubjectEditor
        tResource={tResource}
        selectedResourceType={selectedResource.type}
        canUpdatePolicy={canUpdatePolicy}
        subjects={subjects}
        duplicateSubjectRowIds={duplicateSubjectRowIds}
        staleSubjectRowIds={staleSubjectRowIds}
        hasStaleSubjects={hasStaleSubjects}
        userOptions={userOptions}
        groupOptions={groupOptions}
        onAddSubject={onAddSubject}
        onRemoveSubject={onRemoveSubject}
        onRemoveStaleSubjects={onRemoveStaleSubjects}
        onUpdateSubject={onUpdateSubject}
      />

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
              onChange={(event) => onRootDraftRuleChange(rule.key, event.target.value)}
              disabled={!canUpdatePolicy}
              className="h-9 w-full rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
              data-testid={rule.rootTestId}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        {allowListInvalid ? (
          <p className="mr-3 self-center text-xs text-error" data-testid="resource-policy__allow-list-required">
            {tResource('allow_list_required')}
          </p>
        ) : null}
        {hasDuplicateSubjects ? (
          <p className="mr-3 self-center text-xs text-error" data-testid="resource-policy__duplicate-subjects">
            {tResource('subjects.duplicate')}
          </p>
        ) : null}
        <Button
          type="button"
          onClick={onSave}
          disabled={!canUpdatePolicy || saving || allowListInvalid || hasDuplicateSubjects}
          variant="action"
          size="sm"
          className="h-9 px-4"
          data-testid="resource-policy__save"
        >
          {saving ? tResource('saving') : tResource('save_policy')}
        </Button>
      </div>

      <EffectiveSummary
        tResource={tResource}
        accessMode={accessMode}
        draftRootRuleSet={draftRootRuleSet}
        validSubjects={validSubjects}
      />

      <ExplainabilityPanel
        tResource={tResource}
        selectedResource={selectedResource}
        explainSubjectType={explainSubjectType}
        explainSubjectId={explainSubjectId}
        explainAction={explainAction}
        explainOptions={explainOptions}
        onExplainSubjectTypeChange={onExplainSubjectTypeChange}
        onExplainSubjectIdChange={onExplainSubjectIdChange}
        onExplainActionChange={onExplainActionChange}
        onRunExplain={onRunExplain}
        explainChecking={explainChecking}
        authorizationResult={authorizationResult}
        explainMatchedPolicy={explainMatchedPolicy}
      />

      <GovernanceAuditPanel tResource={tResource} policyAuditEvents={policyAuditEvents} />
    </div>
  );
}

function SubjectEditor(args: {
  tResource: (key: string) => string;
  selectedResourceType: ResourceRow['type'];
  canUpdatePolicy: boolean;
  subjects: EditableSubject[];
  duplicateSubjectRowIds: Set<string>;
  staleSubjectRowIds: string[];
  hasStaleSubjects: boolean;
  userOptions: SubjectOption[];
  groupOptions: SubjectOption[];
  onAddSubject: () => void;
  onRemoveSubject: (rowId: string) => void;
  onRemoveStaleSubjects: () => void;
  onUpdateSubject: (rowId: string, patch: Partial<EditableSubject>) => void;
}) {
  const {
    tResource,
    selectedResourceType,
    canUpdatePolicy,
    subjects,
    duplicateSubjectRowIds,
    staleSubjectRowIds,
    hasStaleSubjects,
    userOptions,
    groupOptions,
    onAddSubject,
    onRemoveSubject,
    onRemoveStaleSubjects,
    onUpdateSubject,
  } = args;

  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-tertiary">{tResource('subjects.title')}</p>
        <div className="flex items-center gap-2">
          {hasStaleSubjects ? (
            <Button
              type="button"
              onClick={onRemoveStaleSubjects}
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
            onClick={onAddSubject}
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
                      onUpdateSubject(subject.rowId, {
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
                    onChange={(event) => onUpdateSubject(subject.rowId, { subject_id: event.target.value })}
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
                      (option) => option.id === subject.subject_id,
                    ) ? (
                      <option value={subject.subject_id}>{subject.subject_id}</option>
                    ) : null}
                  </select>
                  <Button
                    type="button"
                    onClick={() => onRemoveSubject(subject.rowId)}
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
                <p className="text-xs text-error" data-testid={`resource-policy__subject-duplicate--${subject.rowId}`}>
                  {tResource('subjects.duplicate')}
                </p>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                {getRuleDefinitionsForResource(selectedResourceType).map((rule) => (
                  <input
                    key={rule.key}
                    type="number"
                    min={1}
                    value={subject.draftRules[rule.key] ?? ''}
                    onChange={(event) =>
                      onUpdateSubject(subject.rowId, {
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
  );
}

function EffectiveSummary(args: {
  tResource: (key: string) => string;
  accessMode: 'allow_all_members' | 'allow_list';
  draftRootRuleSet: ReturnType<typeof buildRuleSetFromDraft>;
  validSubjects: Array<{
    subject_type: 'group' | 'user';
    subject_id: string;
    rate_limits?: { rules: PolicyRule[] };
    spending_limits?: { rules: PolicyRule[] };
  }>;
}) {
  const { tResource, accessMode, draftRootRuleSet, validSubjects } = args;

  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-2" data-testid="resource-policy__effective-summary">
      <p className="text-xs font-medium text-foreground">{tResource('effective_summary.title')}</p>
      <p className="text-xs text-tertiary">
        {tResource('effective_summary.access')}: <span className="text-primary">{tResource(`access_mode.${accessMode}`)}</span>
      </p>
      <div className="space-y-1">
        {renderRuleSummary(
          draftRootRuleSet.rateRules,
          draftRootRuleSet.spendingRules,
          (key) => tResource(getRuleLabel(key)),
          tResource('effective_summary.no_explicit_limits'),
          (rule) => formatRuleValue(rule, tResource),
          () => tResource('effective_summary.source_resource'),
        )}
      </div>
      {validSubjects.length > 0 ? (
        <div className="pt-2 border-t border-subtle space-y-2">
          {validSubjects.map((subject, index) => {
            const effectiveRate = mergeRuleSets(draftRootRuleSet.rateRules, subject.rate_limits?.rules ?? []);
            const effectiveSpending = mergeRuleSets(draftRootRuleSet.spendingRules, subject.spending_limits?.rules ?? []);
            const effectiveTrace = mergeRuleSources(
              draftRootRuleSet.rateRules,
              draftRootRuleSet.spendingRules,
              subject.rate_limits?.rules ?? [],
              subject.spending_limits?.rules ?? [],
            );
            return (
              <div
                key={`${subject.subject_type}:${subject.subject_id}:${index}`}
                className="space-y-1"
                data-testid={`resource-policy__effective-subject--${index}`}
              >
                <p className="text-xs text-tertiary">
                  {tResource(`subjects.${subject.subject_type}`)}: <span className="text-primary">{subject.subject_id}</span>
                </p>
                {renderRuleSummary(
                  effectiveRate,
                  effectiveSpending,
                  (key) => tResource(getRuleLabel(key)),
                  tResource('effective_summary.no_explicit_limits'),
                  (rule) => formatRuleValue(rule, tResource),
                  (rule) =>
                    tResource(
                      effectiveTrace.get(rule.key) === 'subject'
                        ? 'effective_summary.source_subject'
                        : 'effective_summary.source_resource',
                    ),
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExplainabilityPanel(args: {
  tResource: (key: string) => string;
  selectedResource: ResourceRow;
  explainSubjectType: 'user' | 'group';
  explainSubjectId: string;
  explainAction: string;
  explainOptions: SubjectOption[];
  onExplainSubjectTypeChange: (value: 'user' | 'group') => void;
  onExplainSubjectIdChange: (value: string) => void;
  onExplainActionChange: (value: string) => void;
  onRunExplain: () => void;
  explainChecking: boolean;
  authorizationResult: GovernanceAuthorizationResponse | null;
  explainMatchedPolicy: GovernanceAuthorizationResponse['matched_policy'];
}) {
  const {
    tResource,
    selectedResource,
    explainSubjectType,
    explainSubjectId,
    explainAction,
    explainOptions,
    onExplainSubjectTypeChange,
    onExplainSubjectIdChange,
    onExplainActionChange,
    onRunExplain,
    explainChecking,
    authorizationResult,
    explainMatchedPolicy,
  } = args;

  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-3" data-testid="resource-policy__explainability">
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
            onChange={(event) => onExplainSubjectTypeChange(event.target.value as 'user' | 'group')}
            className="h-9 rounded-sm border border-subtle bg-surface-high px-2 text-sm text-foreground"
            data-testid="resource-policy__explain-subject-type"
          >
            <option value="user">{tResource('subjects.user')}</option>
            <option value="group">{tResource('subjects.group')}</option>
          </select>
          <select
            value={explainSubjectId}
            onChange={(event) => onExplainSubjectIdChange(event.target.value)}
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
            onChange={(event) => onExplainActionChange(event.target.value)}
            className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
            placeholder={tResource('explainability.action_placeholder')}
            data-testid="resource-policy__explain-action"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={onRunExplain}
          disabled={!explainSubjectId.trim() || explainChecking}
          variant="outline"
          size="sm"
          className="h-9 px-4"
          data-testid="resource-policy__explain-run"
        >
          {explainChecking ? tResource('explainability.checking') : tResource('explainability.run')}
        </Button>
      </div>
      {authorizationResult ? (
        <div className="rounded-sm border border-subtle bg-bg-base/10 p-3 space-y-2" data-testid="resource-policy__explain-result">
          <p className="text-xs text-tertiary">
            {tResource('explainability.decision')}:{' '}
            <span className="text-primary">
              {authorizationResult.allowed ? tResource('explainability.allowed') : tResource('explainability.denied')}
            </span>
          </p>
          <p className="text-xs text-tertiary">
            {tResource('explainability.source')}: <span className="text-primary">{authorizationResult.decision.source}</span>
          </p>
          <p className="text-xs text-tertiary">
            {tResource('explainability.reason')}: <span className="text-primary">{authorizationResult.decision.reason}</span>
          </p>
          {explainMatchedPolicy ? (
            <div className="rounded-sm border border-subtle bg-surface px-3 py-2 text-xs text-tertiary" data-testid="resource-policy__matched-policy">
              <p>
                {tResource('explainability.matched_policy')}: <span className="text-primary">{explainMatchedPolicy.id}</span>
              </p>
              <p>
                {tResource('explainability.access_mode')}:{' '}
                <span className="text-primary">{tResource(`access_mode.${explainMatchedPolicy.access_mode}`)}</span>
              </p>
              {explainMatchedPolicy.matched_subject ? (
                <p>
                  {tResource('explainability.matched_subject')}:{' '}
                  <span className="text-primary">
                    {tResource(`subjects.${explainMatchedPolicy.matched_subject.type}`)} / {explainMatchedPolicy.matched_subject.id}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GovernanceAuditPanel(args: {
  tResource: (key: string) => string;
  policyAuditEvents: Array<{
    id: string;
    timestamp: string;
    actor_id: string;
    action: string;
    resource_type?: string | null;
    resource_id?: string | null;
  }>;
}) {
  const { tResource, policyAuditEvents } = args;

  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-2" data-testid="resource-policy__governance-audit">
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
  );
}
