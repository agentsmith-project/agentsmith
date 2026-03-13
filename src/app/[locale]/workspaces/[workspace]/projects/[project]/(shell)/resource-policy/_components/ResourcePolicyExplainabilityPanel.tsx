'use client';

import { Button } from '@/components/ui/button';
import type { GovernanceAuthorizationResponse } from '@/lib/api/endpoints/governance-explainability';
import type { ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';

import type { SubjectOption } from '../resource-policy-page-types';

interface ResourcePolicyExplainabilityPanelProps {
  authorizationResult: GovernanceAuthorizationResponse | null;
  explainAction: string;
  explainChecking: boolean;
  explainMatchedPolicy: GovernanceAuthorizationResponse['matched_policy'];
  explainOptions: SubjectOption[];
  explainSubjectId: string;
  explainSubjectType: 'user' | 'group';
  selectedResource: ResourceRow;
  tResource: (key: string) => string;
  onExplainActionChange: (value: string) => void;
  onExplainSubjectIdChange: (value: string) => void;
  onExplainSubjectTypeChange: (value: 'user' | 'group') => void;
  onRunExplain: () => void;
}

export function ResourcePolicyExplainabilityPanel({
  authorizationResult,
  explainAction,
  explainChecking,
  explainMatchedPolicy,
  explainOptions,
  explainSubjectId,
  explainSubjectType,
  selectedResource,
  tResource,
  onExplainActionChange,
  onExplainSubjectIdChange,
  onExplainSubjectTypeChange,
  onRunExplain,
}: ResourcePolicyExplainabilityPanelProps) {
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
