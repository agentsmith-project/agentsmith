import type { GovernanceEvaluation } from '../../packages/api-entry-node/src/governance-evaluation.js';

/**
 * Governance Report Type Definitions (Epic D1)
 *
 * Schema for structured governance verification reports.
 * Supports JSON output for machine processing and Markdown for human review.
 */

/**
 * Main governance report structure
 */
export interface GovernanceReport {
  /** Report metadata (when, where, what) */
  metadata: ReportMetadata;
  /** Execution results (checks, status) */
  execution: ExecutionResults;
  /** Summary and recommendations */
  summary: ReportSummary;
}

/**
 * Report metadata
 */
export interface ReportMetadata {
  /** ISO timestamp when verification started */
  timestamp: string;
  /** Total duration in milliseconds */
  duration_ms: number;
  /** Environment information */
  environment: EnvironmentInfo;
  /** Git repository information */
  git: GitInfo;
}

/**
 * Environment information
 */
export interface EnvironmentInfo {
  /** Node.js version */
  node_version: string;
  /** npm version (if available) */
  npm_version?: string;
  /** OS platform */
  platform: string;
  /** OS architecture */
  arch: string;
  /** Current working directory */
  cwd: string;
}

/**
 * Git repository information
 */
export interface GitInfo {
  /** Full commit SHA */
  commit_hash: string;
  /** Short commit SHA (7+ chars) */
  commit_short: string;
  /** Branch name */
  branch: string;
  /** Commit range (if provided, e.g., "abc123..def456") */
  commit_range?: string;
  /** Commit message (first line) */
  commit_message: string;
  /** Commit author */
  author: string;
  /** Commit date (ISO) */
  date: string;
  /** Tag (if on a tag) */
  tag?: string;
}

/**
 * Execution results
 */
export interface ExecutionResults {
  /** Total number of checks executed */
  total_checks: number;
  /** Number of passed checks */
  passed: number;
  /** Number of failed checks */
  failed: number;
  /** Number of skipped checks */
  skipped: number;
  /** Individual check results */
  checks: CheckResult[];
}

/**
 * Individual check result
 */
export interface CheckResult {
  /** Check identifier */
  id?: string;
  /** Check name (e.g., "TypeScript typecheck") */
  name: string;
  /** Check category */
  category: CheckCategory;
  /** Check status */
  status: CheckStatus;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Command that was run */
  command?: string;
  /** Standard output (truncated if too long) */
  output?: string;
  /** Error output if failed */
  error?: string;
  /** Exit code */
  exit_code?: number;
}

/**
 * Check categories */
export type CheckCategory =
  | 'contract'       // Contract verification (OpenAPI, types)
  | 'smoke-main'     // Mainline smoke tests
  | 'smoke-governance'  // Governance smoke tests
  | 'typecheck'      // TypeScript type checking
  | 'unit'           // Unit tests
  | 'e2e';           // End-to-end tests

/**
 * Check status */
export type CheckStatus = 'pass' | 'fail' | 'skip' | 'timeout';

/**
 * Report summary
 */
export interface ReportSummary {
  /** Overall status (pass if all checks pass, fail otherwise) */
  status: 'pass' | 'fail';
  /** Unified governance-policy evaluation across execution/configuration/usage signals */
  governance_policy?: GovernanceEvaluation;
  /** Failure breakdown by category (present if failed > 0) */
  failure_categories?: FailureCategory[];
  /** Expected upstream transient instability summary (present if detected) */
  upstream_transient?: UpstreamTransientSummary;
  /** Execution review evidence collected from the real-lane execution workflow */
  execution_review_evidence?: ExecutionReviewEvidence;
  /** Governance execution evidence collected from governance smoke */
  governance_evidence?: GovernanceReviewEvidence;
  /** Build reliability evidence collected from build execution smoke lanes */
  build_reliability_evidence?: BuildReliabilityReviewEvidence;
  /** Workspace governance evidence collected from workspace governance smoke lane */
  workspace_governance_evidence?: WorkspaceGovernanceReviewEvidence;
  /** Organization governance evidence collected from org governance smoke lane */
  organization_governance_evidence?: OrganizationGovernanceReviewEvidence;
  /** Troubleshooting recommendations (present if failed > 0) */
  recommendations?: string[];
  /** Quick stats for governance notes */
  stats: ReleaseStats;
}

/**
 * Failure category grouping */
export interface FailureCategory {
  /** Category type */
  category: FailureType;
  /** Number of failures in this category */
  count: number;
  /** List of check names that failed in this category */
  checks: string[];
  /** Common pattern detected */
  pattern?: string;
}

/**
 * Failure types for classification (Epic D2)
 */
export type FailureType =
  | 'token'      // Auth token issues (401/403/expired)
  | 'network'    // Network issues (timeout/ECONNREFUSED/DNS)
  | 'backend'    // Backend errors (5xx/API errors)
  | 'assertion'  // Test assertion failures
  | 'timeout'    // Operation timeout
  | 'authorization' // Governance authorization failures
  | 'spending_limit' // Spending limit exceeded
  | 'rate_limit' // Upstream/provider throttling
  | 'permission' // Access control failures
  | 'unknown';   // Unclassified

/**
 * Upstream transient instability summary used by governance acceptance
 */
export interface UpstreamTransientSummary {
  /** Number of failed checks mapped to upstream transient causes */
  count: number;
  /** Categories considered transient in this run */
  categories: FailureType[];
  /** Failed checks influenced by transient upstream factors */
  checks: string[];
  /**
   * acceptable_with_retry:
   *   Only transient upstream failures observed, product checks can pass after retry.
   * mixed_or_blocking:
   *   Transient failures exist but also non-transient failures needing fixes.
   */
  acceptance: 'acceptable_with_retry' | 'mixed_or_blocking';
  /** Human-readable note for governance reviewers */
  note: string;
}

/**
 * Governance statistics for quick reference
 */
export interface ReleaseStats {
  /** Total test execution time */
  total_duration_ms: number;
  /** Fastest check */
  fastest_check: { name: string; duration_ms: number };
  /** Slowest check */
  slowest_check: { name: string; duration_ms: number };
  /** Checks by category */
  by_category: Record<CheckCategory, { total: number; passed: number; failed: number }>;
}

export interface ExecutionReviewEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when execution review evidence was generated */
  generated_at: string;
  /** Review checks for the current execution target */
  checks: ExecutionReviewChecks;
  /** Request-level pricing source coverage across sampled usage facts */
  pricing_source_coverage: ProjectPricingSourceCoverage;
  /** Current target details captured from the execution configuration */
  target?: ExecutionReviewTarget;
  /** Optional note for reviewers when evidence is partial */
  note?: string;
}

export interface ExecutionReviewChecks {
  /** Execution target that was evaluated */
  target: string;
  /** Ready or blocked state reported by review checks */
  review_status: 'ready' | 'blocked';
  /** Blocking review issues */
  blockers: string[];
  /** Warning-only review debt */
  warnings: string[];
  /** Number of sampled execution attempts */
  planned_attempts: number;
}

export interface ProjectPricingSourceCoverage {
  /** Total sampled usage facts included in the coverage calculation */
  total_usage_facts: number;
  /** Usage facts with a non-null pricing_source */
  covered_usage_facts: number;
  /** Usage facts missing pricing_source */
  missing_usage_facts: number;
  /** Usage facts explicitly marked missing_price */
  missing_price_facts: number;
  /** Coverage ratio in [0,1] */
  coverage_ratio: number;
}

export interface ExecutionReviewTarget {
  /** current target type */
  target_type: 'model';
  /** target id */
  target_id: string;
  /** current state */
  status: 'draft' | 'active' | 'archived';
  /** staged or direct change mode */
  change_mode?: 'full' | 'canary';
  /** staged percent when applicable */
  change_percent?: number | null;
  /** all required approvals completed */
  approvals_complete: boolean;
  /** current state timestamp */
  activated_at?: string | null;
}

export interface GovernanceReviewEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when governance evidence was generated */
  generated_at: string;
  /** Release readiness derived from governance execution effects */
  review_status: 'ready' | 'blocked';
  /** Blocking governance failures */
  blockers: string[];
  /** Warning-only governance debt */
  warnings: string[];
  /** Focused governance effects that were exercised in the smoke lane */
  checks: {
    page_smoke: boolean;
    interaction_smoke: boolean;
    endpoint_policy_effects: boolean;
    member_permission_effect: boolean;
    member_lifecycle_effect: boolean;
    sse_ticket_hardening: boolean;
  };
  /** Optional reviewer note */
  note?: string;
}

export interface BuildReliabilityReviewEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when build reliability evidence was generated */
  generated_at: string;
  /** Review status derived from build reliability checks */
  review_status: 'ready' | 'blocked';
  /** Blocking build reliability failures */
  blockers: string[];
  /** Warning-only build reliability debt */
  warnings: string[];
  /** Focused build reliability checks covered by this evidence */
  checks: {
    realtime_session_resilience: boolean;
    notebook_trace_fidelity: boolean;
    build_failure_explainability: boolean;
    cross_surface_diagnostics: boolean;
    chat_recovery_integration: boolean;
    notebook_external_execution: boolean;
  };
  /** Optional reviewer note */
  note?: string;
}

export interface WorkspaceGovernanceReviewEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when workspace governance evidence was generated */
  generated_at: string;
  /** Release readiness derived from workspace governance checks */
  review_status: 'ready' | 'blocked';
  /** Blocking workspace governance failures */
  blockers: string[];
  /** Warning-only workspace governance debt */
  warnings: string[];
  /** Focused workspace governance checks covered by this evidence */
  checks: {
    workspace_overview: boolean;
    workspace_member_administration: boolean;
    cross_project_actions: boolean;
    workspace_explainability: boolean;
    workspace_attention_drilldown: boolean;
  };
  /** Optional reviewer note */
  note?: string;
}

export interface OrganizationGovernanceReviewEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when organization governance evidence was generated */
  generated_at: string;
  /** Release readiness derived from organization governance checks */
  review_status: 'ready' | 'blocked';
  /** Blocking organization governance failures */
  blockers: string[];
  /** Warning-only organization governance debt */
  warnings: string[];
  /** Focused organization governance checks covered by this evidence */
  checks: {
    org_overview_summary: boolean;
    workspace_matrix: boolean;
    actions_queue_execution: boolean;
    evidence_drilldown_chain: boolean;
  };
  /** Optional reviewer note */
  note?: string;
}

export interface GovernanceEvidenceIssue {
  source: 'governance' | 'workspace_governance' | 'organization_governance';
  message: string;
}

export interface GovernanceRunHistory {
  /** Unique gate run id */
  id: string;
  /** Logical incident lineage id for gate/escalation/override correlation */
  incident_id: string;
  /** Governance report artifact name linked to this run */
  report_name: string;
  /** Artifact name for browsing/report download */
  artifact_name: string;
  /** Trigger source for the gate execution */
  trigger: 'manual' | 'scheduled' | 'ci' | 'unknown';
  /** ISO timestamp when the gate started */
  started_at: string;
  /** ISO timestamp when the gate completed */
  completed_at: string;
  /** Total gate duration */
  duration_ms: number;
  /** Final gate status */
  status: 'pass' | 'fail';
  /** Git branch for this run */
  branch?: string;
  /** Short commit sha */
  commit_short?: string;
  /** Unified governance policy decision */
  governance_policy_decision?: 'ready' | 'warning' | 'blocked';
  /** Execution review status captured for the run */
  execution_review_status?: 'ready' | 'blocked';
  /** Structured governance blockers for run-level traceability */
  governance_blockers: GovernanceEvidenceIssue[];
  /** Structured governance warnings for run-level traceability */
  governance_warnings: GovernanceEvidenceIssue[];
  /** Execution counters */
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  /** First failed step for quick triage */
  failed_step_name?: string;
  failed_step_category?: CheckCategory;
  /** Full failed step names */
  failed_step_names: string[];
  /** Full failed step ids */
  failed_check_ids?: string[];
  /** Distinct failure categories */
  failure_categories: FailureType[];
  /** Execution subset for this run */
  requested_check_ids?: string[];
  /** Manual rerun source run id when applicable */
  rerun_of_run_id?: string;
  /** Optional operator notes */
  notes?: string;
  /** Actor metadata for manual trigger flows */
  actor_user_id?: string;
  actor_name?: string;
}

export interface GovernanceIncidentEvent {
  id: string;
  incident_id: string;
  report_name: string;
  run_id: string;
  created_at: string;
  event_type: 'gate_blocked' | 'gate_warning' | 'gate_ready' | 'override_requested' | 'override_decided';
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'resolved';
  title: string;
  body?: string;
  artifact_name?: string;
  trigger?: 'manual' | 'scheduled' | 'ci' | 'unknown';
  governance_policy_decision?: 'ready' | 'warning' | 'blocked';
  execution_review_status?: 'ready' | 'blocked';
  governance_blockers?: GovernanceEvidenceIssue[];
  governance_warnings?: GovernanceEvidenceIssue[];
  failed_step_name?: string;
  failure_categories?: FailureType[];
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  resolution_reason?: string;
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  webhook_delivery?: {
    status: 'success' | 'failed' | 'skipped';
    attempted_at?: string;
    response_status?: number;
    error?: string;
    duration_ms?: number;
  };
}

/**
 * CLI options for the verify-governance-report script
 */
export interface VerifyReleaseOptions {
  /** Output directory for reports */
  output?: string;
  /** Report name (without extension) */
  name?: string;
  /** Commit range (e.g., "abc123..def456") */
  commitRange?: string;
  /** Archive mode (creates timestamped copy) */
  archive?: boolean;
  /** Dry run mode (don't actually run checks) */
  dryRun?: boolean;
  /** Mock failure type for testing */
  mockFailure?: FailureType;
  /** Path to execution review evidence artifact */
  executionEvidence?: string;
  /** Path to governance evidence artifact */
  governanceEvidence?: string;
  /** Path to build reliability evidence artifact */
  buildReliabilityEvidence?: string;
  /** Path to workspace governance evidence artifact */
  workspaceGovernanceEvidence?: string;
  /** Path to organization governance evidence artifact */
  organizationGovernanceEvidence?: string;
  /** Output directory for governance run history artifacts */
  runsOutput?: string;
  /** Output directory for governance incident artifacts */
  escalationsOutput?: string;
  /** Trigger source for the gate execution */
  trigger?: 'manual' | 'scheduled' | 'ci' | 'unknown';
  /** Execute only these check ids */
  checks?: string[];
  /** Manual trigger actor user id */
  actorUserId?: string;
  /** Manual trigger actor name */
  actorName?: string;
  /** Optional run notes */
  notes?: string;
  /** Source run id when this run is a rerun */
  rerunOfRunId?: string;
  /** Verbose output */
  verbose?: boolean;
  /** Skip specific checks */
  skip?: CheckCategory[];
}

/**
 * Report generation result
 */
export interface ReportGenerationResult {
  /** Path to JSON report */
  jsonPath: string;
  /** Path to Markdown report */
  mdPath: string;
  /** Archived path (if archive mode) */
  archivePath?: string;
  /** Overall status */
  status: 'pass' | 'fail';
}

/**
 * Check definition for running verification steps
 */
export interface CheckDefinition {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category */
  category: CheckCategory;
  /** Command to run (or function) */
  command: string | (() => Promise<CheckResult>);
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to continue on failure */
  continueOnError?: boolean;
}

/**
 * Pattern matchers for failure classification (Epic D2)
 */
export interface FailurePattern {
  /** Category to assign if pattern matches */
  category: FailureType;
  /** Regex patterns to match in error output */
  patterns: RegExp[];
  /** Recommended fix */
  recommendation: string;
}
