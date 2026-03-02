export type ReleasePolicySeverity = 'warning' | 'blocker';
export type ReleasePolicySource = 'execution' | 'runtime' | 'usage' | 'governance' | 'build';
export type ReleasePolicyDecision = 'ready' | 'warning' | 'blocked';

export type ReleasePolicyIssue = {
  id: string;
  severity: ReleasePolicySeverity;
  source: ReleasePolicySource;
  message: string;
  overridable: boolean;
};

export type ReleasePolicyEvaluation = {
  decision: ReleasePolicyDecision;
  blockers: ReleasePolicyIssue[];
  warnings: ReleasePolicyIssue[];
  summary: {
    total_issues: number;
    blocker_count: number;
    warning_count: number;
    overridable_count: number;
  };
};

export type ReleasePolicyOverrideStatus = 'pending' | 'approved' | 'rejected';

export type ReleasePolicyOverrideInput = {
  issue_id: string;
  status: ReleasePolicyOverrideStatus;
};

export type ReleasePolicyEnforcementDecision =
  | 'ready'
  | 'warning'
  | 'blocked'
  | 'pending_override'
  | 'releasable_with_override';

export type ReleasePolicyEnforcement = {
  decision: ReleasePolicyEnforcementDecision;
  base_decision: ReleasePolicyDecision;
  blocker_count: number;
  warning_count: number;
  pending_override_count: number;
  approved_override_count: number;
  unresolved_blockers: ReleasePolicyIssue[];
  overridden_blockers: ReleasePolicyIssue[];
  pending_override_issues: ReleasePolicyIssue[];
  rejected_override_issues: ReleasePolicyIssue[];
};

export type ReleasePolicyRuntimeInput = {
  release_readiness?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
  missing_usage_facts?: number;
  missing_price_facts?: number;
  release_candidate?: {
    release_status?: 'draft' | 'published' | 'archived';
    approvals_complete?: boolean;
  };
};

export type ReleasePolicyUsageInput = {
  release_readiness?: 'ready' | 'blocked';
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

export type ReleasePolicyExecutionInput = {
  failed_count?: number;
  transient_acceptance?: 'acceptable_with_retry' | 'mixed_or_blocking';
  failure_categories?: string[];
};

export type ReleasePolicyGovernanceInput = {
  release_readiness?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
  open_escalations?: number;
  critical_unassigned?: number;
  critical_overdue?: number;
  due_soon?: number;
};

export type ReleasePolicyBuildInput = {
  release_readiness?: 'ready' | 'blocked';
  blockers?: string[];
  warnings?: string[];
};

export type EvaluateReleasePolicyInput = {
  execution?: ReleasePolicyExecutionInput;
  runtime?: ReleasePolicyRuntimeInput;
  usage?: ReleasePolicyUsageInput;
  governance?: ReleasePolicyGovernanceInput;
  build?: ReleasePolicyBuildInput;
};

function dedupe(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function pushIssue(target: ReleasePolicyIssue[], issue: ReleasePolicyIssue): void {
  if (target.some((item) => item.id === issue.id && item.message === issue.message)) return;
  target.push(issue);
}

export function evaluateReleasePolicy(input: EvaluateReleasePolicyInput): ReleasePolicyEvaluation {
  const blockers: ReleasePolicyIssue[] = [];
  const warnings: ReleasePolicyIssue[] = [];

  const execution = input.execution;
  if ((execution?.failed_count ?? 0) > 0) {
    const onlyTransient = execution?.transient_acceptance === 'acceptable_with_retry';
    const issue: ReleasePolicyIssue = {
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

  const runtime = input.runtime;
  if (runtime) {
    if (runtime.release_readiness === 'blocked') {
      for (const blocker of dedupe(runtime.blockers ?? [])) {
        pushIssue(blockers, {
          id: `runtime_${blocker}`,
          severity: 'blocker',
          source: 'runtime',
          message: blocker,
          overridable: false,
        });
      }
      if ((runtime.blockers?.length ?? 0) === 0) {
        pushIssue(blockers, {
          id: 'runtime_release_readiness_blocked',
          severity: 'blocker',
          source: 'runtime',
          message: 'Runtime release readiness is blocked.',
          overridable: false,
        });
      }
    }
    if ((runtime.missing_usage_facts ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'runtime_pricing_coverage_incomplete',
        severity: 'blocker',
        source: 'runtime',
        message: `Runtime pricing coverage is incomplete (${runtime.missing_usage_facts} usage facts missing pricing version).`,
        overridable: false,
      });
    }
    if ((runtime.missing_price_facts ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'runtime_missing_price_facts',
        severity: 'blocker',
        source: 'runtime',
        message: `Runtime contains ${runtime.missing_price_facts} missing-price facts.`,
        overridable: false,
      });
    }
    if (runtime.release_candidate && runtime.release_candidate.release_status && runtime.release_candidate.release_status !== 'published') {
      pushIssue(blockers, {
        id: 'runtime_release_candidate_not_published',
        severity: 'blocker',
        source: 'runtime',
        message: `Runtime release candidate is ${runtime.release_candidate.release_status}, not published.`,
        overridable: false,
      });
    }
    if (runtime.release_candidate && runtime.release_candidate.approvals_complete === false) {
      pushIssue(blockers, {
        id: 'runtime_release_candidate_approvals_incomplete',
        severity: 'blocker',
        source: 'runtime',
        message: 'Runtime release candidate approvals are incomplete.',
        overridable: false,
      });
    }
    for (const warning of dedupe(runtime.warnings ?? [])) {
      pushIssue(warnings, {
        id: `runtime_${warning}`,
        severity: 'warning',
        source: 'runtime',
        message: warning,
        overridable: true,
      });
    }
  }

  const usage = input.usage;
  if (usage) {
    if (usage.release_readiness === 'blocked') {
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
          id: 'usage_release_readiness_blocked',
          severity: 'blocker',
          source: 'usage',
          message: 'Usage report release readiness is blocked.',
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
    if (governance.release_readiness === 'blocked') {
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
          id: 'governance_release_readiness_blocked',
          severity: 'blocker',
          source: 'governance',
          message: 'Governance release readiness is blocked.',
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
        message: `${governance.critical_unassigned} critical release escalations are unassigned.`,
        overridable: false,
      });
    }
    if ((governance.critical_overdue ?? 0) > 0) {
      pushIssue(blockers, {
        id: 'governance_critical_escalations_overdue',
        severity: 'blocker',
        source: 'governance',
        message: `${governance.critical_overdue} critical release escalations are overdue.`,
        overridable: false,
      });
    }
    if ((governance.due_soon ?? 0) > 0) {
      pushIssue(warnings, {
        id: 'governance_escalations_due_soon',
        severity: 'warning',
        source: 'governance',
        message: `${governance.due_soon} release escalations are approaching SLA due time.`,
        overridable: true,
      });
    }
    if ((governance.open_escalations ?? 0) > 0) {
      pushIssue(warnings, {
        id: 'governance_open_escalations_present',
        severity: 'warning',
        source: 'governance',
        message: `${governance.open_escalations} open release escalations require follow-up.`,
        overridable: true,
      });
    }
  }

  const build = input.build;
  if (build) {
    if (build.release_readiness === 'blocked') {
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
          id: 'build_release_readiness_blocked',
          severity: 'blocker',
          source: 'build',
          message: 'Build reliability release readiness is blocked.',
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

  const decision: ReleasePolicyDecision = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready';
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

export function mergeReleasePolicyEvaluations(
  base: ReleasePolicyEvaluation,
  extra?: ReleasePolicyEvaluation,
): ReleasePolicyEvaluation {
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

export function enforceReleasePolicy(
  evaluation: ReleasePolicyEvaluation,
  overrides: ReleasePolicyOverrideInput[],
): ReleasePolicyEnforcement {
  const statusByIssueId = new Map<string, ReleasePolicyOverrideStatus>();
  for (const override of overrides) {
    statusByIssueId.set(override.issue_id, override.status);
  }

  const unresolvedBlockers: ReleasePolicyIssue[] = [];
  const overriddenBlockers: ReleasePolicyIssue[] = [];
  const pendingOverrideIssues: ReleasePolicyIssue[] = [];
  const rejectedOverrideIssues: ReleasePolicyIssue[] = [];

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

  let decision: ReleasePolicyEnforcementDecision;
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
