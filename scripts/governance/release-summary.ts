import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import {
  assertReleaseCampaignRootNotSymlink,
} from './release-campaign-io';

export type AutomatedReleaseVerdict = 'PASSED' | 'FAILED';

export interface ReleaseSummary {
  schema: 'agentsmith_release_summary/v1';
  campaign_id: 'release-full';
  campaign_run_id: string;
  campaign_root: string;
  automated_release_verdict: AutomatedReleaseVerdict;
  status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  stage: string;
  blocked_step: string | null;
  why: string;
  next_action: string;
  terminal_result_path: string;
  summary_json_path: string;
  summary_md_path: string;
  evidence_package: string;
  manual_operator_signoff: 'not_covered';
  generated_at: string;
}

export interface ReleaseLatestPointer {
  schema: 'agentsmith_release_latest/v1';
  campaign_id: 'release-full';
  campaign_run_id: string;
  campaign_root: string;
  git_sha: string;
  summary_json?: string;
  summary_md?: string;
  terminal_result_path?: string;
  /**
   * When this read-only latest pointer was generated. New writes keep
   * updated_at as a compatibility alias, but readers must not use it as a
   * replacement for generated_at.
   */
  generated_at: string;
  updated_at?: string;
}

export type ReleaseStatusRead =
  | { kind: 'ready'; latestPath: string; summary: ReleaseSummary; latest?: ReleaseLatestPointer }
  | { kind: 'missing_latest'; latestPath: string }
  | { kind: 'missing_summary'; latestPath: string; summaryPath: string }
  | { kind: 'malformed'; latestPath: string; error: string };

const RELEASE_LATEST_POINTER_KEYS = new Set([
  'schema',
  'campaign_id',
  'campaign_run_id',
  'campaign_root',
  'git_sha',
  'summary_json',
  'summary_md',
  'terminal_result_path',
  'generated_at',
  'updated_at',
]);

const GIT_COMMIT_HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface ParsedTerminalResult {
  schema_version?: unknown;
  gate_id?: unknown;
  gate_adapter?: unknown;
  status?: unknown;
  failure_class?: unknown;
  stage?: unknown;
  line_kind?: unknown;
  evidence_dir?: unknown;
  summary?: unknown;
  generated_at?: unknown;
}

export interface WriteReleaseSummaryOptions {
  campaignRoot: string;
  latestPath?: string;
  writeLatest?: boolean;
  resolveGitSha?: () => string;
}

export interface ReadReleaseStatusOptions {
  latestPath?: string;
  campaignRoot?: string;
}

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function defaultLatestPath(): string {
  return resolve('artifacts', 'release-runs', 'latest.json');
}

export function isDefaultReleaseRunsCampaignRoot(campaignRoot: string): boolean {
  const releaseRunsRoot = resolve('artifacts', 'release-runs');
  const resolvedCampaignRoot = resolve(campaignRoot);
  return resolvedCampaignRoot === releaseRunsRoot || resolvedCampaignRoot.startsWith(`${releaseRunsRoot}/`);
}

function terminalResultPath(campaignRoot: string): string {
  return join(resolve(campaignRoot), 'gate-release-full', 'result.json');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function resolveCurrentGitSha(cwd = process.cwd()): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (result.status !== 0 || stdout.length === 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(`Unable to resolve current git sha${stderr ? `: ${stderr}` : '.'}`);
  }
  return stdout;
}

function requireNonEmptyStringField(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must include ${field}.`);
  }
  return value;
}

function requireOptionalStringField(record: Record<string, unknown>, field: string, label: string): void {
  const value = record[field];
  if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
    throw new Error(`${label} ${field} must be a non-empty string when present.`);
  }
}

function assertAllowedFields(record: Record<string, unknown>, allowedFields: ReadonlySet<string>, label: string): void {
  const unexpectedField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unexpectedField) {
    throw new Error(`${label} has unexpected field: ${unexpectedField}.`);
  }
}

function requireGitCommitHash(record: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonEmptyStringField(record, field, label);
  if (!GIT_COMMIT_HASH_PATTERN.test(value)) {
    throw new Error(`${label} ${field} must be a 40 or 64 character hex git commit hash.`);
  }
  return value;
}

function requireIsoTimestamp(record: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonEmptyStringField(record, field, label);
  const parsed = new Date(value);
  if (
    !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== value
  ) {
    throw new Error(`${label} ${field} must be a valid canonical ISO timestamp.`);
  }
  return value;
}

function readTerminalResult(campaignRoot: string): ParsedTerminalResult {
  const path = terminalResultPath(campaignRoot);
  const result = requireRecord(readJson(path), 'release terminal result');

  if (result.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION) {
    throw new Error(`release terminal result schema_version must be ${CURRENT_GATE_RESULT_SCHEMA_VERSION}.`);
  }
  if (result.gate_id !== 'gate-release-full') {
    throw new Error('release terminal result must belong to gate-release-full.');
  }
  if (result.line_kind !== 'release_full_verdict') {
    throw new Error('release terminal result must use line_kind release_full_verdict.');
  }
  if (typeof result.status !== 'string' || !CURRENT_GATE_RESULT_STATUSES.includes(result.status as CurrentGateResultStatus)) {
    throw new Error('release terminal result status is not a current gate result status.');
  }
  if (
    typeof result.failure_class !== 'string'
    || !CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(result.failure_class as CurrentGateResultFailureClass)
  ) {
    throw new Error('release terminal result failure_class is not a current gate result failure class.');
  }
  if (result.status === 'passed' && result.failure_class !== 'none') {
    throw new Error('release terminal result is inconsistent: passed result must use failure_class none.');
  }
  if (result.status === 'failed' && result.failure_class === 'none') {
    throw new Error('release terminal result is inconsistent: failed result must use a non-none failure_class.');
  }
  if (typeof result.stage !== 'string' || typeof result.summary !== 'string') {
    throw new Error('release terminal result must include stage and summary strings.');
  }

  return result;
}

function inferBlockedStep(status: CurrentGateResultStatus, summary: string): string | null {
  if (status === 'passed') {
    return null;
  }

  for (const pattern of [
    /Campaign step ([a-z0-9-]+) did not pass\./,
    /Missing campaign step result: ([a-z0-9-]+)/,
    /campaign step ([a-z0-9-]+)/i,
  ]) {
    const match = pattern.exec(summary);
    if (match?.[1]) {
      return match[1];
    }
  }

  return 'gate-release-full';
}

function nextActionForFailure(
  failureClass: CurrentGateResultFailureClass,
  blockedStep: string | null,
): string {
  if (failureClass === 'none') {
    return 'Attach summary.md to the release note and complete the operator sign-off checklist.';
  }

  const ownerCommandByStep: Record<string, string> = {
    'lane-visual': 'npm run verify:visual',
    'gate-release': 'npm run verify -- --goal=release-real --run',
    'lane-unified-deploy-substrate': 'npm run lane:unified-deploy:substrate',
    'lane-unified-deploy-local-kind-images': 'npm run lane:unified-deploy:local-kind:images',
    'lane-unified-deploy-local-kind': 'npm run lane:unified-deploy:local-kind',
    'lane-unified-deploy-product-flows': 'npm run lane:unified-deploy:product-flows',
    'gate-fast': 'npm run verify:quick',
    'gate-default': 'npm run verify:default',
  };
  const ownerCommand = blockedStep ? ownerCommandByStep[blockedStep] : undefined;

  if (failureClass === 'infra_setup_failure') {
    return 'Fix the local release environment, then rerun npm run release:ready.';
  }
  if (failureClass === 'environment_conflict') {
    return 'Resolve the active runtime or port conflict, then run npm run release:status before retrying npm run release:ready.';
  }
  if (failureClass === 'evidence_missing') {
    return ownerCommand
      ? `Run the owning diagnostic (${ownerCommand}), then rerun npm run release:ready.`
      : 'Run the owning diagnostic for the missing evidence, then rerun npm run release:ready.';
  }
  if (failureClass === 'contract_drift') {
    return 'Do not blindly rerun. Hand this to the governance maintainer to repair manifest/schema/evidence drift.';
  }

  return ownerCommand
    ? `Fix the product regression, run ${ownerCommand}, then rerun npm run release:ready.`
    : 'Fix the product regression, then rerun npm run release:ready.';
}

function renderReleaseSummaryMarkdown(summary: ReleaseSummary): string {
  return [
    '# AgentSmith Release Readiness Summary',
    '',
    `- automated_release_verdict: ${summary.automated_release_verdict}`,
    `- campaign_run_id: ${summary.campaign_run_id}`,
    `- campaign_root: ${summary.campaign_root}`,
    `- failure_class: ${summary.failure_class}`,
    `- blocked_step: ${summary.blocked_step ?? '<none>'}`,
    `- terminal_result: ${summary.terminal_result_path}`,
    `- manual_operator_signoff: ${summary.manual_operator_signoff}`,
    '',
    '## Why',
    '',
    summary.why,
    '',
    '## Next Action',
    '',
    summary.next_action,
    '',
  ].join('\n');
}

export function writeReleaseSummaryForCampaign(options: WriteReleaseSummaryOptions): ReleaseSummary {
  const campaignRoot = resolve(options.campaignRoot);
  assertReleaseCampaignRootNotSymlink(campaignRoot);
  const terminalPath = terminalResultPath(campaignRoot);
  const terminalResult = readTerminalResult(campaignRoot);
  const status = terminalResult.status as CurrentGateResultStatus;
  const failureClass = terminalResult.failure_class as CurrentGateResultFailureClass;
  const blockedStep = inferBlockedStep(status, terminalResult.summary as string);
  const summaryJsonPath = join(campaignRoot, 'summary.json');
  const summaryMdPath = join(campaignRoot, 'summary.md');

  const summary: ReleaseSummary = {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: basename(campaignRoot),
    campaign_root: campaignRoot,
    automated_release_verdict: status === 'passed' ? 'PASSED' : 'FAILED',
    status,
    failure_class: failureClass,
    stage: terminalResult.stage as string,
    blocked_step: blockedStep,
    why: terminalResult.summary as string,
    next_action: nextActionForFailure(failureClass, blockedStep),
    terminal_result_path: terminalPath,
    summary_json_path: summaryJsonPath,
    summary_md_path: summaryMdPath,
    evidence_package: campaignRoot,
    manual_operator_signoff: 'not_covered',
    generated_at: new Date().toISOString(),
  };

  mkdirSync(campaignRoot, { recursive: true });
  writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(summaryMdPath, renderReleaseSummaryMarkdown(summary));

  if (options.writeLatest !== false) {
    const latestPath = resolve(options.latestPath ?? defaultLatestPath());
    const gitSha = (options.resolveGitSha ?? resolveCurrentGitSha)().trim();
    if (!GIT_COMMIT_HASH_PATTERN.test(gitSha)) {
      throw new Error('release latest pointer git_sha must be a 40 or 64 character hex git commit hash.');
    }
    const latest: ReleaseLatestPointer = {
      schema: 'agentsmith_release_latest/v1',
      campaign_id: 'release-full',
      campaign_run_id: summary.campaign_run_id,
      campaign_root: campaignRoot,
      git_sha: gitSha,
      summary_json: summaryJsonPath,
      summary_md: summaryMdPath,
      terminal_result_path: terminalPath,
      generated_at: summary.generated_at,
      updated_at: summary.generated_at,
    };
    mkdirSync(dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  }

  return summary;
}

function parseLatestPointer(path: string): ReleaseLatestPointer {
  const latest = requireRecord(readJson(path), 'release latest pointer');
  assertAllowedFields(latest, RELEASE_LATEST_POINTER_KEYS, 'release latest pointer');
  if (latest.schema !== 'agentsmith_release_latest/v1') {
    throw new Error('release latest pointer schema must be agentsmith_release_latest/v1.');
  }
  if (latest.campaign_id !== 'release-full') {
    throw new Error('release latest pointer campaign_id must be release-full.');
  }
  const campaignRunId = requireNonEmptyStringField(latest, 'campaign_run_id', 'release latest pointer');
  const campaignRoot = requireNonEmptyStringField(latest, 'campaign_root', 'release latest pointer');
  requireGitCommitHash(latest, 'git_sha', 'release latest pointer');
  requireIsoTimestamp(latest, 'generated_at', 'release latest pointer');
  requireOptionalStringField(latest, 'summary_json', 'release latest pointer');
  requireOptionalStringField(latest, 'summary_md', 'release latest pointer');
  requireOptionalStringField(latest, 'terminal_result_path', 'release latest pointer');
  requireOptionalStringField(latest, 'updated_at', 'release latest pointer');
  if (campaignRunId !== basename(resolve(campaignRoot))) {
    throw new Error('release latest pointer campaign_run_id must match the campaign root basename.');
  }
  return latest as unknown as ReleaseLatestPointer;
}

function parseSummary(path: string): ReleaseSummary {
  const summary = requireRecord(readJson(path), 'release summary');
  if (summary.schema !== 'agentsmith_release_summary/v1') {
    throw new Error('release summary schema must be agentsmith_release_summary/v1.');
  }

  const stringFields = [
    'campaign_id',
    'campaign_run_id',
    'campaign_root',
    'automated_release_verdict',
    'status',
    'failure_class',
    'stage',
    'why',
    'next_action',
    'terminal_result_path',
    'summary_json_path',
    'summary_md_path',
    'evidence_package',
    'manual_operator_signoff',
    'generated_at',
  ] as const;
  for (const field of stringFields) {
    if (typeof summary[field] !== 'string' || summary[field].trim().length === 0) {
      throw new Error(`release summary cache missing required field: ${field}.`);
    }
  }
  if (summary.blocked_step !== null && typeof summary.blocked_step !== 'string') {
    throw new Error('release summary cache missing required field: blocked_step.');
  }
  if (summary.campaign_id !== 'release-full') {
    throw new Error('release summary cache campaign_id must be release-full.');
  }
  if (summary.automated_release_verdict !== 'PASSED' && summary.automated_release_verdict !== 'FAILED') {
    throw new Error('release summary cache automated_release_verdict is invalid.');
  }
  if (!CURRENT_GATE_RESULT_STATUSES.includes(summary.status as CurrentGateResultStatus)) {
    throw new Error('release summary cache status is invalid.');
  }
  if (!CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(summary.failure_class as CurrentGateResultFailureClass)) {
    throw new Error('release summary cache failure_class is invalid.');
  }
  return summary as unknown as ReleaseSummary;
}

function summaryMatchesTerminal(args: {
  campaignRoot: string;
  summaryPath: string;
  summary: ReleaseSummary;
  terminalResult: ParsedTerminalResult;
}): string | null {
  const terminalStatus = args.terminalResult.status as CurrentGateResultStatus;
  const terminalFailureClass = args.terminalResult.failure_class as CurrentGateResultFailureClass;
  const expectedVerdict = terminalStatus === 'passed' ? 'PASSED' : 'FAILED';
  const expectedBlockedStep = inferBlockedStep(terminalStatus, args.terminalResult.summary as string);
  const expectedTerminalPath = terminalResultPath(args.campaignRoot);
  const expectedNextAction = nextActionForFailure(terminalFailureClass, expectedBlockedStep);

  const checks: Array<[boolean, string]> = [
    [resolve(args.summary.campaign_root) === resolve(args.campaignRoot), 'campaign_root'],
    [args.summary.campaign_run_id === basename(resolve(args.campaignRoot)), 'campaign_run_id'],
    [args.summary.automated_release_verdict === expectedVerdict, 'automated_release_verdict'],
    [args.summary.status === terminalStatus, 'status'],
    [args.summary.failure_class === terminalFailureClass, 'failure_class'],
    [args.summary.stage === args.terminalResult.stage, 'stage'],
    [args.summary.why === args.terminalResult.summary, 'why'],
    [resolve(args.summary.terminal_result_path) === resolve(expectedTerminalPath), 'terminal_result_path'],
    [resolve(args.summary.summary_json_path) === resolve(args.summaryPath), 'summary_json_path'],
    [resolve(args.summary.evidence_package) === resolve(args.campaignRoot), 'evidence_package'],
    [args.summary.blocked_step === expectedBlockedStep, 'blocked_step'],
    [args.summary.next_action === expectedNextAction, 'next_action'],
  ];

  const failed = checks.find(([ok]) => !ok);
  return failed ? `release summary cache does not match campaign terminal result field: ${failed[1]}.` : null;
}

function readStatusFromCampaignRoot(args: {
  latestPath: string;
  campaignRoot: string;
  latest?: ReleaseLatestPointer;
}): ReleaseStatusRead {
  const campaignRoot = resolve(args.campaignRoot);
  let terminalResult: ParsedTerminalResult;
  try {
    terminalResult = readTerminalResult(campaignRoot);
  } catch (error) {
    return {
      kind: 'malformed',
      latestPath: args.latestPath,
      error: `campaign terminal result is missing or malformed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const summaryPath = resolve(args.latest?.summary_json ?? join(campaignRoot, 'summary.json'));
  if (!existsSync(summaryPath)) {
    return { kind: 'missing_summary', latestPath: args.latestPath, summaryPath };
  }

  try {
    const summary = parseSummary(summaryPath);
    if (args.latest && args.latest.campaign_run_id !== summary.campaign_run_id) {
      return {
        kind: 'malformed',
        latestPath: args.latestPath,
        error: 'release latest pointer campaign_run_id must match release summary campaign_run_id.',
      };
    }
    const mismatch = summaryMatchesTerminal({
      campaignRoot,
      summaryPath,
      summary,
      terminalResult,
    });
    if (mismatch) {
      return { kind: 'malformed', latestPath: args.latestPath, error: mismatch };
    }
    return {
      kind: 'ready',
      latestPath: args.latestPath,
      latest: args.latest,
      summary,
    };
  } catch (error) {
    return {
      kind: 'malformed',
      latestPath: args.latestPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readReleaseStatus(options: ReadReleaseStatusOptions = {}): ReleaseStatusRead {
  const latestPath = resolve(options.latestPath ?? defaultLatestPath());

  if (options.campaignRoot) {
    return readStatusFromCampaignRoot({
      latestPath,
      campaignRoot: options.campaignRoot,
    });
  }

  if (!existsSync(latestPath)) {
    return { kind: 'missing_latest', latestPath };
  }

  try {
    const latest = parseLatestPointer(latestPath);
    return readStatusFromCampaignRoot({
      latestPath,
      campaignRoot: latest.campaign_root,
      latest,
    });
  } catch (error) {
    return { kind: 'malformed', latestPath, error: error instanceof Error ? error.message : String(error) };
  }
}

export function renderReleaseStatus(status: ReleaseStatusRead): string {
  if (status.kind === 'missing_latest') {
    return [
      'AgentSmith Release Status',
      '',
      'Automated release verdict: MISSING',
      `Latest summary: not found (${status.latestPath})`,
      'Next: run npm run release:ready',
      '',
    ].join('\n');
  }

  if (status.kind === 'missing_summary') {
    return [
      'AgentSmith Release Status',
      '',
      'Automated release verdict: MISSING',
      `Summary: not found (${status.summaryPath})`,
      'Next: run npm run release:ready to produce a fresh campaign summary.',
      '',
    ].join('\n');
  }

  if (status.kind === 'malformed') {
    return [
      'AgentSmith Release Status',
      '',
      'Automated release verdict: UNKNOWN',
      `Why: ${status.error}`,
      'Next: rerun npm run release:ready after fixing the malformed summary pointer.',
      '',
    ].join('\n');
  }

  const summary = status.summary;
  return [
    'AgentSmith Release Status',
    '',
    `Automated release verdict: ${summary.automated_release_verdict}`,
    `Campaign: ${summary.campaign_run_id}`,
    `Blocked step: ${summary.blocked_step ?? '<none>'}`,
    `Why: ${summary.why}`,
    `Summary: ${summary.summary_md_path}`,
    `Evidence package: ${summary.evidence_package}`,
    `Next: ${summary.next_action}`,
    '',
  ].join('\n');
}

function parseSummaryCliArgs(argv: readonly string[]): WriteReleaseSummaryOptions {
  const options: Partial<WriteReleaseSummaryOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--campaign-root' && next) {
      options.campaignRoot = next;
      index += 1;
    } else if (arg.startsWith('--campaign-root=')) {
      options.campaignRoot = arg.slice('--campaign-root='.length);
    } else if (arg === '--latest-path' && next) {
      options.latestPath = next;
      index += 1;
    } else if (arg.startsWith('--latest-path=')) {
      options.latestPath = arg.slice('--latest-path='.length);
    } else if (arg === '--no-latest') {
      options.writeLatest = false;
    } else {
      throw new Error(`Unknown release summary argument: ${arg}`);
    }
  }

  const campaignRoot = options.campaignRoot ?? process.env.RELEASE_CAMPAIGN_ROOT;
  if (!campaignRoot?.trim()) {
    throw new Error('release summary requires --campaign-root or RELEASE_CAMPAIGN_ROOT.');
  }

  return {
    campaignRoot,
    latestPath: options.latestPath,
    writeLatest: options.writeLatest,
  };
}

function main(): void {
  try {
    const summary = writeReleaseSummaryForCampaign(parseSummaryCliArgs(process.argv.slice(2)));
    process.stdout.write(`${renderReleaseStatus({ kind: 'ready', latestPath: defaultLatestPath(), summary })}`);
  } catch (error) {
    process.stderr.write(`[release-summary] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

if (isCliEntrypoint('release-summary.ts')) {
  main();
}
