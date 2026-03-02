import type { ReleasePolicyOrganizationInput } from '@/lib/release-policy';

type ReportSummaryLike = {
  organization_governance_evidence?: {
    release_readiness?: 'ready' | 'blocked';
    blockers?: string[];
    warnings?: string[];
  };
  release_policy?: {
    blockers?: Array<{
      id?: string;
      source?: string;
      message?: string;
    }>;
    warnings?: Array<{
      id?: string;
      source?: string;
      message?: string;
    }>;
  };
};

export type OrganizationEvidenceResolution = {
  policyInput?: ReleasePolicyOrganizationInput;
  availability: 'loaded' | 'missing';
  source: 'summary' | 'release_policy' | 'none';
  blockerCount: number;
  warningCount: number;
};

function mapBlockerIdsToIssues(ids: string[]) {
  return ids.map((id) => ({
    id,
    message: id,
    severity: 'blocker' as const,
    source: 'organization_governance' as const,
    overridable: false,
  }));
}

function mapWarningIdsToIssues(ids: string[]) {
  return ids.map((id) => ({
    id,
    message: id,
    severity: 'warning' as const,
    source: 'organization_governance' as const,
    overridable: false,
  }));
}

export function resolveOrganizationEvidence(summary: ReportSummaryLike | undefined): OrganizationEvidenceResolution {
  const summaryEvidence = summary?.organization_governance_evidence;
  if (summaryEvidence) {
    const blockers = mapBlockerIdsToIssues(summaryEvidence.blockers ?? []);
    const warnings = mapWarningIdsToIssues(summaryEvidence.warnings ?? []);
    return {
      policyInput: {
        release_readiness: summaryEvidence.release_readiness,
        blockers,
        warnings,
      },
      availability: 'loaded',
      source: 'summary',
      blockerCount: blockers.length,
      warningCount: warnings.length,
    };
  }

  const policyBlockers = (summary?.release_policy?.blockers ?? []).filter((issue) => issue.source === 'organization_governance');
  const policyWarnings = (summary?.release_policy?.warnings ?? []).filter((issue) => issue.source === 'organization_governance');
  if (policyBlockers.length > 0 || policyWarnings.length > 0) {
    const blockers = mapBlockerIdsToIssues(policyBlockers.map((issue) => issue.id ?? issue.message ?? 'organization_governance_blocker'));
    const warnings = mapWarningIdsToIssues(policyWarnings.map((issue) => issue.id ?? issue.message ?? 'organization_governance_warning'));
    return {
      policyInput: {
        release_readiness: blockers.length > 0 ? 'blocked' : 'ready',
        blockers,
        warnings,
      },
      availability: 'loaded',
      source: 'release_policy',
      blockerCount: blockers.length,
      warningCount: warnings.length,
    };
  }

  return {
    availability: 'missing',
    source: 'none',
    blockerCount: 0,
    warningCount: 0,
  };
}
