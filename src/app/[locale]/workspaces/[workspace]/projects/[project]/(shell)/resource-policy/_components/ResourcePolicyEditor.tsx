'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { GovernanceAuthorizationResponse } from '@/lib/api/endpoints/governance-explainability';
import type { PolicyRule, PolicyRuleKey, ResourcePolicy } from '@/lib/api/types';
import {
  getRuleDefinitionsForResource,
} from '@/lib/constants/resource-policy';
import { buildRuleSetFromDraft } from '@/lib/resource-policy/editor-utils';
import type { ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';
import type { EditableSubject, SubjectOption } from '../resource-policy-page-types';
import { ResourcePolicyEffectiveSummary } from './ResourcePolicyEffectiveSummary';
import { ResourcePolicyExplainabilityPanel } from './ResourcePolicyExplainabilityPanel';
import { ResourcePolicyGovernanceAuditPanel } from './ResourcePolicyGovernanceAuditPanel';
import { ResourcePolicySubjectEditor } from './ResourcePolicySubjectEditor';

export function ResourcePolicyEditor(args: {
  basePath: string;
  tResource: (key: string, values?: Record<string, string | number>) => string;
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
    basePath,
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
        className="space-y-3 rounded-md border border-subtle bg-surface-high p-4"
        data-testid="resource-policy__editor"
      >
        <p className="text-sm text-tertiary">{tResource('select_resource')}</p>
      </div>
    );
  }

  if (policyLoading) {
    return (
      <div
        className="space-y-3 rounded-md border border-subtle bg-surface-high p-4"
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
      className="space-y-4 rounded-md border border-subtle bg-surface-high p-4"
      data-testid="resource-policy__editor"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">{selectedResource.name}</h3>
        <p className="text-xs text-tertiary">{tResource(`resource_type.${selectedResource.type}`)}</p>
        <p className="text-xs text-tertiary">
          {tResource(`editor_hint.${selectedResource.type}`)}
        </p>
      </div>

      <div className="space-y-2 border-t border-subtle pt-4">
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

      <div className="space-y-3 border-t border-subtle pt-4">
        <ResourcePolicySubjectEditor
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
      </div>

      <div className="space-y-3 border-t border-subtle pt-4">
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
              placeholder={rule.suggestedValue ? String(rule.suggestedValue) : undefined}
              className="h-9 w-full rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
              data-testid={rule.rootTestId}
            />
            {rule.suggestedValue ? (
              <p className="text-[11px] text-tertiary" data-testid={`${rule.rootTestId}__suggested-default`}>
                {tResource('suggested_default', { value: rule.suggestedValue })}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex justify-end border-t border-subtle pt-4">
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

      <div className="space-y-4 border-t border-subtle pt-4">
        <ResourcePolicyEffectiveSummary
          tResource={tResource}
          accessMode={accessMode}
          draftRootRuleSet={draftRootRuleSet}
          validSubjects={validSubjects}
        />

        <ResourcePolicyExplainabilityPanel
          basePath={basePath}
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

        <ResourcePolicyGovernanceAuditPanel tResource={tResource} policyAuditEvents={policyAuditEvents} />
      </div>
    </div>
  );
}
