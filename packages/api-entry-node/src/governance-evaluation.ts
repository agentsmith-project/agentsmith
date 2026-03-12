export type GovernanceIssueSeverity = 'warning' | 'blocker';
export type GovernanceIssueSource = 'execution' | 'configuration' | 'usage' | 'governance' | 'workspace_governance' | 'organization_governance' | 'build';
export type GovernanceDecision = 'ready' | 'warning' | 'blocked';

export type GovernanceIssue = {
  id: string;
  severity: GovernanceIssueSeverity;
  source: GovernanceIssueSource;
  message: string;
  overridable: boolean;
};

export type GovernanceEvaluation = {
  decision: GovernanceDecision;
  blockers: GovernanceIssue[];
  warnings: GovernanceIssue[];
  summary: {
    total_issues: number;
    blocker_count: number;
    warning_count: number;
    overridable_count: number;
  };
};

export type GovernanceOverrideStatus = 'pending' | 'approved' | 'rejected';

export type GovernanceOverrideInput = {
  issue_id: string;
  status: GovernanceOverrideStatus;
};

export type GovernanceEnforcementDecision =
  | 'ready'
  | 'warning'
  | 'blocked'
  | 'pending_override'
  | 'releasable_with_override';

export type GovernanceEnforcement = {
  decision: GovernanceEnforcementDecision;
  base_decision: GovernanceDecision;
  blocker_count: number;
  warning_count: number;
  pending_override_count: number;
  approved_override_count: number;
  unresolved_blockers: GovernanceIssue[];
  overridden_blockers: GovernanceIssue[];
  pending_override_issues: GovernanceIssue[];
  rejected_override_issues: GovernanceIssue[];
};

export type ExecutionReviewInput = {
  review_status?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
  missing_usage_facts?: number;
  missing_price_facts?: number;
  target?: {
    status?: 'draft' | 'active' | 'archived';
    approvals_complete?: boolean;
  };
};

export type UsageEvidenceInput = {
  review_status?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
  required_schedules?: number;
  unacknowledged_required_deliveries?: number;
  runner_health?: {
    enabled?: boolean;
    last_status?: 'idle' | 'success' | 'failed';
    run_count?: number;
  };
};

export type ExecutionEvidenceInput = {
  failed_count?: number;
  transient_acceptance?: 'acceptable_with_retry' | 'mixed_or_blocking';
  failure_categories?: string[];
};

export type GovernanceEvidenceInput = {
  review_status?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
  open_escalations?: number;
  critical_unassigned?: number;
  critical_overdue?: number;
  due_soon?: number;
};

/**
 * Organization-level governance evidence for execution/configuration review.
 * These are hard fails that can block review acceptance across all projects.
 */
export type OrganizationEvidenceInput = {
  /** Organization review status */
  review_status?: 'ready' | 'blocked';
  /** Organization-level blockers (e.g., compliance violations, security issues) */
  blockers?: Array<{
    id: string;
    message: string;
    severity: 'blocker' | 'warning';
    source: 'organization_governance';
    overridable: boolean;
  }>;
  /** Organization-level warnings */
  warnings?: Array<{
    id: string;
    message: string;
    severity: 'warning';
    source: 'organization_governance';
    overridable: boolean;
  }>;
  /** Count of organization-level critical escalations */
  critical_escalations?: number;
  /** Count of unassigned organization-level critical escalations */
  critical_unassigned?: number;
  /** Organization-level compliance hard fails */
  compliance_hard_fails?: number;
};

export type BuildEvidenceInput = {
  review_status?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
};

export type EvaluateGovernanceInput = {
  execution?: ExecutionEvidenceInput;
  configuration?: ExecutionReviewInput;
  usage?: UsageEvidenceInput;
  governance?: GovernanceEvidenceInput;
  organization?: OrganizationEvidenceInput;
  build?: BuildEvidenceInput;
};

function dedupe(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function pushIssue(target: GovernanceIssue[], issue: GovernanceIssue): void {
  if (target.some((item) => item.id === issue.id && item.message === issue.message)) return;
  target.push(issue);
}

export function evaluateGovernance(input: EvaluateGovernanceInput): GovernanceEvaluation {
  const blockers: GovernanceIssue[] = [];
  const warnings: GovernanceIssue[] = [];

  const execution = input.execution;
  if ((execution?.failed_count ?? 0) > 0) {
    const onlyTransient = execution?.transient_acceptance === 'acceptable_with_retry';
    const issue: GovernanceIssue = {
      id: onlyTransient ? 'execution_transient_failures_present' : 'execution_failures_present',
      severity: onlyTransient ? 'warning' : 'blocker',
      source: 'execution',
      message: onlyTransient
        ? 'Execution contains only transient upstream failures and should be retried before acceptance.'
        : `Execution has ${execution?.failed_count ?? 0} failed checks.`,
      overridable: true,
    };
    pushIssue(onlyTransient ? warnings : blockers, issue);
  }

  const configuration = input.configuration;
  if (configuration) {
    if (configuration.review_status === 'blocked') {
      for (const blocker of dedupe(configuration.blockers ?? [])) {
        pushIssue(blockers, {
          id: `configuration_${blocker}`,
          severity: 'blocker',
          source: 'configuration',
          message: blocker,
          overridable: false,
        });
      }
      if ((configuration.blockers?.length ?? 0) === 0) {
        pushIssue(blockers, {
          id: 'execution_review_status_blocked',
          severity: 'blocker',
          source: 'configuration',
          message: 'Configuration review status is blocked.',
          overridable: false,
        });
      }
    }
    if ((configuration.missing_usage_facts ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'project_pricing_coverage_incomplete',
        severity: 'blocker',
        source: 'configuration',
        message: `Project pricing coverage is incomplete (${configuration.missing_usage_facts} usage facts missing pricing source).`,
        overridable: false,
      });
    }
    if ((configuration.missing_price_facts ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'configuration_missing_price_facts',
        severity: 'blocker',
        source: 'configuration',
        message: `Configuration contains ${configuration.missing_price_facts} missing-price facts.`,
        overridable: false,
      });
    }
    if (configuration.target && configuration.target.status && configuration.target.status !== 'active') {
      pushIssue(blockers, {
        id: 'configuration_target_not_active',
        severity: 'blocker',
        source: 'configuration',
        message: `Execution target is ${configuration.target.status}, not active.`,
        overridable: false,
      });
    }
    if (configuration.target && configuration.target.approvals_complete === false) {
      pushIssue(blockers, {
        id: 'configuration_target_approvals_incomplete',
        severity: 'blocker',
        source: 'configuration',
        message: 'Execution target approvals are incomplete.',
        overridable: false,
      });
    }
    for (const warning of dedupe(configuration.warnings ?? [])) {
      pushIssue(warnings, {
        id: `configuration_${warning}`,
        severity: 'warning',
        source: 'configuration',
        message: warning,
        overridable: true,
      });
    }
  }

  const usage = input.usage;
  if (usage) {
    if (usage.review_status === 'blocked') {
      for (const blocker of dedupe(usage.blockers ?? [])) {
        pushIssue(blockers, {
          id: `usage_${blocker}`,
          severity: 'blocker',
          source: 'usage',
          message: blocker,
          overridable: false,
        });
      }
      if ((usage.blockers?.length ?? 0) === 0) {
        pushIssue(blockers, {
          id: 'usage_review_status_blocked',
          severity: 'blocker',
          source: 'usage',
          message: 'Usage report review status is blocked.',
          overridable: false,
        });
      }
    }
    if ((usage.required_schedules ?? 0) === 0) {
      pushIssue(blockers, {
        id: 'usage_required_schedules_missing',
        severity: 'blocker',
        source: 'usage',
        message: 'No required usage-report schedules are configured.',
        overridable: false,
      });
    }
    if ((usage.unacknowledged_required_deliveries ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'usage_required_deliveries_unacknowledged',
        severity: 'blocker',
        source: 'usage',
        message: `${usage.unacknowledged_required_deliveries} required usage-report deliveries are unacknowledged.`,
        overridable: false,
      });
    }
    if (usage.runner_health?.enabled === false) {
      pushIssue(blockers, {
        id: 'usage_runner_disabled',
        severity: 'blocker',
        source: 'usage',
        message: 'Usage-report runner is disabled.',
        overridable: false,
      });
    }
    if (usage.runner_health?.last_status === 'failed') {
      pushIssue(blockers, {
        id: 'usage_runner_last_failed',
        severity: 'blocker',
        source: 'usage',
        message: 'Usage-report runner last execution failed.',
        overridable: false,
      });
    }
    if ((usage.runner_health?.run_count ?? 0) === 0) {
      pushIssue(blockers, {
        id: 'usage_runner_never_executed',
        severity: 'blocker',
        source: 'usage',
        message: 'Usage-report runner has not executed yet.',
        overridable: false,
      });
    }
    for (const warning of dedupe(usage.warnings ?? [])) {
      pushIssue(warnings, {
        id: `usage_${warning}`,
        severity: 'warning',
        source: 'usage',
        message: warning,
        overridable: true,
      });
    }
  }

  const governance = input.governance;
  if (governance) {
    if (governance.review_status === 'blocked') {
      for (const blocker of dedupe(governance.blockers ?? [])) {
        pushIssue(blockers, {
          id: `governance_${blocker}`,
          severity: 'blocker',
          source: 'governance',
          message: blocker,
          overridable: false,
        });
      }
      if ((governance.blockers?.length ?? 0) === 0) {
        pushIssue(blockers, {
          id: 'governance_review_status_blocked',
          severity: 'blocker',
          source: 'governance',
          message: 'Governance review status is blocked.',
          overridable: false,
        });
      }
    }
    for (const warning of dedupe(governance.warnings ?? [])) {
      pushIssue(warnings, {
        id: `governance_${warning}`,
        severity: 'warning',
        source: 'governance',
        message: warning,
        overridable: true,
      });
    }
    if ((governance.critical_unassigned ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'governance_critical_escalations_unassigned',
        severity: 'blocker',
        source: 'governance',
        message: `${governance.critical_unassigned} critical governance incidents are unassigned.`,
        overridable: false,
      });
    }
    if ((governance.critical_overdue ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'governance_critical_escalations_overdue',
        severity: 'blocker',
        source: 'governance',
        message: `${governance.critical_overdue} critical governance incidents are overdue.`,
        overridable: false,
      });
    }
    if ((governance.due_soon ?? 0) > 0) {
      pushIssue(warnings, {
        id: 'governance_escalations_due_soon',
        severity: 'warning',
        source: 'governance',
        message: `${governance.due_soon} governance incidents are approaching SLA due time.`,
        overridable: true,
      });
    }
    if ((governance.open_escalations ?? 0) > 0) {
      pushIssue(warnings, {
        id: 'governance_open_escalations_present',
        severity: 'warning',
        source: 'governance',
        message: `${governance.open_escalations} open governance incidents require follow-up.`,
        overridable: true,
      });
    }
  }

  const organization = input.organization;
  if (organization) {
    // Organization-level evidence is HARD FAIL - these blockers cannot be overridden
    if (organization.review_status === 'blocked') {
      pushIssue(blockers, {
        id: 'organization_review_status_blocked',
        severity: 'blocker',
        source: 'organization_governance',
        message: 'Organization-level review status is blocked.',
        overridable: false,
      });
    }

    // Process organization-level blockers
    if (organization.blockers) {
      for (const blocker of organization.blockers) {
        if (blocker.severity === 'blocker') {
          pushIssue(blockers, {
            id: blocker.id,
            severity: 'blocker',
            source: 'organization_governance',
            message: blocker.message,
            overridable: false, // Organization-level blockers are never overridable
          });
        }
      }
    }

    // Process organization-level warnings
    if (organization.warnings) {
      for (const warning of organization.warnings) {
        pushIssue(warnings, {
          id: warning.id,
          severity: 'warning',
          source: 'organization_governance',
          message: warning.message,
          overridable: false, // Organization warnings are also not overridable
        });
      }
    }

    // Organization-level critical escalations are hard fails
    if ((organization.critical_escalations ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'organization_critical_escalations_present',
        severity: 'blocker',
        source: 'organization_governance',
        message: `${organization.critical_escalations} organization-level critical escalations require resolution before review completion.`,
        overridable: false,
      });
    }

    // Unassigned organization critical escalations
    if ((organization.critical_unassigned ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'organization_critical_escalations_unassigned',
        severity: 'blocker',
        source: 'organization_governance',
        message: `${organization.critical_unassigned} organization-level critical escalations are unassigned to an owner.`,
        overridable: false,
      });
    }

    // Organization compliance hard fails
    if ((organization.compliance_hard_fails ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'organization_compliance_hard_fails_present',
        severity: 'blocker',
        source: 'organization_governance',
        message: `${organization.compliance_hard_fails} organization-level compliance hard fails must be resolved.`,
        overridable: false,
      });
    }
  }

  const build = input.build;
  if (build) {
    if (build.review_status === 'blocked') {
      for (const blocker of dedupe(build.blockers ?? [])) {
        pushIssue(blockers, {
          id: `build_${blocker}`,
          severity: 'blocker',
          source: 'build',
          message: blocker,
          overridable: false,
        });
      }
      if ((build.blockers?.length ?? 0) === 0) {
        pushIssue(blockers, {
          id: 'build_review_status_blocked',
          severity: 'blocker',
          source: 'build',
          message: 'Build reliability review status is blocked.',
          overridable: false,
        });
      }
    }
    for (const warning of dedupe(build.warnings ?? [])) {
      pushIssue(warnings, {
        id: `build_${warning}`,
        severity: 'warning',
        source: 'build',
        message: warning,
        overridable: true,
      });
    }
  }

  const decision: GovernanceDecision = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready';
  const overridableCount = [...blockers, ...warnings].filter((issue) => issue.overridable).length;

  return {
    decision,
    blockers,
    warnings,
    summary: {
      total_issues: blockers.length + warnings.length,
      blocker_count: blockers.length,
      warning_count: warnings.length,
      overridable_count: overridableCount,
    },
  };
}

export function mergeGovernanceEvaluations(
  base: GovernanceEvaluation,
  extra?: GovernanceEvaluation,
): GovernanceEvaluation {
  if (!extra) return base;
  const blockers = [...base.blockers];
  const warnings = [...base.warnings];
  for (const issue of extra.blockers) {
    pushIssue(blockers, issue);
  }
  for (const issue of extra.warnings) {
    pushIssue(warnings, issue);
  }
  return {
    decision: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready',
    blockers,
    warnings,
    summary: {
      total_issues: blockers.length + warnings.length,
      blocker_count: blockers.length,
      warning_count: warnings.length,
      overridable_count: [...blockers, ...warnings].filter((issue) => issue.overridable).length,
    },
  };
}

export function enforceGovernance(
  evaluation: GovernanceEvaluation,
  overrides: GovernanceOverrideInput[],
): GovernanceEnforcement {
  const statusByIssueId = new Map<string, GovernanceOverrideStatus>();
  for (const override of overrides) {
    statusByIssueId.set(override.issue_id, override.status);
  }

  const unresolvedBlockers: GovernanceIssue[] = [];
  const overriddenBlockers: GovernanceIssue[] = [];
  const pendingOverrideIssues: GovernanceIssue[] = [];
  const rejectedOverrideIssues: GovernanceIssue[] = [];

  for (const blocker of evaluation.blockers) {
    const status = statusByIssueId.get(blocker.id);
    if (status === 'approved' && blocker.overridable) {
      overriddenBlockers.push(blocker);
      continue;
    }
    unresolvedBlockers.push(blocker);
    if (status === 'pending' && blocker.overridable) {
      pendingOverrideIssues.push(blocker);
    }
    if (status === 'rejected' && blocker.overridable) {
      rejectedOverrideIssues.push(blocker);
    }
  }

  let decision: GovernanceEnforcementDecision;
  if (unresolvedBlockers.length > 0) {
    const unresolvedOverridable = unresolvedBlockers.filter((issue) => issue.overridable);
    const unresolvedNonOverridable = unresolvedBlockers.filter((issue) => !issue.overridable);
    const allRemainingBlockersPending =
      unresolvedNonOverridable.length === 0
      && unresolvedOverridable.length > 0
      && unresolvedOverridable.every((issue) => statusByIssueId.get(issue.id) === 'pending');

    decision = allRemainingBlockersPending ? 'pending_override' : 'blocked';
  } else if (overriddenBlockers.length > 0) {
    decision = 'releasable_with_override';
  } else if (evaluation.decision === 'warning') {
    decision = 'warning';
  } else {
    decision = 'ready';
  }

  return {
    decision,
    base_decision: evaluation.decision,
    blocker_count: evaluation.summary.blocker_count,
    warning_count: evaluation.summary.warning_count,
    pending_override_count: pendingOverrideIssues.length,
    approved_override_count: overriddenBlockers.length,
    unresolved_blockers: unresolvedBlockers,
    overridden_blockers: overriddenBlockers,
    pending_override_issues: pendingOverrideIssues,
    rejected_override_issues: rejectedOverrideIssues,
  };
}
