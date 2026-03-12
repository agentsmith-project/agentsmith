#!/usr/bin/env node
/**
 * verify-governance-report.ts
 *
 * Governance Report Automation (Epic D1)
 *
 * Generates structured reports (JSON + Markdown) for governance verification.
 * Captures commit range, environment, execution results, and failure summary.
 *
 * Usage:
 *   node scripts/governance/verify-governance-report.ts [options]
 *
 * Options:
 *   --output <dir>      Output directory (default: ./artifacts/governance-reports)
 *   --name <name>       Report name (default: report-<timestamp>)
 *   --commit-range <range>  Commit range (e.g., abc123..def456)
 *   --archive           Create timestamped archive
 *   --dry-run           Don't actually run checks
 *   --mock-failure <type>  Mock a failure type for testing
 *   --verbose           Verbose output
 *   --help              Show help
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import type {
  GovernanceIncidentEvent,
  GovernanceReport,
  GovernanceRunHistory,
  ReportMetadata,
  ExecutionResults,
  ReportSummary,
  CheckResult,
  CheckCategory,
  FailureType,
  VerifyReleaseOptions,
  FailureCategory,
  ExecutionReviewEvidence,
  GovernanceReviewEvidence,
  BuildReliabilityReviewEvidence,
  WorkspaceGovernanceReviewEvidence,
  OrganizationGovernanceReviewEvidence,
} from './types';
import {
  classifyFailure,
  getQuickRecommendation,
} from './failure-classifier';
import { evaluateGovernance } from '../../packages/api-entry-node/src/governance-evaluation.js';

// Default configuration
const DEFAULT_OUTPUT_DIR = join(process.cwd(), 'artifacts/governance-reports');
const DEFAULT_RUNS_OUTPUT_DIR = join(process.cwd(), 'artifacts/governance-runs');
const DEFAULT_ESCALATIONS_OUTPUT_DIR = join(process.cwd(), 'artifacts/governance-incidents');
const DEFAULT_EXECUTION_EVIDENCE_FILE = 'execution-review-evidence.json';
const DEFAULT_GOVERNANCE_EVIDENCE_FILE = 'governance-evidence.json';
const DEFAULT_BUILD_RELIABILITY_EVIDENCE_FILE = 'build-reliability-evidence.json';
const DEFAULT_WORKSPACE_GOVERNANCE_EVIDENCE_FILE = 'workspace-governance-evidence.json';
const DEFAULT_ORGANIZATION_GOVERNANCE_EVIDENCE_FILE = 'organization-governance-evidence.json';

const TRANSIENT_UPSTREAM_CATEGORIES = new Set<FailureType>(['network', 'timeout', 'rate_limit']);

// Check definitions - map to existing make targets
const CHECK_DEFINITIONS: Array<{
  id: string;
  name: string;
  category: CheckCategory;
  command: string;
  timeout: number;
}> = [
  {
    id: 'typecheck',
    name: 'TypeScript typecheck',
    category: 'typecheck',
    command: 'npm run ws:typecheck',
    timeout: 60000,
  },
  {
    id: 'openapi-check',
    name: 'OpenAPI generated check',
    category: 'contract',
    command: 'npm run openapi:check-generated',
    timeout: 30000,
  },
  {
    id: 'contracts-check',
    name: 'OpenAPI contract checks',
    category: 'contract',
    command: 'npm run contracts:check-openapi',
    timeout: 30000,
  },
  {
    id: 'smoke-main',
    name: 'Mainline engineering smoke',
    category: 'smoke-main',
    command: 'make notebook-agent-engineering-smoke-full',
    timeout: 600000, // 10 minutes
  },
  {
    id: 'organization-governance-evidence',
    name: 'Organization governance workflow',
    category: 'e2e',
    command: 'make organization-governance-smoke',
    timeout: 300000, // 5 minutes
  },
];

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Ensure output directory exists
  if (!existsSync(args.output ?? DEFAULT_OUTPUT_DIR)) {
    mkdirSync(args.output ?? DEFAULT_OUTPUT_DIR, { recursive: true });
  }

  const outputDir = args.output ?? DEFAULT_OUTPUT_DIR;
  const runsOutputDir = args.runsOutput ?? DEFAULT_RUNS_OUTPUT_DIR;
  const escalationsOutputDir = args.escalationsOutput ?? DEFAULT_ESCALATIONS_OUTPUT_DIR;
  const reportName = args.name ?? `report-${getTimestamp()}`;

  if (!existsSync(runsOutputDir)) {
    mkdirSync(runsOutputDir, { recursive: true });
  }
  if (!existsSync(escalationsOutputDir)) {
    mkdirSync(escalationsOutputDir, { recursive: true });
  }

  console.log(`[verify-governance-report] Generating governance report...`);
  console.log(`[verify-governance-report] Output: ${join(outputDir, reportName)}`);

  // Generate report
  const report = await generateGovernanceReport(args);

  // Write JSON report
  const jsonPath = join(outputDir, `${reportName}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[verify-governance-report] JSON: ${jsonPath}`);

  // Write Markdown report
  const mdPath = join(outputDir, `${reportName}.md`);
  writeFileSync(mdPath, generateMarkdown(report), 'utf-8');
  console.log(`[verify-governance-report] Markdown: ${mdPath}`);

  const runHistory = buildGovernanceRunHistory(reportName, report, args);
  const runPath = join(runsOutputDir, `${reportName}.json`);
  writeFileSync(runPath, JSON.stringify(runHistory, null, 2), 'utf-8');
  console.log(`[verify-governance-report] Run: ${runPath}`);

  const escalation = await buildGovernanceIncidentEvent(reportName, report, runHistory);
  const escalationPath = join(escalationsOutputDir, `${reportName}.json`);
  writeFileSync(escalationPath, JSON.stringify(escalation, null, 2), 'utf-8');
  console.log(`[verify-governance-report] Escalation: ${escalationPath}`);

  // Archive if requested
  let archivePath: string | undefined;
  if (args.archive) {
    const archiveName = `report-${getTimestamp()}`;
    const archiveJsonPath = join(outputDir, `${archiveName}.json`);
    const archiveMdPath = join(outputDir, `${archiveName}.md`);
    writeFileSync(archiveJsonPath, JSON.stringify(report, null, 2), 'utf-8');
    writeFileSync(archiveMdPath, generateMarkdown(report), 'utf-8');
    archivePath = archiveJsonPath;
    console.log(`[verify-governance-report] Archive: ${archivePath}`);
  }

  // Exit with appropriate code
  const exitCode = report.summary.status === 'pass' ? 0 : 1;
  console.log(`[verify-governance-report] Status: ${report.summary.status.toUpperCase()}`);

  process.exit(exitCode);
}

/**
 * Parse command line arguments
 */
function parseArgs(argv: string[]): VerifyReleaseOptions {
  const options: VerifyReleaseOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--output':
        options.output = argv[++i];
        break;
      case '--name':
        options.name = argv[++i];
        break;
      case '--commit-range':
        options.commitRange = argv[++i];
        break;
      case '--archive':
        options.archive = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--mock-failure':
        options.mockFailure = argv[++i] as FailureType;
        break;
      case '--execution-evidence':
        options.executionEvidence = argv[++i];
        break;
      case '--governance-evidence':
        options.governanceEvidence = argv[++i];
        break;
      case '--build-reliability-evidence':
        options.buildReliabilityEvidence = argv[++i];
        break;
      case '--workspace-governance-evidence':
        options.workspaceGovernanceEvidence = argv[++i];
        break;
      case '--organization-governance-evidence':
        options.organizationGovernanceEvidence = argv[++i];
        break;
      case '--runs-output':
        options.runsOutput = argv[++i];
        break;
      case '--trigger':
        if (argv[i + 1] === 'manual' || argv[i + 1] === 'scheduled' || argv[i + 1] === 'ci' || argv[i + 1] === 'unknown') {
          options.trigger = argv[++i] as VerifyReleaseOptions['trigger'];
        }
        break;
      case '--checks':
        options.checks = (argv[++i] ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case '--actor-user-id':
        options.actorUserId = argv[++i];
        break;
      case '--actor-name':
        options.actorName = argv[++i];
        break;
      case '--notes':
        options.notes = argv[++i];
        break;
      case '--rerun-of-run-id':
        options.rerunOfRunId = argv[++i];
        break;
      case '--escalations-output':
        options.escalationsOutput = argv[++i];
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        // Unknown flag - ignore or could error
        break;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
verify-governance-report - Governance Verification Report Generator

USAGE:
  node scripts/governance/verify-governance-report.ts [options]

OPTIONS:
  --output <dir>       Output directory (default: ./artifacts/governance-reports)
  --name <name>        Report name (default: report-<timestamp>)
  --commit-range <r>   Commit range (e.g., abc123..def456)
  --archive            Create timestamped archive copy
  --dry-run            Skip actual check execution (for testing)
  --mock-failure <t>   Mock a failure type: token|network|backend|assertion|timeout|rate_limit
  --execution-evidence <path>  Read execution review evidence artifact from custom path
  --governance-evidence <path>  Read governance evidence artifact from custom path
  --build-reliability-evidence <path>  Read build reliability evidence artifact from custom path
  --workspace-governance-evidence <path>  Read workspace governance evidence artifact from custom path
  --organization-governance-evidence <path>  Read organization governance evidence artifact from custom path
  --runs-output <dir>  Output directory for governance run history artifacts
  --escalations-output <dir>  Output directory for governance incident artifacts
  --trigger <source>   Trigger source: manual|scheduled|ci|unknown
  --checks <ids>       Comma-separated check ids to execute
  --actor-user-id <id> Manual trigger actor user id
  --actor-name <name>  Manual trigger actor display name
  --notes <text>       Optional run notes
  --rerun-of-run-id <id>  Source run id when rerunning failed checks
  --verbose            Show detailed output
  --help, -h           Show this help

EXAMPLES:
  # Generate governance report after verify-governance
  make verify-governance
  node scripts/governance/verify-governance-report.ts --archive

  # Generate with custom name and commit range
  node scripts/governance/verify-governance-report.ts \\
    --name v1.2.3 \\
    --commit-range v1.2.2..v1.2.3 \\
    --archive

  # Dry run to test report generation
  node scripts/governance/verify-governance-report.ts --dry-run
`);
}

/**
 * Generate the complete governance report
 */
async function generateGovernanceReport(options: VerifyReleaseOptions): Promise<GovernanceReport> {
  const startTime = Date.now();

  // Gather metadata
  const metadata = await gatherMetadata(options);

  // Run checks (or mock them)
  const execution = await runChecks(options);

  // Generate summary
  const summary = generateSummary(execution, options);

  const duration = Date.now() - startTime;

  return {
    metadata: { ...metadata, duration_ms: duration },
    execution,
    summary,
  };
}

function collectGovernanceIssues(summary: ReportSummary): {
  blockers: Array<{ source: 'governance' | 'workspace_governance' | 'organization_governance'; message: string }>;
  warnings: Array<{ source: 'governance' | 'workspace_governance' | 'organization_governance'; message: string }>;
} {
  return {
    blockers: [
      ...(summary.governance_evidence?.blockers ?? []).map((message) => ({ source: 'governance' as const, message })),
      ...(summary.workspace_governance_evidence?.blockers ?? []).map((message) => ({ source: 'workspace_governance' as const, message })),
      ...(summary.organization_governance_evidence?.blockers ?? []).map((message) => ({ source: 'organization_governance' as const, message })),
    ],
    warnings: [
      ...(summary.governance_evidence?.warnings ?? []).map((message) => ({ source: 'governance' as const, message })),
      ...(summary.workspace_governance_evidence?.warnings ?? []).map((message) => ({ source: 'workspace_governance' as const, message })),
      ...(summary.organization_governance_evidence?.warnings ?? []).map((message) => ({ source: 'organization_governance' as const, message })),
    ],
  };
}

function buildGovernanceRunHistory(
  reportName: string,
  report: GovernanceReport,
  options: VerifyReleaseOptions,
): GovernanceRunHistory {
  const failedChecks = report.execution.checks.filter((check) => check.status === 'fail');
  const firstFailedCheck = failedChecks[0];
  const failureCategories = Array.from(new Set((report.summary.failure_categories ?? []).map((category) => category.category)));
  const incidentId = options.rerunOfRunId ? `incident-${options.rerunOfRunId}` : `incident-${reportName}`;
  const governanceSignals = collectGovernanceIssues(report.summary);
  return {
    id: reportName,
    incident_id: incidentId,
    report_name: reportName,
    artifact_name: reportName,
    trigger: options.trigger ?? getTriggerSource(),
    started_at: report.metadata.timestamp,
    completed_at: new Date(new Date(report.metadata.timestamp).getTime() + report.metadata.duration_ms).toISOString(),
    duration_ms: report.metadata.duration_ms,
    status: report.summary.status,
    branch: report.metadata.git.branch,
    commit_short: report.metadata.git.commit_short,
    governance_policy_decision: report.summary.governance_policy?.decision,
    execution_review_status: report.summary.execution_review_evidence?.checks.review_status,
    governance_blockers: governanceSignals.blockers,
    governance_warnings: governanceSignals.warnings,
    total_checks: report.execution.total_checks,
    passed_checks: report.execution.passed,
    failed_checks: report.execution.failed,
    failed_step_name: firstFailedCheck?.name,
    failed_step_category: firstFailedCheck?.category,
    failed_step_names: failedChecks.map((check) => check.name),
    failed_check_ids: failedChecks.map((check) => check.id).filter((value): value is string => Boolean(value)),
    failure_categories: failureCategories,
    requested_check_ids: options.checks,
    rerun_of_run_id: options.rerunOfRunId,
    notes: options.notes,
    actor_user_id: options.actorUserId,
    actor_name: options.actorName,
  };
}

async function buildGovernanceIncidentEvent(
  reportName: string,
  report: GovernanceReport,
  run: GovernanceRunHistory,
): Promise<GovernanceIncidentEvent> {
  const decision = report.summary.governance_policy?.decision ?? 'blocked';
  const status = decision === 'ready' ? 'resolved' : 'open';
  const eventType = decision === 'blocked'
    ? 'gate_blocked'
    : decision === 'warning'
      ? 'gate_warning'
      : 'gate_ready';
  const severity = decision === 'blocked'
    ? 'critical'
    : decision === 'warning'
      ? 'warning'
      : 'info';
  const governanceSignals = collectGovernanceIssues(report.summary);
  const event: GovernanceIncidentEvent = {
    id: reportName,
    incident_id: run.incident_id,
    report_name: reportName,
    run_id: run.id,
    created_at: run.completed_at,
    event_type: eventType,
    severity,
    status,
    title: decision === 'ready'
      ? 'Governance run recovered to ready state'
      : decision === 'warning'
        ? 'Governance run completed with warning state'
        : 'Governance run blocked',
    body: decision === 'ready'
      ? 'Latest governance run completed successfully and no blocking policy issues remain.'
      : decision === 'warning'
        ? `Latest governance run completed with ${report.summary.governance_policy?.summary.warning_count ?? 0} warning issues.`
        : `Latest governance run is blocked by ${report.summary.governance_policy?.summary.blocker_count ?? 0} issues.`,
    artifact_name: reportName,
    trigger: run.trigger,
    governance_policy_decision: decision,
    execution_review_status: report.summary.execution_review_evidence?.checks.review_status,
    governance_blockers: governanceSignals.blockers,
    governance_warnings: governanceSignals.warnings,
    failed_step_name: run.failed_step_name,
    failure_categories: run.failure_categories,
  };
  event.webhook_delivery = await deliverReleaseEscalationWebhook(event);
  return event;
}

async function deliverReleaseEscalationWebhook(
  event: GovernanceIncidentEvent,
): Promise<GovernanceIncidentEvent['webhook_delivery']> {
  const webhookUrl = process.env.RELEASE_ESCALATION_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { status: 'skipped' };
  }

  const startedAt = Date.now();
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-agentsmith-governance-event-type': event.event_type,
    'x-agentsmith-governance-event-id': event.id,
  };
  const secret = process.env.RELEASE_ESCALATION_WEBHOOK_SECRET?.trim();
  const secretHeader = process.env.RELEASE_ESCALATION_WEBHOOK_SECRET_HEADER?.trim();
  const signatureHeader = process.env.RELEASE_ESCALATION_WEBHOOK_SIGNATURE_HEADER?.trim();
  if (secret && secretHeader) {
    headers[secretHeader] = secret;
  }
  if (secret && signatureHeader) {
    const timestamp = new Date().toISOString();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    headers[signatureHeader] = `sha256=${signature}`;
    headers['x-agentsmith-signature-timestamp'] = timestamp;
  }
  const timeoutSeconds = Math.max(1, Math.min(60, Number.parseInt(process.env.RELEASE_ESCALATION_WEBHOOK_TIMEOUT_SECONDS ?? '10', 10) || 10));
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: abortController.signal,
    });
    clearTimeout(timer);
    return {
      status: response.ok ? 'success' : 'failed',
      attempted_at: new Date().toISOString(),
      response_status: response.status,
      duration_ms: Date.now() - startedAt,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      status: 'failed',
      attempted_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'governance_incident_webhook_failed',
    };
  }
}

function getTriggerSource(): 'manual' | 'scheduled' | 'ci' | 'unknown' {
  const envTrigger = process.env.RELEASE_TRIGGER_SOURCE;
  if (envTrigger === 'manual' || envTrigger === 'scheduled' || envTrigger === 'ci' || envTrigger === 'unknown') {
    return envTrigger;
  }
  if (process.env.CI) return 'ci';
  return 'manual';
}

/**
 * Gather report metadata
 */
async function gatherMetadata(options: VerifyReleaseOptions): Promise<ReportMetadata> {
  const timestamp = new Date().toISOString();

  // Environment info
  const environment = {
    node_version: process.version,
    npm_version: getNpmVersion(),
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
  };

  // Git info
  const git = getGitInfo(options.commitRange);

  return {
    timestamp,
    duration_ms: 0, // Will be updated by caller
    environment,
    git,
  };
}

/**
 * Get npm version
 */
function getNpmVersion(): string | undefined {
  try {
    return execSync('npm --version', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Get git information
 */
function getGitInfo(commitRange?: string): ReportMetadata['git'] {
  try {
    const hash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const short = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const message = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim();
    const author = execSync('git log -1 --pretty=%an', { encoding: 'utf-8' }).trim();
    const date = execSync('git log -1 --pretty=%cI', { encoding: 'utf-8' }).trim();

    // Check if we're on a tag
    let tag: string | undefined;
    try {
      tag = execSync('git describe --exact-match --tags 2>/dev/null', { encoding: 'utf-8' }).trim() || undefined;
    } catch {
      tag = undefined;
    }

    return {
      commit_hash: hash,
      commit_short: short,
      branch,
      commit_range: commitRange,
      commit_message: message,
      author,
      date,
      tag,
    };
  } catch {
    // Fallback if git commands fail
    return {
      commit_hash: 'unknown',
      commit_short: 'unknown',
      branch: 'unknown',
      commit_message: 'Could not retrieve git info',
      author: 'unknown',
      date: new Date().toISOString(),
    };
  }
}

/**
 * Run all verification checks
 */
async function runChecks(options: VerifyReleaseOptions): Promise<ExecutionResults> {
  const checks: CheckResult[] = [];

  // Reset failure flag for deterministic mock behavior
  if (options.mockFailure || options.dryRun) {
    hasGeneratedFailure = false;
  }

  for (const def of CHECK_DEFINITIONS) {
    if (options.checks && options.checks.length > 0 && !options.checks.includes(def.id)) {
      checks.push({
        id: def.id,
        name: def.name,
        category: def.category,
        status: 'skip',
        duration_ms: 0,
      });
      continue;
    }
    // Skip if in skip list
    if (options.skip?.includes(def.category)) {
      checks.push({
        id: def.id,
        name: def.name,
        category: def.category,
        status: 'skip',
        duration_ms: 0,
      });
      continue;
    }

    // Dry run or mock mode
    if (options.dryRun || options.mockFailure) {
      const mockResult = mockCheckResult(def, options.mockFailure);
      checks.push(mockResult);
      continue;
    }

    // Real execution
    const result = runCheck(def, options);
    checks.push(result);
  }

  // Calculate totals
  const total = checks.length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const skipped = checks.filter((c) => c.status === 'skip').length;

  return {
    total_checks: total,
    passed,
    failed,
    skipped,
    checks,
  };
}

/**
 * Run a single check
 */
function runCheck(
  def: { id: string; name: string; category: CheckCategory; command: string; timeout: number },
  options: VerifyReleaseOptions,
): CheckResult {
  const startTime = Date.now();
  const command = buildCommand(def, options);

  try {
    execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: def.timeout,
    });

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      status: 'pass',
      duration_ms: Date.now() - startTime,
      command,
    };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      status: 'fail',
      duration_ms: Date.now() - startTime,
      command,
      output: err.stdout?.toString(),
      error: err.stderr?.toString() || err.message,
      exit_code: err.status || 1,
    };
  }
}

/**
 * Mock error messages for testing failure classification
 */
const MOCK_ERROR_MESSAGES: Record<FailureType, string[]> = {
  token: [
    'Authentication failed: invalid token',
    '401 Unauthorized - JWT expired',
    'Keycloak auth error: access denied',
  ],
  network: [
    'ECONNREFUSED: Connection refused',
    'ETIMEDOUT: Request timeout after 30000ms',
    'getaddrinfo ENOTFOUND api.example.com',
  ],
  backend: [
    '500 Internal Server Error',
    'Database connection error: PostgreSQL',
    'API backend error: unhandled exception',
  ],
  assertion: [
    'AssertionError: expected true to be false',
    'Test failed: expected status 200 but got 201',
    'expect(received).toBe(expected) // Object types mismatch',
  ],
  timeout: [
    'task t_123 did not reach terminal trace within timeout',
    'Operation timed out after 60000ms',
    'timeout 45000ms exceeded while waiting for response',
  ],
  authorization: [
    'permission denied by policy: subject not in allow list',
  ],
  spending_limit: [
    'limit exceeded: daily limit exhausted',
  ],
  rate_limit: [
    '429 Too Many Requests: retry later',
    'provider reply failed due to retry limit',
  ],
  permission: [
    'access denied: insufficient permissions',
  ],
  unknown: [
    'Unknown error occurred',
  ],
};

/**
 * Track if we've generated at least one failure for deterministic testing
 */
let hasGeneratedFailure = false;

/**
 * Generate mock check result for testing/dry-run
 */
function mockCheckResult(
  def: { id: string; name: string; category: CheckCategory },
  mockFailure?: FailureType
): CheckResult {
  const duration = Math.floor(Math.random() * 5000) + 1000;

  // If mocking a failure, determine if this check should fail
  if (mockFailure) {
    // Ensure first check always fails for deterministic testing
    // Then randomly fail about 40% of remaining checks
    const shouldFail = !hasGeneratedFailure || Math.random() > 0.6;

    if (shouldFail) {
      hasGeneratedFailure = true;
      // Get a realistic error message for the category
      const errorMessages = MOCK_ERROR_MESSAGES[mockFailure] || MOCK_ERROR_MESSAGES.unknown;
      const errorMessage = errorMessages[Math.floor(Math.random() * errorMessages.length)];

      return {
        name: def.name,
        category: def.category,
        status: 'fail',
        duration_ms: duration,
        command: def.command || `mock ${def.id}`,
        error: errorMessage,
      };
    }
  }

  return {
    name: def.name,
    category: def.category,
    status: 'pass',
    duration_ms: duration,
    command: def.command || `mock ${def.id}`,
  };
}

function buildCommand(
  def: { id: string; command: string },
  options: VerifyReleaseOptions,
): string {
  if (def.id === 'smoke-governance') {
    const governanceEvidencePath = getGovernanceEvidencePath(options);
    return `GOVERNANCE_EVIDENCE_PATH=${shellQuote(governanceEvidencePath)} ${def.command}`;
  }
  if (def.id === 'build-reliability-evidence') {
    const buildReliabilityEvidencePath = getBuildReliabilityEvidencePath(options);
    return `BUILD_RELIABILITY_EVIDENCE_PATH=${shellQuote(buildReliabilityEvidencePath)} ${def.command}`;
  }
  if (def.id === 'workspace-governance-evidence') {
    const workspaceGovernanceEvidencePath = getWorkspaceGovernanceEvidencePath(options);
    return `WORKSPACE_GOVERNANCE_EVIDENCE_PATH=${shellQuote(workspaceGovernanceEvidencePath)} ${def.command}`;
  }
  if (def.id === 'organization-governance-evidence') {
    const organizationGovernanceEvidencePath = getOrganizationGovernanceEvidencePath(options);
    return `ORGANIZATION_GOVERNANCE_EVIDENCE_PATH=${shellQuote(organizationGovernanceEvidencePath)} ${def.command}`;
  }
  if (def.id !== 'execution-review-evidence') return def.command;

  const executionEvidencePath = getExecutionEvidencePath(options);
  return `EXECUTION_REVIEW_EVIDENCE_PATH=${shellQuote(executionEvidencePath)} ${def.command}`;
}

/**
 * Generate report summary
 */
function generateSummary(execution: ExecutionResults, options: VerifyReleaseOptions): ReportSummary {
  const executionEvidence = loadExecutionReviewEvidence(options);
  const governanceEvidence = loadGovernanceReviewEvidence(options);
  const buildReliabilityEvidence = loadBuildReliabilityReviewEvidence(options);
  const workspaceGovernanceEvidence = loadWorkspaceGovernanceReviewEvidence(options);
  const organizationGovernanceEvidence = loadOrganizationGovernanceReviewEvidence(options);
  const executionBlockingReasons = getExecutionReviewBlockingReasons(executionEvidence);
  const governanceBlockingReasons = getGovernanceReviewEvidenceBlockingReasons(governanceEvidence);
  const buildReliabilityBlockingReasons = getBuildReliabilityEvidenceBlockingReasons(buildReliabilityEvidence);
  const workspaceGovernanceBlockingReasons = getWorkspaceGovernanceEvidenceBlockingReasons(workspaceGovernanceEvidence);
  const organizationGovernanceBlockingReasons = getOrganizationGovernanceEvidenceBlockingReasons(organizationGovernanceEvidence);
  const status = execution.failed === 0
    && executionBlockingReasons.length === 0
    && governanceBlockingReasons.length === 0
    && buildReliabilityBlockingReasons.length === 0
    && workspaceGovernanceBlockingReasons.length === 0
    && organizationGovernanceBlockingReasons.length === 0
    ? 'pass'
    : 'fail';

  const summary: ReportSummary = {
    status,
    stats: calculateStats(execution),
  };

  if (executionEvidence) {
    summary.execution_review_evidence = executionEvidence;
  }
  if (governanceEvidence) {
    summary.governance_evidence = governanceEvidence;
  }
  if (buildReliabilityEvidence) {
    summary.build_reliability_evidence = buildReliabilityEvidence;
  }
  if (workspaceGovernanceEvidence) {
    summary.workspace_governance_evidence = workspaceGovernanceEvidence;
  }
  if (organizationGovernanceEvidence) {
    summary.organization_governance_evidence = organizationGovernanceEvidence;
  }

  // Add failure categories if there are failures
  if (execution.failed > 0) {
    summary.failure_categories = classifyFailures(execution);
    summary.upstream_transient = summarizeUpstreamTransient(summary.failure_categories);
    summary.recommendations = generateRecommendations(summary.failure_categories);
  }

  summary.governance_policy = evaluateGovernance({
    execution: {
      failed_count: execution.failed,
      transient_acceptance: summary.upstream_transient?.acceptance,
      failure_categories: summary.failure_categories?.map((category) => category.category),
    },
    configuration: executionEvidence ? {
      review_status: executionEvidence.checks.review_status,
      blockers: executionEvidence.checks.blockers,
      warnings: executionEvidence.checks.warnings,
      missing_usage_facts: executionEvidence.pricing_source_coverage.missing_usage_facts,
      missing_price_facts: executionEvidence.pricing_source_coverage.missing_price_facts,
      target: executionEvidence.target ? {
        status: executionEvidence.target.status,
        approvals_complete: executionEvidence.target.approvals_complete,
      } : undefined,
    } : undefined,
    governance: governanceEvidence || workspaceGovernanceEvidence ? {
      review_status:
        governanceEvidence?.review_status === 'blocked'
        || workspaceGovernanceEvidence?.review_status === 'blocked'
          ? 'blocked'
          : 'ready',
      blockers: [
        ...(governanceEvidence?.blockers ?? []),
        ...(workspaceGovernanceEvidence?.blockers ?? []),
      ],
      warnings: [
        ...(governanceEvidence?.warnings ?? []),
        ...(workspaceGovernanceEvidence?.warnings ?? []),
      ],
    } : undefined,
    organization: organizationGovernanceEvidence ? {
      review_status: organizationGovernanceEvidence.review_status,
      blockers: organizationGovernanceEvidence.blockers.map((id) => ({
        id,
        message: id,
        severity: 'blocker' as const,
        source: 'organization_governance' as const,
        overridable: false,
      })),
      warnings: organizationGovernanceEvidence.warnings.map((id) => ({
        id,
        message: id,
        severity: 'warning' as const,
        source: 'organization_governance' as const,
        overridable: false,
      })),
    } : undefined,
    build: buildReliabilityEvidence ? {
      review_status: buildReliabilityEvidence.review_status,
      blockers: buildReliabilityEvidence.blockers,
      warnings: buildReliabilityEvidence.warnings,
    } : undefined,
  });

  if (executionBlockingReasons.length > 0) {
    const executionRecommendations = executionBlockingReasons.map((reason) => `Execution review blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...executionRecommendations];
  }
  if (governanceBlockingReasons.length > 0) {
    const governanceRecommendations = governanceBlockingReasons.map((reason) => `Governance blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...governanceRecommendations];
  }
  if (buildReliabilityBlockingReasons.length > 0) {
    const buildRecommendations = buildReliabilityBlockingReasons.map((reason) => `Build reliability blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...buildRecommendations];
  }
  if (workspaceGovernanceBlockingReasons.length > 0) {
    const workspaceRecommendations = workspaceGovernanceBlockingReasons.map((reason) => `Workspace governance blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...workspaceRecommendations];
  }
  if (organizationGovernanceBlockingReasons.length > 0) {
    const organizationRecommendations = organizationGovernanceBlockingReasons.map((reason) => `Organization governance blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...organizationRecommendations];
  }
  if (summary.governance_policy) {
    const policyRecommendations = summary.governance_policy.blockers.map((issue) => `Governance policy blocker: ${issue.message}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...policyRecommendations];
  }

  return summary;
}

function getExecutionEvidencePath(options: VerifyReleaseOptions): string {
  if (options.executionEvidence) return options.executionEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_EXECUTION_EVIDENCE_FILE);
}

function getGovernanceEvidencePath(options: VerifyReleaseOptions): string {
  if (options.governanceEvidence) return options.governanceEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_GOVERNANCE_EVIDENCE_FILE);
}

function getBuildReliabilityEvidencePath(options: VerifyReleaseOptions): string {
  if (options.buildReliabilityEvidence) return options.buildReliabilityEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_BUILD_RELIABILITY_EVIDENCE_FILE);
}

function getWorkspaceGovernanceEvidencePath(options: VerifyReleaseOptions): string {
  if (options.workspaceGovernanceEvidence) return options.workspaceGovernanceEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_WORKSPACE_GOVERNANCE_EVIDENCE_FILE);
}

function getOrganizationGovernanceEvidencePath(options: VerifyReleaseOptions): string {
  if (options.organizationGovernanceEvidence) return options.organizationGovernanceEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_ORGANIZATION_GOVERNANCE_EVIDENCE_FILE);
}

function loadExecutionReviewEvidence(options: VerifyReleaseOptions): ExecutionReviewEvidence | undefined {
  const evidencePath = getExecutionEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      const parsed = JSON.parse(readFileSync(evidencePath, 'utf-8')) as ExecutionReviewEvidence;
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        checks: {
          target: 'unknown',
          review_status: 'blocked',
          blockers: ['execution_review_evidence_unreadable'],
          warnings: [],
          planned_attempts: 0,
        },
        pricing_source_coverage: {
          total_usage_facts: 0,
          covered_usage_facts: 0,
          missing_usage_facts: 0,
          missing_price_facts: 0,
          coverage_ratio: 0,
        },
        note: `Failed to parse execution review evidence: ${message}`,
      };
    }
  }

  if (options.dryRun) {
    return createMockExecutionReviewEvidence();
  }

  return undefined;
}

function createMockExecutionReviewEvidence(): ExecutionReviewEvidence {
  return {
    source: 'dry_run',
    generated_at: new Date().toISOString(),
    checks: {
      target: 'openai/gpt-4o',
      review_status: 'ready',
      blockers: [],
      warnings: ['configuration_check_reroute_connection_unavailable'],
      planned_attempts: 2,
    },
    pricing_source_coverage: {
      total_usage_facts: 4,
      covered_usage_facts: 4,
      missing_usage_facts: 0,
      missing_price_facts: 0,
      coverage_ratio: 1,
    },
    target: {
      target_type: 'model',
      target_id: 'openai/gpt-4o',
      status: 'active',
      change_mode: 'full',
      change_percent: null,
      approvals_complete: true,
      activated_at: new Date().toISOString(),
    },
    note: 'Dry-run evidence uses deterministic fixture data and does not call live execution services.',
  };
}

function loadGovernanceReviewEvidence(options: VerifyReleaseOptions): GovernanceReviewEvidence | undefined {
  const evidencePath = getGovernanceEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      return JSON.parse(readFileSync(evidencePath, 'utf-8')) as GovernanceReviewEvidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        review_status: 'blocked',
        blockers: ['governance_evidence_unreadable'],
        warnings: [],
        checks: {
          page_smoke: false,
          interaction_smoke: false,
          endpoint_policy_effects: false,
          member_permission_effect: false,
          member_lifecycle_effect: false,
          sse_ticket_hardening: false,
        },
        note: `Failed to parse governance evidence: ${message}`,
      };
    }
  }

  if (options.dryRun) {
    return {
      source: 'dry_run',
      generated_at: new Date().toISOString(),
      review_status: 'ready',
      blockers: [],
      warnings: [],
      checks: {
        page_smoke: true,
        interaction_smoke: true,
        endpoint_policy_effects: true,
        member_permission_effect: true,
        member_lifecycle_effect: true,
        sse_ticket_hardening: true,
      },
      note: 'Dry-run evidence uses deterministic fixture data and does not call live governance effect smoke lanes.',
    };
  }

  return undefined;
}

function loadBuildReliabilityReviewEvidence(options: VerifyReleaseOptions): BuildReliabilityReviewEvidence | undefined {
  const evidencePath = getBuildReliabilityEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      return JSON.parse(readFileSync(evidencePath, 'utf-8')) as BuildReliabilityReviewEvidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        review_status: 'blocked',
        blockers: ['build_reliability_evidence_unreadable'],
        warnings: [],
        checks: {
          realtime_session_resilience: false,
          notebook_trace_fidelity: false,
          build_failure_explainability: false,
          cross_surface_diagnostics: false,
          chat_recovery_integration: false,
          notebook_external_execution: false,
        },
        note: `Failed to parse build reliability evidence: ${message}`,
      };
    }
  }

  if (options.dryRun) {
    return {
      source: 'dry_run',
      generated_at: new Date().toISOString(),
      review_status: 'ready',
      blockers: [],
      warnings: [],
      checks: {
        realtime_session_resilience: true,
        notebook_trace_fidelity: true,
        build_failure_explainability: true,
        cross_surface_diagnostics: true,
        chat_recovery_integration: true,
        notebook_external_execution: true,
      },
      note: 'Dry-run evidence uses deterministic fixture data and does not call live build reliability lanes.',
    };
  }

  return undefined;
}

function loadWorkspaceGovernanceReviewEvidence(options: VerifyReleaseOptions): WorkspaceGovernanceReviewEvidence | undefined {
  const evidencePath = getWorkspaceGovernanceEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      return JSON.parse(readFileSync(evidencePath, 'utf-8')) as WorkspaceGovernanceReviewEvidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        review_status: 'blocked',
        blockers: ['workspace_governance_evidence_unreadable'],
        warnings: [],
        checks: {
          workspace_overview: false,
          workspace_member_administration: false,
          cross_project_actions: false,
          workspace_explainability: false,
          workspace_attention_drilldown: false,
        },
        note: `Failed to parse workspace governance evidence: ${message}`,
      };
    }
  }

  if (options.dryRun) {
    return {
      source: 'dry_run',
      generated_at: new Date().toISOString(),
      review_status: 'ready',
      blockers: [],
      warnings: [],
      checks: {
        workspace_overview: true,
        workspace_member_administration: true,
        cross_project_actions: true,
        workspace_explainability: true,
        workspace_attention_drilldown: true,
      },
      note: 'Dry-run evidence uses deterministic fixture data and does not call live workspace governance smoke lanes.',
    };
  }

  return undefined;
}

function loadOrganizationGovernanceReviewEvidence(options: VerifyReleaseOptions): OrganizationGovernanceReviewEvidence | undefined {
  const evidencePath = getOrganizationGovernanceEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      return JSON.parse(readFileSync(evidencePath, 'utf-8')) as OrganizationGovernanceReviewEvidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        review_status: 'blocked',
        blockers: ['organization_governance_evidence_unreadable'],
        warnings: [],
        checks: {
          org_overview_summary: false,
          workspace_matrix: false,
          actions_queue_execution: false,
          evidence_drilldown_chain: false,
        },
        note: `Failed to parse organization governance evidence: ${message}`,
      };
    }
  }

  if (options.dryRun) {
    return {
      source: 'dry_run',
      generated_at: new Date().toISOString(),
      review_status: 'ready',
      blockers: [],
      warnings: [],
      checks: {
        org_overview_summary: true,
        workspace_matrix: true,
        actions_queue_execution: true,
        evidence_drilldown_chain: true,
      },
      note: 'Dry-run evidence uses deterministic fixture data and does not call live organization governance smoke lanes.',
    };
  }

  return undefined;
}

function getExecutionReviewBlockingReasons(executionEvidence?: ExecutionReviewEvidence): string[] {
  if (!executionEvidence) return [];

  const reasons: string[] = [];
  if (executionEvidence.checks.review_status === 'blocked') {
    reasons.push(
      executionEvidence.checks.blockers.length > 0
        ? `checks blocked by ${executionEvidence.checks.blockers.join(', ')}`
        : 'checks reported blocked review status',
    );
  }
  if (executionEvidence.pricing_source_coverage.missing_usage_facts > 0) {
    reasons.push(
      `pricing source coverage incomplete (${executionEvidence.pricing_source_coverage.covered_usage_facts}/${executionEvidence.pricing_source_coverage.total_usage_facts})`,
    );
  }
  if (executionEvidence.pricing_source_coverage.missing_price_facts > 0) {
    reasons.push(`execution missing_price facts detected (${executionEvidence.pricing_source_coverage.missing_price_facts})`);
  }
  if (!executionEvidence.target) {
    reasons.push('execution target details missing');
    return reasons;
  }
  if (executionEvidence.target.status !== 'active') {
    reasons.push(`execution target is not active (${executionEvidence.target.status})`);
  }
  if (!executionEvidence.target.approvals_complete) {
    reasons.push('execution target approvals are incomplete');
  }
  return reasons;
}

function getGovernanceReviewEvidenceBlockingReasons(governanceEvidence?: GovernanceReviewEvidence): string[] {
  if (!governanceEvidence) return [];

  const reasons: string[] = [];
  if (governanceEvidence.review_status === 'blocked') {
    reasons.push(
      governanceEvidence.blockers.length > 0
        ? `governance evidence blocked by ${governanceEvidence.blockers.join(', ')}`
        : 'governance evidence reported blocked review status',
    );
  }
  const missingChecks = Object.entries(governanceEvidence.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (missingChecks.length > 0) {
    reasons.push(`governance evidence missing checks: ${missingChecks.join(', ')}`);
  }
  return reasons;
}

function getBuildReliabilityEvidenceBlockingReasons(buildEvidence?: BuildReliabilityReviewEvidence): string[] {
  if (!buildEvidence) return [];

  const reasons: string[] = [];
  if (buildEvidence.review_status === 'blocked') {
    reasons.push(
      buildEvidence.blockers.length > 0
        ? `build reliability evidence blocked by ${buildEvidence.blockers.join(', ')}`
        : 'build reliability evidence reported blocked review status',
    );
  }
  const missingChecks = Object.entries(buildEvidence.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (missingChecks.length > 0) {
    reasons.push(`build reliability evidence missing checks: ${missingChecks.join(', ')}`);
  }
  return reasons;
}

function getWorkspaceGovernanceEvidenceBlockingReasons(workspaceEvidence?: WorkspaceGovernanceReviewEvidence): string[] {
  if (!workspaceEvidence) return [];

  const reasons: string[] = [];
  if (workspaceEvidence.review_status === 'blocked') {
    reasons.push(
      workspaceEvidence.blockers.length > 0
        ? `workspace governance evidence blocked by ${workspaceEvidence.blockers.join(', ')}`
        : 'workspace governance evidence reported blocked review status',
    );
  }
  const missingChecks = Object.entries(workspaceEvidence.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (missingChecks.length > 0) {
    reasons.push(`workspace governance evidence missing checks: ${missingChecks.join(', ')}`);
  }
  return reasons;
}

function getOrganizationGovernanceEvidenceBlockingReasons(orgEvidence?: OrganizationGovernanceReviewEvidence): string[] {
  if (!orgEvidence) return [];

  const reasons: string[] = [];
  if (orgEvidence.review_status === 'blocked') {
    reasons.push(
      orgEvidence.blockers.length > 0
        ? `organization governance evidence blocked by ${orgEvidence.blockers.join(', ')}`
        : 'organization governance evidence reported blocked review status',
    );
  }
  const missingChecks = Object.entries(orgEvidence.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (missingChecks.length > 0) {
    reasons.push(`organization governance evidence missing checks: ${missingChecks.join(', ')}`);
  }
  return reasons;
}

/**
 * Calculate statistics from execution results
 */
function calculateStats(execution: ExecutionResults) {
  const completedChecks = execution.checks.filter((c) => c.status !== 'skip');
  const byCategory: Record<string, { total: number; passed: number; failed: number }> = {};

  for (const check of execution.checks) {
    if (!byCategory[check.category]) {
      byCategory[check.category] = { total: 0, passed: 0, failed: 0 };
    }
    byCategory[check.category].total++;
    if (check.status === 'pass') byCategory[check.category].passed++;
    if (check.status === 'fail') byCategory[check.category].failed++;
  }

  const sortedByDuration = [...completedChecks].sort((a, b) => a.duration_ms - b.duration_ms);

  return {
    total_duration_ms: execution.checks.reduce((sum, c) => sum + c.duration_ms, 0),
    fastest_check: sortedByDuration[0]
      ? { name: sortedByDuration[0].name, duration_ms: sortedByDuration[0].duration_ms }
      : { name: 'N/A', duration_ms: 0 },
    slowest_check: sortedByDuration[sortedByDuration.length - 1]
      ? { name: sortedByDuration[sortedByDuration.length - 1].name, duration_ms: sortedByDuration[sortedByDuration.length - 1].duration_ms }
      : { name: 'N/A', duration_ms: 0 },
    by_category: byCategory as Record<
      'contract' | 'smoke-main' | 'smoke-governance' | 'typecheck' | 'unit' | 'e2e',
      { total: number; passed: number; failed: number }
    >,
  };
}

/**
 * Classify failures by type (Epic D2)
 * Now uses the expanded failure classifier from failure-classifier.ts
 */
function classifyFailures(execution: ExecutionResults): FailureCategory[] {
  const categories: Map<FailureType, { count: number; checks: string[] }> = new Map();

  for (const check of execution.checks) {
    if (check.status === 'fail') {
      const category = classifyLocalFailure(check);
      if (!categories.has(category)) {
        categories.set(category, { count: 0, checks: [] });
      }
      const cat = categories.get(category)!;
      cat.count++;
      cat.checks.push(check.name);
    }
  }

  return Array.from(categories.entries()).map(([category, { count, checks }]) => ({
    category,
    count,
    checks,
  }));
}

/**
 * Classify a single failure
 * Now uses the expanded failure classifier from failure-classifier.ts
 */
function classifyLocalFailure(check: CheckResult): FailureType {
  const errorText = `${check.output || ''} ${check.error || ''}`;
  const result = classifyFailure(errorText);
  return result.category;
}

function summarizeUpstreamTransient(categories: FailureCategory[]) {
  const transientCategories = categories.filter((cat) => TRANSIENT_UPSTREAM_CATEGORIES.has(cat.category));
  if (transientCategories.length === 0) {
    return undefined;
  }

  const transientChecks = new Set<string>();
  for (const category of transientCategories) {
    for (const check of category.checks) transientChecks.add(check);
  }

  const hasNonTransientFailures = categories.some((cat) => !TRANSIENT_UPSTREAM_CATEGORIES.has(cat.category));
  const acceptance = hasNonTransientFailures ? 'mixed_or_blocking' : 'acceptable_with_retry';
  const note = acceptance === 'acceptable_with_retry'
    ? 'Only recoverable upstream instability was detected (429/timeout/network). Retry lane can be accepted once rerun succeeds.'
    : 'Upstream instability exists, but non-transient failures are also present and remain blocking.';

  return {
    count: transientCategories.reduce((total, cat) => total + cat.count, 0),
    categories: transientCategories.map((cat) => cat.category),
    checks: Array.from(transientChecks),
    acceptance,
    note,
  } as const;
}

/**
 * Generate recommendations based on failure categories
 * Now uses the expanded failure classifier from failure-classifier.ts
 */
function generateRecommendations(categories: Array<{ category: FailureType; count: number; checks: string[] }>): string[] {
  const recommendations: string[] = [];

  for (const cat of categories) {
    const recommendation = getQuickRecommendation(cat.category);
    recommendations.push(recommendation);
  }

  if (categories.some((cat) => TRANSIENT_UPSTREAM_CATEGORIES.has(cat.category))) {
    recommendations.push('Upstream instability detected: keep retry/backoff policy enabled and use rerun acceptance gate for transient failures.');
  }

  return recommendations;
}

/**
 * Generate Markdown report
 */
function generateMarkdown(report: GovernanceReport): string {
  const { metadata, execution, summary } = report;
  const statusEmoji = summary.status === 'pass' ? '✅' : '❌';
  const statusText = summary.status === 'pass' ? 'PASSED' : 'FAILED';

  let md = `# Governance Verification Report\n\n`;
  md += `${statusEmoji} **Status: ${statusText}**\n\n`;
  md += `**Generated:** ${new Date(metadata.timestamp).toLocaleString()}\n\n`;
  md += `---\n\n`;

  // Summary section
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Checks | ${execution.total_checks} |\n`;
  md += `| ✅ Passed | ${execution.passed} |\n`;
  md += `| ❌ Failed | ${execution.failed} |\n`;
  md += `| ⏭️ Skipped | ${execution.skipped} |\n`;
  md += `| Duration | ${(metadata.duration_ms / 1000).toFixed(2)}s |\n\n`;

  // Git info
  md += `### Git Information\n\n`;
  md += `- **Commit:** \`${metadata.git.commit_short}\` (${metadata.git.commit_hash})\n`;
  md += `- **Branch:** ${metadata.git.branch}\n`;
  md += `- **Message:** ${metadata.git.commit_message.split('\n')[0]}\n`;
  md += `- **Author:** ${metadata.git.author}\n`;
  if (metadata.git.commit_range) {
    md += `- **Range:** ${metadata.git.commit_range}\n`;
  }
  if (metadata.git.tag) {
    md += `- **Tag:** ${metadata.git.tag}\n`;
  }
  md += `\n`;

  // Environment
  md += `### Environment\n\n`;
  md += `- **Node:** ${metadata.environment.node_version}\n`;
  md += `- **Platform:** ${metadata.environment.platform} (${metadata.environment.arch})\n`;
  md += `\n`;

  // Recommendations if failed
  if (summary.recommendations && summary.recommendations.length > 0) {
    md += `### 📋 Recommendations\n\n`;
    for (const rec of summary.recommendations) {
      md += `- ${rec}\n`;
    }
    md += `\n`;
  }

  if (summary.governance_policy) {
    md += `### Governance Policy\n\n`;
    md += `- **Decision:** ${summary.governance_policy.decision}\n`;
    md += `- **Blockers:** ${summary.governance_policy.summary.blocker_count}\n`;
    md += `- **Warnings:** ${summary.governance_policy.summary.warning_count}\n`;
    md += `- **Overridable:** ${summary.governance_policy.summary.overridable_count}\n\n`;

    if (summary.governance_policy.blockers.length > 0) {
      md += `**Policy Blockers:**\n`;
      for (const issue of summary.governance_policy.blockers) {
        md += `- [${issue.source}] ${issue.message}\n`;
      }
      md += `\n`;
    }

    if (summary.governance_policy.warnings.length > 0) {
      md += `**Policy Warnings:**\n`;
      for (const issue of summary.governance_policy.warnings) {
        md += `- [${issue.source}] ${issue.message}\n`;
      }
      md += `\n`;
    }
  }

  if (summary.execution_review_evidence) {
    const executionEvidence = summary.execution_review_evidence;
    md += `### Execution Review Evidence\n\n`;
    md += `- **Source:** ${executionEvidence.source}\n`;
    md += `- **Generated At:** ${executionEvidence.generated_at}\n`;
    md += `- **Target:** ${executionEvidence.checks.target}\n`;
    md += `- **Checks:** ${executionEvidence.checks.review_status}\n`;
    md += `- **Planned Attempts:** ${executionEvidence.checks.planned_attempts}\n`;
    if (executionEvidence.target) {
      md += `- **Current Target:** ${executionEvidence.target.target_id}\n`;
      md += `- **Current Status:** ${executionEvidence.target.status}\n`;
      md += `- **Approvals Complete:** ${executionEvidence.target.approvals_complete ? 'yes' : 'no'}\n`;
      if (executionEvidence.target.change_mode) {
        md += `- **Change Mode:** ${executionEvidence.target.change_mode}`;
        if (executionEvidence.target.change_mode === 'canary' && typeof executionEvidence.target.change_percent === 'number') {
          md += ` (${executionEvidence.target.change_percent}%)`;
        }
        md += `\n`;
      }
    }
    md += `- **Pricing Source Coverage:** ${(executionEvidence.pricing_source_coverage.coverage_ratio * 100).toFixed(1)}% `;
    md += `(${executionEvidence.pricing_source_coverage.covered_usage_facts}/${executionEvidence.pricing_source_coverage.total_usage_facts})\n`;
    md += `- **Missing Price Facts:** ${executionEvidence.pricing_source_coverage.missing_price_facts}\n`;
    if (executionEvidence.note) {
      md += `- **Note:** ${executionEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Execution Check Signal | Count |\n`;
    md += `|------------------------|-------|\n`;
    md += `| Blockers | ${executionEvidence.checks.blockers.length} |\n`;
    md += `| Warnings | ${executionEvidence.checks.warnings.length} |\n`;
    md += `| Missing pricing coverage | ${executionEvidence.pricing_source_coverage.missing_usage_facts} |\n\n`;

    if (executionEvidence.checks.blockers.length > 0) {
      md += `**Execution Check Blockers:** ${executionEvidence.checks.blockers.join(', ')}\n\n`;
    }

    if (executionEvidence.checks.warnings.length > 0) {
      md += `**Execution Check Warnings:** ${executionEvidence.checks.warnings.join(', ')}\n\n`;
    }
  }


  if (summary.governance_evidence) {
    const governanceEvidence = summary.governance_evidence;
    md += `### Governance Release Evidence\n\n`;
    md += `- **Source:** ${governanceEvidence.source}\n`;
    md += `- **Generated At:** ${governanceEvidence.generated_at}\n`;
    md += `- **Activation Readiness:** ${governanceEvidence.review_status}\n`;
    if (governanceEvidence.note) {
      md += `- **Note:** ${governanceEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Governance Effect Check | Passed |\n`;
    md += `|-------------------------|--------|\n`;
    for (const [checkName, passed] of Object.entries(governanceEvidence.checks)) {
      md += `| ${checkName} | ${passed ? 'yes' : 'no'} |\n`;
    }
    md += `\n`;

    if (governanceEvidence.blockers.length > 0) {
      md += `**Governance Blockers:** ${governanceEvidence.blockers.join(', ')}\n\n`;
    }
    if (governanceEvidence.warnings.length > 0) {
      md += `**Governance Warnings:** ${governanceEvidence.warnings.join(', ')}\n\n`;
    }
  }

  if (summary.build_reliability_evidence) {
    const buildEvidence = summary.build_reliability_evidence;
    md += `### Build Reliability Evidence\n\n`;
    md += `- **Source:** ${buildEvidence.source}\n`;
    md += `- **Generated At:** ${buildEvidence.generated_at}\n`;
    md += `- **Activation Readiness:** ${buildEvidence.review_status}\n`;
    if (buildEvidence.note) {
      md += `- **Note:** ${buildEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Build Reliability Check | Passed |\n`;
    md += `|-------------------------|--------|\n`;
    for (const [checkName, passed] of Object.entries(buildEvidence.checks)) {
      md += `| ${checkName} | ${passed ? 'yes' : 'no'} |\n`;
    }
    md += `\n`;

    if (buildEvidence.blockers.length > 0) {
      md += `**Build Reliability Blockers:** ${buildEvidence.blockers.join(', ')}\n\n`;
    }
    if (buildEvidence.warnings.length > 0) {
      md += `**Build Reliability Warnings:** ${buildEvidence.warnings.join(', ')}\n\n`;
    }
  }

  if (summary.workspace_governance_evidence) {
    const workspaceEvidence = summary.workspace_governance_evidence;
    md += `### Workspace Governance Evidence\n\n`;
    md += `- **Source:** ${workspaceEvidence.source}\n`;
    md += `- **Generated At:** ${workspaceEvidence.generated_at}\n`;
    md += `- **Activation Readiness:** ${workspaceEvidence.review_status}\n`;
    if (workspaceEvidence.note) {
      md += `- **Note:** ${workspaceEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Workspace Governance Check | Passed |\n`;
    md += `|----------------------------|--------|\n`;
    for (const [checkName, passed] of Object.entries(workspaceEvidence.checks)) {
      md += `| ${checkName} | ${passed ? 'yes' : 'no'} |\n`;
    }
    md += `\n`;

    if (workspaceEvidence.blockers.length > 0) {
      md += `**Workspace Governance Blockers:** ${workspaceEvidence.blockers.join(', ')}\n\n`;
    }
    if (workspaceEvidence.warnings.length > 0) {
      md += `**Workspace Governance Warnings:** ${workspaceEvidence.warnings.join(', ')}\n\n`;
    }
  }

  if (summary.organization_governance_evidence) {
    const organizationEvidence = summary.organization_governance_evidence;
    md += `### Organization Governance Evidence\n\n`;
    md += `- **Source:** ${organizationEvidence.source}\n`;
    md += `- **Generated At:** ${organizationEvidence.generated_at}\n`;
    md += `- **Activation Readiness:** ${organizationEvidence.review_status}\n`;
    if (organizationEvidence.note) {
      md += `- **Note:** ${organizationEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Organization Governance Check | Passed |\n`;
    md += `|-------------------------------|--------|\n`;
    for (const [checkName, passed] of Object.entries(organizationEvidence.checks)) {
      md += `| ${checkName} | ${passed ? 'yes' : 'no'} |\n`;
    }
    md += `\n`;

    if (organizationEvidence.blockers.length > 0) {
      md += `**Organization Governance Blockers:** ${organizationEvidence.blockers.join(', ')}\n\n`;
    }
    if (organizationEvidence.warnings.length > 0) {
      md += `**Organization Governance Warnings:** ${organizationEvidence.warnings.join(', ')}\n\n`;
    }
  }

  // Failure categories
  if (summary.failure_categories && summary.failure_categories.length > 0) {
    md += `### Failure Breakdown\n\n`;
    md += `| Category | Count | Checks |\n`;
    md += `|----------|-------|--------|\n`;
    for (const cat of summary.failure_categories) {
      md += `| ${cat.category} | ${cat.count} | ${cat.checks.join(', ')} |\n`;
    }
    md += `\n`;
  }

  if (summary.upstream_transient) {
    md += `### Upstream Transient Assessment\n\n`;
    md += `- **Count:** ${summary.upstream_transient.count}\n`;
    md += `- **Categories:** ${summary.upstream_transient.categories.join(', ')}\n`;
    md += `- **Acceptance:** ${summary.upstream_transient.acceptance}\n`;
    md += `- **Note:** ${summary.upstream_transient.note}\n\n`;
  }

  // Execution details
  md += `## Execution Results\n\n`;
  md += `| Check | Category | Status | Duration |\n`;
  md += `|-------|----------|--------|----------|\n`;

  for (const check of execution.checks) {
    const statusEmoji = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⏭️';
    md += `| ${check.name} | ${check.category} | ${statusEmoji} ${check.status} | ${check.duration_ms}ms |\n`;
  }
  md += `\n`;

  // Error details for failed checks
  const failedChecks = execution.checks.filter((c) => c.status === 'fail');
  if (failedChecks.length > 0) {
    md += `### Failed Check Details\n\n`;
    for (const check of failedChecks) {
      md += `#### ${check.name}\n\n`;
      md += `**Category:** ${check.category}\n`;
      md += `**Duration:** ${check.duration_ms}ms\n`;
      if (check.command) {
        md += `**Command:** \`${check.command}\`\n`;
      }
      md += `\n`;
      if (check.error) {
        md += `**Error:**\n`;
        md += `\`\`\`\n${truncate(check.error, 500)}\n\`\`\`\n\n`;
      }
    }
  }

  // Metadata section
  md += `## Metadata\n\n`;
  md += `This report was generated by \`verify-governance-report.ts\` as part of Epic D1: Governance Report Automation.\n\n`;
  md += `**Full JSON report available** alongside this file.\n`;

  return md;
}

/**
 * Get timestamp for file naming
 */
function getTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0].replace(/-/g, '');
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
  return `${date}-${time}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

// Run main if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  main().catch((err) => {
    console.error('[verify-governance-report] Fatal error:', err);
    process.exit(1);
  });
}

export { generateGovernanceReport, generateMarkdown, classifyFailure };
