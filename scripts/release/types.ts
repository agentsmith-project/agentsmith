import type { ReleasePolicyEvaluation } from '../../src/lib/release-policy';

/**
 * Release Report Type Definitions (Epic D1)
 *
 * Schema for structured release verification reports.
 * Supports JSON output for machine processing and Markdown for human review.
 */

/**
 * Main release report structure
 */
export interface ReleaseReport {
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
  /** Unified release-policy evaluation across execution/runtime/usage signals */
  release_policy?: ReleasePolicyEvaluation;
  /** Failure breakdown by category (present if failed > 0) */
  failure_categories?: FailureCategory[];
  /** Expected upstream transient instability summary (present if detected) */
  upstream_transient?: UpstreamTransientSummary;
  /** Runtime release evidence collected from real-lane runtime workflow */
  runtime_release_evidence?: RuntimeReleaseEvidence;
  /** Usage report release evidence collected from scheduled-report workflow */
  usage_report_evidence?: UsageReportEvidence;
  /** Troubleshooting recommendations (present if failed > 0) */
  recommendations?: string[];
  /** Quick stats for release notes */
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
  | 'quota'      // Quota exceeded
  | 'rate_limit' // Upstream/provider throttling
  | 'permission' // Access control failures
  | 'unknown';   // Unclassified

/**
 * Upstream transient instability summary used by release acceptance
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
  /** Human-readable note for release reviewers */
  note: string;
}

/**
 * Release statistics for quick reference
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

export interface RuntimeReleaseEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when runtime evidence was generated */
  generated_at: string;
  /** Guardrail assessment for the primary release candidate */
  guardrails: RuntimeReleaseGuardrailEvidence;
  /** Request-level pricing version coverage across sampled usage facts */
  pricing_version_coverage: RuntimePricingVersionCoverage;
  /** Published release candidate details captured from runtime control plane */
  release_candidate?: RuntimePublishedRouteCandidate;
  /** Optional note for reviewers when evidence is partial */
  note?: string;
}

export interface RuntimeReleaseGuardrailEvidence {
  /** Route target that was evaluated */
  target: string;
  /** Ready or blocked state reported by the planner */
  release_readiness: 'ready' | 'blocked';
  /** Blocking rollout issues */
  blockers: string[];
  /** Warning-only rollout debt */
  warnings: string[];
  /** Number of planned runtime attempts */
  planned_attempts: number;
}

export interface RuntimePricingVersionCoverage {
  /** Total sampled usage facts included in the coverage calculation */
  total_usage_facts: number;
  /** Usage facts with a non-null pricing_version */
  covered_usage_facts: number;
  /** Usage facts missing pricing_version */
  missing_usage_facts: number;
  /** Usage facts explicitly marked missing_price */
  missing_price_facts: number;
  /** Coverage ratio in [0,1] */
  coverage_ratio: number;
}

export interface RuntimePublishedRouteCandidate {
  /** alias or combo */
  route_type: 'alias' | 'combo';
  /** candidate key */
  route_key: string;
  /** current release state */
  release_status: 'draft' | 'published' | 'archived';
  /** rollout mode */
  rollout_mode?: 'full' | 'canary';
  /** canary percent when applicable */
  canary_percent?: number | null;
  /** all release checklist approvals completed */
  approvals_complete: boolean;
  /** publish timestamp */
  published_at?: string | null;
}

export interface UsageReportEvidence {
  /** Source of the evidence document */
  source: 'dry_run' | 'artifact';
  /** ISO timestamp when usage report evidence was generated */
  generated_at: string;
  /** Release readiness derived from required schedules */
  release_readiness: 'ready' | 'blocked';
  /** Blocking evidence failures */
  blockers: string[];
  /** Warning-only evidence debt */
  warnings: string[];
  /** Active schedules in scope */
  active_schedules: number;
  /** Required schedules in scope */
  required_schedules: number;
  /** Recent successful required deliveries */
  successful_deliveries_last_7d: number;
  /** Recent failed required deliveries */
  failed_deliveries_last_7d: number;
  /** Required deliveries awaiting acknowledgement */
  unacknowledged_required_deliveries: number;
  /** Optional runner health snapshot from the API process */
  runner_health?: {
    enabled: boolean;
    interval_ms: number;
    running: boolean;
    run_count: number;
    last_status: 'idle' | 'success' | 'failed';
    last_started_at?: string;
    last_completed_at?: string;
    last_error?: string;
    last_result?: {
      generated_at: string;
      processed_schedules: number;
      successful_deliveries: number;
      failed_deliveries: number;
    };
  };
  /** Optional reviewer note */
  note?: string;
}

/**
 * CLI options for the verify-release-report script
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
  /** Path to runtime release evidence artifact */
  runtimeEvidence?: string;
  /** Path to usage report evidence artifact */
  usageReportEvidence?: string;
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
