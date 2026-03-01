#!/usr/bin/env node
/**
 * verify-release-report.ts
 *
 * Release Report Automation (Epic D1)
 *
 * Generates structured reports (JSON + Markdown) for release verification.
 * Captures commit range, environment, execution results, and failure summary.
 *
 * Usage:
 *   node scripts/release/verify-release-report.ts [options]
 *
 * Options:
 *   --output <dir>      Output directory (default: ./artifacts/release-reports)
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
  ReleaseEscalationEvent,
  ReleaseReport,
  ReleaseGateRunHistory,
  ReportMetadata,
  ExecutionResults,
  ReportSummary,
  CheckResult,
  CheckCategory,
  FailureType,
  VerifyReleaseOptions,
  FailureCategory,
  RuntimeReleaseEvidence,
  UsageReportEvidence,
} from './types';
import {
  classifyFailure,
  getQuickRecommendation,
} from './failure-classifier';
import { evaluateReleasePolicy } from '../../src/lib/release-policy';

// Default configuration
const DEFAULT_OUTPUT_DIR = join(process.cwd(), 'artifacts/release-reports');
const DEFAULT_RUNS_OUTPUT_DIR = join(process.cwd(), 'artifacts/release-runs');
const DEFAULT_ESCALATIONS_OUTPUT_DIR = join(process.cwd(), 'artifacts/release-escalations');
const DEFAULT_RUNTIME_EVIDENCE_FILE = 'runtime-release-evidence.json';
const DEFAULT_USAGE_REPORT_EVIDENCE_FILE = 'usage-report-evidence.json';

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
    name: 'Mainline release smoke',
    category: 'smoke-main',
    command: 'make notebook-agent-release-smoke-full',
    timeout: 600000, // 10 minutes
  },
  {
    id: 'smoke-governance',
    name: 'Governance release smoke',
    category: 'smoke-governance',
    command: 'make governance-release-smoke',
    timeout: 600000, // 10 minutes
  },
  {
    id: 'runtime-release-evidence',
    name: 'Runtime proxy billing release workflow',
    category: 'e2e',
    command: 'INTEGRATION_API_PORT=20010 BASE_URL=http://localhost:3001 npm run test:e2e:integration:runtime-proxy-billing:with-api',
    timeout: 600000, // 10 minutes
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

  console.log(`[verify-release-report] Generating release report...`);
  console.log(`[verify-release-report] Output: ${join(outputDir, reportName)}`);

  // Generate report
  const report = await generateReleaseReport(args);

  // Write JSON report
  const jsonPath = join(outputDir, `${reportName}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[verify-release-report] JSON: ${jsonPath}`);

  // Write Markdown report
  const mdPath = join(outputDir, `${reportName}.md`);
  writeFileSync(mdPath, generateMarkdown(report), 'utf-8');
  console.log(`[verify-release-report] Markdown: ${mdPath}`);

  const runHistory = buildReleaseGateRunHistory(reportName, report, args);
  const runPath = join(runsOutputDir, `${reportName}.json`);
  writeFileSync(runPath, JSON.stringify(runHistory, null, 2), 'utf-8');
  console.log(`[verify-release-report] Run: ${runPath}`);

  const escalation = await buildReleaseEscalationEvent(reportName, report, runHistory);
  const escalationPath = join(escalationsOutputDir, `${reportName}.json`);
  writeFileSync(escalationPath, JSON.stringify(escalation, null, 2), 'utf-8');
  console.log(`[verify-release-report] Escalation: ${escalationPath}`);

  // Archive if requested
  let archivePath: string | undefined;
  if (args.archive) {
    const archiveName = `report-${getTimestamp()}`;
    const archiveJsonPath = join(outputDir, `${archiveName}.json`);
    const archiveMdPath = join(outputDir, `${archiveName}.md`);
    writeFileSync(archiveJsonPath, JSON.stringify(report, null, 2), 'utf-8');
    writeFileSync(archiveMdPath, generateMarkdown(report), 'utf-8');
    archivePath = archiveJsonPath;
    console.log(`[verify-release-report] Archive: ${archivePath}`);
  }

  // Exit with appropriate code
  const exitCode = report.summary.status === 'pass' ? 0 : 1;
  console.log(`[verify-release-report] Status: ${report.summary.status.toUpperCase()}`);

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
      case '--runtime-evidence':
        options.runtimeEvidence = argv[++i];
        break;
      case '--usage-report-evidence':
        options.usageReportEvidence = argv[++i];
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
verify-release-report - Release Verification Report Generator

USAGE:
  node scripts/release/verify-release-report.ts [options]

OPTIONS:
  --output <dir>       Output directory (default: ./artifacts/release-reports)
  --name <name>        Report name (default: report-<timestamp>)
  --commit-range <r>   Commit range (e.g., abc123..def456)
  --archive            Create timestamped archive copy
  --dry-run            Skip actual check execution (for testing)
  --mock-failure <t>   Mock a failure type: token|network|backend|assertion|timeout|rate_limit
  --runtime-evidence <path>  Read runtime release evidence artifact from custom path
  --usage-report-evidence <path>  Read usage report evidence artifact from custom path
  --runs-output <dir>  Output directory for release gate run history artifacts
  --escalations-output <dir>  Output directory for release escalation artifacts
  --trigger <source>   Trigger source: manual|scheduled|ci|unknown
  --checks <ids>       Comma-separated check ids to execute
  --actor-user-id <id> Manual trigger actor user id
  --actor-name <name>  Manual trigger actor display name
  --notes <text>       Optional run notes
  --rerun-of-run-id <id>  Source run id when rerunning failed checks
  --verbose            Show detailed output
  --help, -h           Show this help

EXAMPLES:
  # Generate report after verify-release
  make verify-release
  node scripts/release/verify-release-report.ts --archive

  # Generate with custom name and commit range
  node scripts/release/verify-release-report.ts \\
    --name v1.2.3 \\
    --commit-range v1.2.2..v1.2.3 \\
    --archive

  # Dry run to test report generation
  node scripts/release/verify-release-report.ts --dry-run
`);
}

/**
 * Generate the complete release report
 */
async function generateReleaseReport(options: VerifyReleaseOptions): Promise<ReleaseReport> {
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

function buildReleaseGateRunHistory(
  reportName: string,
  report: ReleaseReport,
  options: VerifyReleaseOptions,
): ReleaseGateRunHistory {
  const failedChecks = report.execution.checks.filter((check) => check.status === 'fail');
  const firstFailedCheck = failedChecks[0];
  const failureCategories = Array.from(new Set((report.summary.failure_categories ?? []).map((category) => category.category)));
  return {
    id: reportName,
    report_name: reportName,
    artifact_name: reportName,
    trigger: options.trigger ?? getTriggerSource(),
    started_at: report.metadata.timestamp,
    completed_at: new Date(new Date(report.metadata.timestamp).getTime() + report.metadata.duration_ms).toISOString(),
    duration_ms: report.metadata.duration_ms,
    status: report.summary.status,
    branch: report.metadata.git.branch,
    commit_short: report.metadata.git.commit_short,
    release_policy_decision: report.summary.release_policy?.decision,
    runtime_release_readiness: report.summary.runtime_release_evidence?.guardrails.release_readiness,
    usage_release_readiness: report.summary.usage_report_evidence?.release_readiness,
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

async function buildReleaseEscalationEvent(
  reportName: string,
  report: ReleaseReport,
  run: ReleaseGateRunHistory,
): Promise<ReleaseEscalationEvent> {
  const decision = report.summary.release_policy?.decision ?? 'blocked';
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
  const event: ReleaseEscalationEvent = {
    id: reportName,
    report_name: reportName,
    run_id: run.id,
    created_at: run.completed_at,
    event_type: eventType,
    severity,
    status,
    title: decision === 'ready'
      ? 'Release gate recovered to ready state'
      : decision === 'warning'
        ? 'Release gate completed with warning state'
        : 'Release gate blocked',
    body: decision === 'ready'
      ? 'Latest release gate completed successfully and no blocking policy issues remain.'
      : decision === 'warning'
        ? `Latest release gate completed with ${report.summary.release_policy?.summary.warning_count ?? 0} warning issues.`
        : `Latest release gate is blocked by ${report.summary.release_policy?.summary.blocker_count ?? 0} issues.`,
    artifact_name: reportName,
    trigger: run.trigger,
    release_policy_decision: decision,
    runtime_release_readiness: report.summary.runtime_release_evidence?.guardrails.release_readiness,
    usage_release_readiness: report.summary.usage_report_evidence?.release_readiness,
    failed_step_name: run.failed_step_name,
    failure_categories: run.failure_categories,
  };
  event.webhook_delivery = await deliverReleaseEscalationWebhook(event);
  return event;
}

async function deliverReleaseEscalationWebhook(
  event: ReleaseEscalationEvent,
): Promise<ReleaseEscalationEvent['webhook_delivery']> {
  const webhookUrl = process.env.RELEASE_ESCALATION_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { status: 'skipped' };
  }

  const startedAt = Date.now();
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-agentsmith-release-event-type': event.event_type,
    'x-agentsmith-release-event-id': event.id,
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
      error: error instanceof Error ? error.message : 'release_escalation_webhook_failed',
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
  quota: [
    'quota exceeded: daily limit exhausted',
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
  if (def.id !== 'runtime-release-evidence') return def.command;

  const runtimeEvidencePath = getRuntimeEvidencePath(options);
  const usageReportEvidencePath = getUsageReportEvidencePath(options);
  return `RUNTIME_RELEASE_EVIDENCE_PATH=${shellQuote(runtimeEvidencePath)} USAGE_REPORT_EVIDENCE_PATH=${shellQuote(usageReportEvidencePath)} ${def.command}`;
}

/**
 * Generate report summary
 */
function generateSummary(execution: ExecutionResults, options: VerifyReleaseOptions): ReportSummary {
  const runtimeEvidence = loadRuntimeReleaseEvidence(options);
  const usageReportEvidence = loadUsageReportEvidence(options);
  const runtimeBlockingReasons = getRuntimeEvidenceBlockingReasons(runtimeEvidence);
  const usageReportBlockingReasons = getUsageReportEvidenceBlockingReasons(usageReportEvidence);
  const status = execution.failed === 0 && runtimeBlockingReasons.length === 0 && usageReportBlockingReasons.length === 0 ? 'pass' : 'fail';

  const summary: ReportSummary = {
    status,
    stats: calculateStats(execution),
  };

  if (runtimeEvidence) {
    summary.runtime_release_evidence = runtimeEvidence;
  }
  if (usageReportEvidence) {
    summary.usage_report_evidence = usageReportEvidence;
  }

  // Add failure categories if there are failures
  if (execution.failed > 0) {
    summary.failure_categories = classifyFailures(execution);
    summary.upstream_transient = summarizeUpstreamTransient(summary.failure_categories);
    summary.recommendations = generateRecommendations(summary.failure_categories);
  }

  summary.release_policy = evaluateReleasePolicy({
    execution: {
      failed_count: execution.failed,
      transient_acceptance: summary.upstream_transient?.acceptance,
      failure_categories: summary.failure_categories?.map((category) => category.category),
    },
    runtime: runtimeEvidence ? {
      release_readiness: runtimeEvidence.guardrails.release_readiness,
      blockers: runtimeEvidence.guardrails.blockers,
      warnings: runtimeEvidence.guardrails.warnings,
      missing_usage_facts: runtimeEvidence.pricing_version_coverage.missing_usage_facts,
      missing_price_facts: runtimeEvidence.pricing_version_coverage.missing_price_facts,
      release_candidate: runtimeEvidence.release_candidate ? {
        release_status: runtimeEvidence.release_candidate.release_status,
        approvals_complete: runtimeEvidence.release_candidate.approvals_complete,
      } : undefined,
    } : undefined,
    usage: usageReportEvidence ? {
      release_readiness: usageReportEvidence.release_readiness,
      blockers: usageReportEvidence.blockers,
      warnings: usageReportEvidence.warnings,
      required_schedules: usageReportEvidence.required_schedules,
      unacknowledged_required_deliveries: usageReportEvidence.unacknowledged_required_deliveries,
      runner_health: usageReportEvidence.runner_health ? {
        enabled: usageReportEvidence.runner_health.enabled,
        last_status: usageReportEvidence.runner_health.last_status,
        run_count: usageReportEvidence.runner_health.run_count,
      } : undefined,
    } : undefined,
  });

  if (runtimeBlockingReasons.length > 0) {
    const runtimeRecommendations = runtimeBlockingReasons.map((reason) => `Runtime release blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...runtimeRecommendations];
  }
  if (usageReportBlockingReasons.length > 0) {
    const usageRecommendations = usageReportBlockingReasons.map((reason) => `Usage report release blocker: ${reason}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...usageRecommendations];
  }
  if (summary.release_policy) {
    const policyRecommendations = summary.release_policy.blockers.map((issue) => `Release policy blocker: ${issue.message}`);
    summary.recommendations = [...(summary.recommendations ?? []), ...policyRecommendations];
  }

  return summary;
}

function getRuntimeEvidencePath(options: VerifyReleaseOptions): string {
  if (options.runtimeEvidence) return options.runtimeEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_RUNTIME_EVIDENCE_FILE);
}

function getUsageReportEvidencePath(options: VerifyReleaseOptions): string {
  if (options.usageReportEvidence) return options.usageReportEvidence;
  return join(options.output ?? DEFAULT_OUTPUT_DIR, DEFAULT_USAGE_REPORT_EVIDENCE_FILE);
}

function loadRuntimeReleaseEvidence(options: VerifyReleaseOptions): RuntimeReleaseEvidence | undefined {
  const evidencePath = getRuntimeEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      const parsed = JSON.parse(readFileSync(evidencePath, 'utf-8')) as RuntimeReleaseEvidence;
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        guardrails: {
          target: 'unknown',
          release_readiness: 'blocked',
          blockers: ['runtime_release_evidence_unreadable'],
          warnings: [],
          planned_attempts: 0,
        },
        pricing_version_coverage: {
          total_usage_facts: 0,
          covered_usage_facts: 0,
          missing_usage_facts: 0,
          missing_price_facts: 0,
          coverage_ratio: 0,
        },
        note: `Failed to parse runtime release evidence: ${message}`,
      };
    }
  }

  if (options.dryRun) {
    return createMockRuntimeReleaseEvidence();
  }

  return undefined;
}

function createMockRuntimeReleaseEvidence(): RuntimeReleaseEvidence {
  return {
    source: 'dry_run',
    generated_at: new Date().toISOString(),
    guardrails: {
      target: 'combo:prod-chat',
      release_readiness: 'ready',
      blockers: [],
      warnings: ['runtime_guardrail_fallback_connection_unavailable'],
      planned_attempts: 2,
    },
    pricing_version_coverage: {
      total_usage_facts: 4,
      covered_usage_facts: 4,
      missing_usage_facts: 0,
      missing_price_facts: 0,
      coverage_ratio: 1,
    },
    release_candidate: {
      route_type: 'combo',
      route_key: 'prod-chat',
      release_status: 'published',
      rollout_mode: 'full',
      canary_percent: null,
      approvals_complete: true,
      published_at: new Date().toISOString(),
    },
    note: 'Dry-run evidence uses deterministic fixture data and does not call live runtime services.',
  };
}

function loadUsageReportEvidence(options: VerifyReleaseOptions): UsageReportEvidence | undefined {
  const evidencePath = getUsageReportEvidencePath(options);
  if (existsSync(evidencePath)) {
    try {
      return JSON.parse(readFileSync(evidencePath, 'utf-8')) as UsageReportEvidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        release_readiness: 'blocked',
        blockers: ['usage_report_evidence_unreadable'],
        warnings: [],
      active_schedules: 0,
      required_schedules: 0,
      successful_deliveries_last_7d: 0,
      failed_deliveries_last_7d: 0,
      unacknowledged_required_deliveries: 0,
      runner_health: {
        enabled: false,
        interval_ms: 60000,
        running: false,
        run_count: 0,
        last_status: 'failed',
        last_error: message,
      },
      note: `Failed to parse usage report evidence: ${message}`,
    };
  }
  }

  if (options.dryRun) {
    return {
      source: 'dry_run',
      generated_at: new Date().toISOString(),
      release_readiness: 'ready',
      blockers: [],
      warnings: ['usage_report_no_active_schedules'],
      active_schedules: 1,
      required_schedules: 1,
      successful_deliveries_last_7d: 1,
      failed_deliveries_last_7d: 0,
      unacknowledged_required_deliveries: 0,
      runner_health: {
        enabled: true,
        interval_ms: 60000,
        running: false,
        run_count: 3,
        last_status: 'success',
        last_started_at: new Date(Date.now() - 90_000).toISOString(),
        last_completed_at: new Date(Date.now() - 89_000).toISOString(),
        last_result: {
          generated_at: new Date(Date.now() - 89_000).toISOString(),
          processed_schedules: 1,
          successful_deliveries: 1,
          failed_deliveries: 0,
        },
      },
      note: 'Dry-run evidence uses deterministic fixture data and does not call live delivery channels.',
    };
  }

  return undefined;
}

function getRuntimeEvidenceBlockingReasons(runtimeEvidence?: RuntimeReleaseEvidence): string[] {
  if (!runtimeEvidence) return [];

  const reasons: string[] = [];
  if (runtimeEvidence.guardrails.release_readiness === 'blocked') {
    reasons.push(
      runtimeEvidence.guardrails.blockers.length > 0
        ? `guardrails blocked by ${runtimeEvidence.guardrails.blockers.join(', ')}`
        : 'guardrails reported blocked release readiness',
    );
  }
  if (runtimeEvidence.pricing_version_coverage.missing_usage_facts > 0) {
    reasons.push(
      `pricing version coverage incomplete (${runtimeEvidence.pricing_version_coverage.covered_usage_facts}/${runtimeEvidence.pricing_version_coverage.total_usage_facts})`,
    );
  }
  if (runtimeEvidence.pricing_version_coverage.missing_price_facts > 0) {
    reasons.push(`runtime missing_price facts detected (${runtimeEvidence.pricing_version_coverage.missing_price_facts})`);
  }
  if (!runtimeEvidence.release_candidate) {
    reasons.push('runtime release candidate missing');
    return reasons;
  }
  if (runtimeEvidence.release_candidate.release_status !== 'published') {
    reasons.push(`runtime release candidate not published (${runtimeEvidence.release_candidate.release_status})`);
  }
  if (!runtimeEvidence.release_candidate.approvals_complete) {
    reasons.push('runtime release candidate approvals incomplete');
  }
  return reasons;
}

function getUsageReportEvidenceBlockingReasons(usageReportEvidence?: UsageReportEvidence): string[] {
  if (!usageReportEvidence) return [];

  const reasons: string[] = [];
  if (usageReportEvidence.release_readiness === 'blocked') {
    reasons.push(
      usageReportEvidence.blockers.length > 0
        ? `usage report evidence blocked by ${usageReportEvidence.blockers.join(', ')}`
        : 'usage report evidence reported blocked release readiness',
    );
  }
  if (usageReportEvidence.required_schedules === 0) {
    reasons.push('usage report evidence has no required schedules');
  }
  if (usageReportEvidence.unacknowledged_required_deliveries > 0) {
    reasons.push(`usage report evidence has ${usageReportEvidence.unacknowledged_required_deliveries} unacknowledged required deliveries`);
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
function generateMarkdown(report: ReleaseReport): string {
  const { metadata, execution, summary } = report;
  const statusEmoji = summary.status === 'pass' ? '✅' : '❌';
  const statusText = summary.status === 'pass' ? 'PASSED' : 'FAILED';

  let md = `# Release Verification Report\n\n`;
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

  if (summary.release_policy) {
    md += `### Release Policy\n\n`;
    md += `- **Decision:** ${summary.release_policy.decision}\n`;
    md += `- **Blockers:** ${summary.release_policy.summary.blocker_count}\n`;
    md += `- **Warnings:** ${summary.release_policy.summary.warning_count}\n`;
    md += `- **Overridable:** ${summary.release_policy.summary.overridable_count}\n\n`;

    if (summary.release_policy.blockers.length > 0) {
      md += `**Policy Blockers:**\n`;
      for (const issue of summary.release_policy.blockers) {
        md += `- [${issue.source}] ${issue.message}\n`;
      }
      md += `\n`;
    }

    if (summary.release_policy.warnings.length > 0) {
      md += `**Policy Warnings:**\n`;
      for (const issue of summary.release_policy.warnings) {
        md += `- [${issue.source}] ${issue.message}\n`;
      }
      md += `\n`;
    }
  }

  if (summary.runtime_release_evidence) {
    const runtimeEvidence = summary.runtime_release_evidence;
    md += `### Runtime Release Evidence\n\n`;
    md += `- **Source:** ${runtimeEvidence.source}\n`;
    md += `- **Generated At:** ${runtimeEvidence.generated_at}\n`;
    md += `- **Target:** ${runtimeEvidence.guardrails.target}\n`;
    md += `- **Guardrails:** ${runtimeEvidence.guardrails.release_readiness}\n`;
    md += `- **Planned Attempts:** ${runtimeEvidence.guardrails.planned_attempts}\n`;
    if (runtimeEvidence.release_candidate) {
      md += `- **Release Candidate:** ${runtimeEvidence.release_candidate.route_type}:${runtimeEvidence.release_candidate.route_key}\n`;
      md += `- **Release Status:** ${runtimeEvidence.release_candidate.release_status}\n`;
      md += `- **Approvals Complete:** ${runtimeEvidence.release_candidate.approvals_complete ? 'yes' : 'no'}\n`;
      if (runtimeEvidence.release_candidate.rollout_mode) {
        md += `- **Rollout Mode:** ${runtimeEvidence.release_candidate.rollout_mode}`;
        if (runtimeEvidence.release_candidate.rollout_mode === 'canary' && typeof runtimeEvidence.release_candidate.canary_percent === 'number') {
          md += ` (${runtimeEvidence.release_candidate.canary_percent}%)`;
        }
        md += `\n`;
      }
    }
    md += `- **Pricing Version Coverage:** ${(runtimeEvidence.pricing_version_coverage.coverage_ratio * 100).toFixed(1)}% `;
    md += `(${runtimeEvidence.pricing_version_coverage.covered_usage_facts}/${runtimeEvidence.pricing_version_coverage.total_usage_facts})\n`;
    md += `- **Missing Price Facts:** ${runtimeEvidence.pricing_version_coverage.missing_price_facts}\n`;
    if (runtimeEvidence.note) {
      md += `- **Note:** ${runtimeEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Runtime Guardrail Signal | Count |\n`;
    md += `|--------------------------|-------|\n`;
    md += `| Blockers | ${runtimeEvidence.guardrails.blockers.length} |\n`;
    md += `| Warnings | ${runtimeEvidence.guardrails.warnings.length} |\n`;
    md += `| Missing pricing coverage | ${runtimeEvidence.pricing_version_coverage.missing_usage_facts} |\n\n`;

    if (runtimeEvidence.guardrails.blockers.length > 0) {
      md += `**Guardrail Blockers:** ${runtimeEvidence.guardrails.blockers.join(', ')}\n\n`;
    }

    if (runtimeEvidence.guardrails.warnings.length > 0) {
      md += `**Guardrail Warnings:** ${runtimeEvidence.guardrails.warnings.join(', ')}\n\n`;
    }
  }

  if (summary.usage_report_evidence) {
    const usageEvidence = summary.usage_report_evidence;
    md += `### Usage Report Evidence\n\n`;
    md += `- **Source:** ${usageEvidence.source}\n`;
    md += `- **Generated At:** ${usageEvidence.generated_at}\n`;
    md += `- **Release Readiness:** ${usageEvidence.release_readiness}\n`;
    md += `- **Active Schedules:** ${usageEvidence.active_schedules}\n`;
    md += `- **Required Schedules:** ${usageEvidence.required_schedules}\n`;
    md += `- **Successful Deliveries (7d):** ${usageEvidence.successful_deliveries_last_7d}\n`;
    md += `- **Failed Deliveries (7d):** ${usageEvidence.failed_deliveries_last_7d}\n`;
    md += `- **Unacknowledged Required Deliveries:** ${usageEvidence.unacknowledged_required_deliveries}\n`;
    if (usageEvidence.runner_health) {
      md += `- **Runner Enabled:** ${usageEvidence.runner_health.enabled ? 'yes' : 'no'}\n`;
      md += `- **Runner Status:** ${usageEvidence.runner_health.last_status}\n`;
      md += `- **Runner Run Count:** ${usageEvidence.runner_health.run_count}\n`;
      if (usageEvidence.runner_health.last_completed_at) {
        md += `- **Runner Last Completed:** ${usageEvidence.runner_health.last_completed_at}\n`;
      }
      if (usageEvidence.runner_health.last_error) {
        md += `- **Runner Last Error:** ${usageEvidence.runner_health.last_error}\n`;
      }
    }
    if (usageEvidence.note) {
      md += `- **Note:** ${usageEvidence.note}\n`;
    }
    md += `\n`;

    md += `| Usage Report Signal | Count |\n`;
    md += `|---------------------|-------|\n`;
    md += `| Blockers | ${usageEvidence.blockers.length} |\n`;
    md += `| Warnings | ${usageEvidence.warnings.length} |\n\n`;

    if (usageEvidence.blockers.length > 0) {
      md += `**Usage Report Blockers:** ${usageEvidence.blockers.join(', ')}\n\n`;
    }

    if (usageEvidence.warnings.length > 0) {
      md += `**Usage Report Warnings:** ${usageEvidence.warnings.join(', ')}\n\n`;
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
  md += `This report was generated by \`verify-release-report.ts\` as part of Epic D1: Release Report Automation.\n\n`;
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
    console.error('[verify-release-report] Fatal error:', err);
    process.exit(1);
  });
}

export { generateReleaseReport, generateMarkdown, classifyFailure };
