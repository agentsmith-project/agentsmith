import { describe, expect, it } from 'vitest';
import {
  getGovernanceReasonLabel,
  getGovernanceSourceLabel,
} from '@/lib/governance-explainability-presenter';

describe('governance-explainability-presenter', () => {
  it('maps known reason tokens to readable labels', () => {
    expect(getGovernanceReasonLabel('subject_not_allow_listed')).toBe('Subject is not on the current allow list');
    expect(getGovernanceReasonLabel('resource_default_allow_all')).toBe('Current resource allows all project members');
  });

  it('maps known source tokens to readable labels', () => {
    expect(getGovernanceSourceLabel('resource_policy')).toBe('Resource Policy');
    expect(getGovernanceSourceLabel('project_default')).toBe('Project Default');
  });

  it('humanizes unknown tokens', () => {
    expect(getGovernanceReasonLabel('custom_policy_reason')).toBe('Custom Policy Reason');
    expect(getGovernanceSourceLabel('member_override')).toBe('Member Override');
  });
});
