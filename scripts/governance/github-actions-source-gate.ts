import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, unknown>;

type GithubSourceGateOperation =
  | 'json_api'
  | 'artifact_zip_download';

interface GithubSourceGateCliOptions {
  argv?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface RetryClassificationInput {
  semanticFailure?: boolean;
  statusCode?: number | null;
  stderr?: string;
}

interface RetryClassificationContext {
  operation: GithubSourceGateOperation;
  metadataProvesArtifactAvailable?: boolean;
}

export interface GithubArtifactSelection {
  artifact: JsonRecord;
  artifactId: number;
  artifactName: string;
}

interface ArtifactDownloadTarget {
  name: string;
  downloadDir: string;
}

interface DownloadRunArtifactsConfig {
  repo: string;
  runId: string;
  runViewPath: string;
  runApiPath: string;
  artifactsApiPath: string;
  selectedArtifactsPath: string;
  artifacts: ArtifactDownloadTarget[];
}

interface ListSuccessfulRunsConfig {
  repo: string;
  headSha: string;
  outputPath: string;
}

class GithubCliError extends Error {
  readonly statusCode: number | null;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(message: string, input: {
    statusCode?: number | null;
    stderr?: string;
    exitCode?: number | null;
  } = {}) {
    super(message);
    this.name = 'GithubCliError';
    this.statusCode = input.statusCode ?? null;
    this.stderr = input.stderr ?? '';
    this.exitCode = input.exitCode ?? null;
  }
}

export class GithubSourceGateSemanticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubSourceGateSemanticError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readNestedString(record: JsonRecord, pathSegments: readonly string[]): string {
  let current: unknown = record;
  for (const segment of pathSegments) {
    if (!isRecord(current)) {
      return '';
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : '';
}

function readNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return Number.isSafeInteger(value) ? value : null;
}

function requirePositiveInteger(value: number | null, label: string): number {
  if (value === null || value <= 0) {
    throw new GithubSourceGateSemanticError(`${label} must be a positive integer.`);
  }

  return value;
}

function requireNonEmptyString(value: string, label: string): string {
  if (value.length === 0) {
    throw new GithubSourceGateSemanticError(`${label} is required.`);
  }

  return value;
}

function writeJson(pathName: string, value: unknown): void {
  mkdirSync(path.dirname(pathName), { recursive: true });
  writeFileSync(pathName, `${JSON.stringify(value, null, 2)}\n`);
}

function extractGithubHttpStatus(stderr: string): number | null {
  const statusMatch = stderr.match(/\b(?:HTTP|status(?: code)?)\D{0,24}([1-5][0-9]{2})\b/iu);
  if (!statusMatch) {
    return null;
  }

  const statusCode = Number(statusMatch[1]);
  return Number.isSafeInteger(statusCode) ? statusCode : null;
}

export function isRetryableGithubSourceGateFailure(
  failure: RetryClassificationInput,
  context: RetryClassificationContext,
): boolean {
  if (failure.semanticFailure === true) {
    return false;
  }

  const statusCode = failure.statusCode ?? extractGithubHttpStatus(failure.stderr ?? '');
  if (statusCode === 429 || (statusCode !== null && statusCode >= 500 && statusCode <= 599)) {
    return true;
  }

  return statusCode === 401
    && context.operation === 'artifact_zip_download'
    && context.metadataProvesArtifactAvailable === true;
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function retryDelayMs(attemptIndex: number): number {
  return attemptIndex === 0 ? 250 : 1000;
}

function withBoundedGithubRetry<T>(
  action: () => T,
  context: RetryClassificationContext,
  label: string,
  maxAttempts: number,
): T {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return action();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof GithubCliError
        && isRetryableGithubSourceGateFailure(error, context);
      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }
      sleep(retryDelayMs(attempt - 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed.`);
}

function runGhApiJson(
  route: string,
  options: { cwd: string; env: Readonly<Record<string, string | undefined>> },
): unknown {
  const result = spawnSync('gh', ['api', route], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const stderr = result.stderr.toString();

  if (result.error) {
    throw new GithubCliError(result.error.message, {
      stderr,
      exitCode: result.status,
    });
  }
  if (result.status !== 0) {
    throw new GithubCliError(`gh api ${route} failed.`, {
      statusCode: extractGithubHttpStatus(stderr),
      stderr,
      exitCode: result.status,
    });
  }

  try {
    return JSON.parse(result.stdout.toString()) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GithubSourceGateSemanticError(`gh api ${route} must return JSON: ${message}`);
  }
}

function runGhApiToFile(
  route: string,
  outputPath: string,
  options: { cwd: string; env: Readonly<Record<string, string | undefined>> },
): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const outputFd = openSync(outputPath, 'w');
  try {
    const result = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', route], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', outputFd, 'pipe'],
      encoding: 'utf8',
    });
    const stderr = result.stderr.toString();

    if (result.error) {
      rmSync(outputPath, { force: true });
      throw new GithubCliError(result.error.message, {
        stderr,
        exitCode: result.status,
      });
    }
    if (result.status !== 0) {
      rmSync(outputPath, { force: true });
      throw new GithubCliError(`gh api ${route} failed.`, {
        statusCode: extractGithubHttpStatus(stderr),
        stderr,
        exitCode: result.status,
      });
    }
  } finally {
    closeSync(outputFd);
  }
}

function ghApiJsonWithRetry(
  route: string,
  options: { cwd: string; env: Readonly<Record<string, string | undefined>> },
): unknown {
  return withBoundedGithubRetry(
    () => runGhApiJson(route, options),
    { operation: 'json_api' },
    route,
    3,
  );
}

function ghApiArtifactZipWithRetry(
  route: string,
  outputPath: string,
  options: { cwd: string; env: Readonly<Record<string, string | undefined>> },
): void {
  withBoundedGithubRetry(
    () => runGhApiToFile(route, outputPath, options),
    {
      operation: 'artifact_zip_download',
      metadataProvesArtifactAvailable: true,
    },
    route,
    3,
  );
}

function assertRunApiForDownload(runApi: unknown, input: { repo: string; runId: string }): JsonRecord {
  if (!isRecord(runApi)) {
    throw new GithubSourceGateSemanticError('run API metadata must be a JSON object.');
  }

  const expectedRunId = Number(input.runId);
  const runId = requirePositiveInteger(readNumber(runApi, 'id'), 'run_api.id');
  if (runId !== expectedRunId) {
    throw new GithubSourceGateSemanticError(`run_api.id must be ${input.runId}; actual ${runId}.`);
  }
  if (readNestedString(runApi, ['repository', 'full_name']) !== input.repo) {
    throw new GithubSourceGateSemanticError(`run_api.repository.full_name must be ${input.repo}.`);
  }
  const headRepository = readNestedString(runApi, ['head_repository', 'full_name']);
  if (headRepository && headRepository !== input.repo) {
    throw new GithubSourceGateSemanticError(`run_api.head_repository.full_name must be ${input.repo}.`);
  }
  requireNonEmptyString(readString(runApi, 'name'), 'run_api.name');
  requireNonEmptyString(readString(runApi, 'head_sha'), 'run_api.head_sha');
  requirePositiveInteger(readNumber(runApi, 'run_attempt'), 'run_api.run_attempt');
  if (readString(runApi, 'status') !== 'completed' || readString(runApi, 'conclusion') !== 'success') {
    throw new GithubSourceGateSemanticError(
      `run_api must be completed/success; actual status=${readString(runApi, 'status') || '<missing>'} conclusion=${readString(runApi, 'conclusion') || '<missing>'}.`,
    );
  }

  return runApi;
}

function buildRunViewFromRunApi(runApi: JsonRecord): JsonRecord {
  return {
    conclusion: readString(runApi, 'conclusion'),
    databaseId: readNumber(runApi, 'id'),
    headSha: readString(runApi, 'head_sha'),
    status: readString(runApi, 'status'),
    url: readString(runApi, 'html_url'),
    workflowName: readString(runApi, 'name'),
  };
}

export function selectExactRunArtifact(input: {
  artifactsApi: unknown;
  artifactName: string;
  runId: string;
  headSha: string;
}): GithubArtifactSelection {
  if (!isRecord(input.artifactsApi)) {
    throw new GithubSourceGateSemanticError('artifacts API metadata must be a JSON object.');
  }
  if (!Array.isArray(input.artifactsApi.artifacts)) {
    throw new GithubSourceGateSemanticError('artifacts_api.artifacts must be a JSON array.');
  }

  const artifacts = input.artifactsApi.artifacts.filter(isRecord);
  const matches = artifacts.filter((artifact) => artifact.name === input.artifactName);
  if (matches.length !== 1) {
    throw new GithubSourceGateSemanticError(
      `expected exactly one ${input.artifactName} artifact; found ${matches.length}.`,
    );
  }

  const artifact = matches[0];
  const artifactId = requirePositiveInteger(readNumber(artifact, 'id'), `${input.artifactName}.id`);
  if (artifact.expired !== false) {
    throw new GithubSourceGateSemanticError(`${input.artifactName} artifact must not be expired.`);
  }
  requireNonEmptyString(readString(artifact, 'url'), `${input.artifactName}.url`);
  requireNonEmptyString(readString(artifact, 'expires_at'), `${input.artifactName}.expires_at`);

  const workflowRun = artifact.workflow_run;
  if (!isRecord(workflowRun)) {
    throw new GithubSourceGateSemanticError(`${input.artifactName}.workflow_run must be a JSON object.`);
  }
  const workflowRunId = readNumber(workflowRun, 'id') ?? readNumber(workflowRun, 'run_id');
  if (workflowRunId !== Number(input.runId)) {
    throw new GithubSourceGateSemanticError(
      `${input.artifactName}.workflow_run.id must be ${input.runId}; actual ${workflowRunId ?? '<missing>'}.`,
    );
  }
  if (readString(workflowRun, 'head_sha') !== input.headSha) {
    throw new GithubSourceGateSemanticError(
      `${input.artifactName}.workflow_run.head_sha must be ${input.headSha}; actual ${readString(workflowRun, 'head_sha') || '<missing>'}.`,
    );
  }

  return {
    artifact,
    artifactId,
    artifactName: input.artifactName,
  };
}

export function selectSuccessfulWorkflowRunsByHeadSha(input: {
  runsApi: unknown;
  headSha: string;
}): JsonRecord[] {
  if (!isRecord(input.runsApi)) {
    throw new GithubSourceGateSemanticError('workflow runs API response must be a JSON object.');
  }
  if (!Array.isArray(input.runsApi.workflow_runs)) {
    throw new GithubSourceGateSemanticError('workflow runs API response must include workflow_runs array.');
  }

  return input.runsApi.workflow_runs
    .filter(isRecord)
    .filter((run) => {
      const runId = readNumber(run, 'id');
      return readString(run, 'head_sha') === input.headSha
        && readString(run, 'status') === 'completed'
        && readString(run, 'conclusion') === 'success'
        && runId !== null
        && runId > 0;
    })
    .map((run) => ({
      conclusion: readString(run, 'conclusion'),
      databaseId: readNumber(run, 'id'),
      headSha: readString(run, 'head_sha'),
      status: readString(run, 'status'),
      url: readString(run, 'html_url'),
      workflowName: readString(run, 'name'),
    }));
}

function safeArtifactFileName(name: string): string {
  return name.replace(/[^0-9A-Za-z_.-]+/gu, '_');
}

function parseZipEntryList(entryList: string): string[] {
  const normalized = entryList.endsWith('\n') ? entryList.slice(0, -1) : entryList;
  return normalized.length === 0 ? [] : normalized.split('\n');
}

function readZipCentralDirectoryEntryCount(verboseListing: string): number | null {
  const match = verboseListing.match(/\bcentral directory contains\s+([0-9]+)\s+entr(?:y|ies)\./iu);
  if (!match) {
    return null;
  }

  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function assertSafeZipEntryName(entry: string): void {
  if (entry.length === 0) {
    throw new GithubSourceGateSemanticError('artifact zip entry must not be empty.');
  }
  if (entry.includes('\0') || entry.includes('\r')) {
    throw new GithubSourceGateSemanticError(`artifact zip entry has unsupported control characters: ${entry}`);
  }
  if (entry.startsWith('/')) {
    throw new GithubSourceGateSemanticError(`artifact zip entry must be a relative path: ${entry}`);
  }
  if (/^[A-Za-z]:/u.test(entry)) {
    throw new GithubSourceGateSemanticError(`artifact zip entry must not use a Windows drive path: ${entry}`);
  }
  if (entry.includes('\\')) {
    throw new GithubSourceGateSemanticError(`artifact zip entry must not use Windows path separators: ${entry}`);
  }
  if (entry.split('/').includes('..')) {
    throw new GithubSourceGateSemanticError(`artifact zip entry must not include '..' path segments: ${entry}`);
  }
}

function isZipSymlinkAttributeLine(line: string): boolean {
  const match = line.match(/^\s*Unix file attributes \(([0-7]+) octal\):\s*(\S*)/u);
  if (!match) {
    return false;
  }

  const mode = Number.parseInt(match[1], 8);
  return match[2].startsWith('l') || (mode & 0o170000) === 0o120000;
}

export function assertSafeArtifactZipMetadata(input: {
  entryList: string;
  verboseListing: string;
}): void {
  const entries = parseZipEntryList(input.entryList);
  const expectedEntryCount = readZipCentralDirectoryEntryCount(input.verboseListing);
  if (expectedEntryCount === null) {
    throw new GithubSourceGateSemanticError('artifact zip metadata must include central directory entry count.');
  }
  if (entries.length !== expectedEntryCount) {
    throw new GithubSourceGateSemanticError(
      `artifact zip entry listing count must match central directory metadata; listed ${entries.length}, expected ${expectedEntryCount}.`,
    );
  }
  if (entries.length === 0) {
    throw new GithubSourceGateSemanticError('artifact zip must contain at least one entry.');
  }

  for (const entry of entries) {
    assertSafeZipEntryName(entry);
  }
  if (input.verboseListing.split('\n').some(isZipSymlinkAttributeLine)) {
    throw new GithubSourceGateSemanticError('artifact zip entries must not be symlinks.');
  }
}

function assertSafeArtifactZip(zipPath: string, cwd: string): void {
  const entryList = execFileSync('unzip', ['-Z1', zipPath], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: 'pipe',
  });
  const verboseListing = execFileSync('unzip', ['-Z', '-v', zipPath], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: 'pipe',
  });
  assertSafeArtifactZipMetadata({ entryList, verboseListing });
}

function unzipArtifact(zipPath: string, downloadDir: string, cwd: string): void {
  assertSafeArtifactZip(zipPath, cwd);
  rmSync(downloadDir, { recursive: true, force: true });
  mkdirSync(downloadDir, { recursive: true });
  execFileSync('unzip', ['-q', zipPath, '-d', downloadDir], {
    cwd,
    stdio: 'pipe',
  });
}

function runDownloadRunArtifacts(
  config: DownloadRunArtifactsConfig,
  options: GithubSourceGateCliOptions,
): void {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  if (!/^[0-9]+$/u.test(config.runId)) {
    throw new GithubSourceGateSemanticError('run id must be a GitHub Actions numeric run id.');
  }
  if (config.artifacts.length === 0) {
    throw new GithubSourceGateSemanticError('at least one artifact target is required.');
  }

  const runApi = assertRunApiForDownload(
    ghApiJsonWithRetry(`repos/${config.repo}/actions/runs/${config.runId}`, { cwd, env }),
    {
      repo: config.repo,
      runId: config.runId,
    },
  );
  const artifactsApi = ghApiJsonWithRetry(
    `repos/${config.repo}/actions/runs/${config.runId}/artifacts?per_page=100`,
    { cwd, env },
  );
  const headSha = readString(runApi, 'head_sha');
  const selected = config.artifacts.map((target) => ({
    ...target,
    ...selectExactRunArtifact({
      artifactsApi,
      artifactName: target.name,
      runId: config.runId,
      headSha,
    }),
  }));

  writeJson(config.runApiPath, runApi);
  writeJson(config.runViewPath, buildRunViewFromRunApi(runApi));
  writeJson(config.artifactsApiPath, artifactsApi);
  writeJson(config.selectedArtifactsPath, {
    repo: config.repo,
    run_id: config.runId,
    head_sha: headSha,
    artifacts: selected.map((selection) => ({
      name: selection.artifactName,
      id: selection.artifactId,
      expired: selection.artifact.expired,
      expires_at: selection.artifact.expires_at,
      url: selection.artifact.url,
      archive_download_url: selection.artifact.archive_download_url,
      workflow_run: selection.artifact.workflow_run,
      download_dir: selection.downloadDir,
    })),
  });

  const zipDir = path.join(path.dirname(config.artifactsApiPath), 'artifact-zips');
  mkdirSync(zipDir, { recursive: true });
  for (const selection of selected) {
    const zipPath = path.join(zipDir, `${safeArtifactFileName(selection.artifactName)}-${selection.artifactId}.zip`);
    ghApiArtifactZipWithRetry(
      `repos/${config.repo}/actions/artifacts/${selection.artifactId}/zip`,
      zipPath,
      { cwd, env },
    );
    unzipArtifact(zipPath, selection.downloadDir, cwd);
    rmSync(zipPath, { force: true });
    options.stdout?.(`downloaded ${selection.artifactName} artifact id ${selection.artifactId}`);
  }
}

function runListSuccessfulRuns(
  config: ListSuccessfulRunsConfig,
  options: GithubSourceGateCliOptions,
): void {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  if (!/^[0-9a-f]{40}$/u.test(config.headSha)) {
    throw new GithubSourceGateSemanticError('head sha must be a 40-character lowercase git commit sha.');
  }

  const runsApi = ghApiJsonWithRetry(
    `repos/${config.repo}/actions/runs?head_sha=${config.headSha}&per_page=20`,
    { cwd, env },
  );
  const matches = selectSuccessfulWorkflowRunsByHeadSha({
    runsApi,
    headSha: config.headSha,
  });
  writeJson(config.outputPath, matches);
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new GithubSourceGateSemanticError(`${argv[index]} requires a value.`);
  }

  return value;
}

function parseArtifactTarget(raw: string): ArtifactDownloadTarget {
  const separatorIndex = raw.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new GithubSourceGateSemanticError('--artifact must be formatted as <artifact-name>=<download-dir>.');
  }

  return {
    name: raw.slice(0, separatorIndex),
    downloadDir: raw.slice(separatorIndex + 1),
  };
}

function parseDownloadRunArtifactsConfig(argv: readonly string[]): DownloadRunArtifactsConfig {
  let repo = '';
  let runId = '';
  let runViewPath = '';
  let runApiPath = '';
  let artifactsApiPath = '';
  let selectedArtifactsPath = '';
  const artifacts: ArtifactDownloadTarget[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--repo':
        repo = requireArgValue(argv, index);
        index += 1;
        break;
      case '--run-id':
        runId = requireArgValue(argv, index);
        index += 1;
        break;
      case '--run-view-path':
        runViewPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--run-api-path':
        runApiPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--artifacts-api-path':
        artifactsApiPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--selected-artifacts-path':
        selectedArtifactsPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--artifact':
        artifacts.push(parseArtifactTarget(requireArgValue(argv, index)));
        index += 1;
        break;
      default:
        throw new GithubSourceGateSemanticError(`unsupported download-run-artifacts argument: ${arg}`);
    }
  }

  for (const [label, value] of [
    ['--repo', repo],
    ['--run-id', runId],
    ['--run-view-path', runViewPath],
    ['--run-api-path', runApiPath],
    ['--artifacts-api-path', artifactsApiPath],
    ['--selected-artifacts-path', selectedArtifactsPath],
  ] as const) {
    if (value.length === 0) {
      throw new GithubSourceGateSemanticError(`${label} is required.`);
    }
  }

  return {
    repo,
    runId,
    runViewPath,
    runApiPath,
    artifactsApiPath,
    selectedArtifactsPath,
    artifacts,
  };
}

function parseListSuccessfulRunsConfig(argv: readonly string[]): ListSuccessfulRunsConfig {
  let repo = '';
  let headSha = '';
  let outputPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--repo':
        repo = requireArgValue(argv, index);
        index += 1;
        break;
      case '--head-sha':
        headSha = requireArgValue(argv, index);
        index += 1;
        break;
      case '--output':
        outputPath = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new GithubSourceGateSemanticError(`unsupported list-successful-runs argument: ${arg}`);
    }
  }

  for (const [label, value] of [
    ['--repo', repo],
    ['--head-sha', headSha],
    ['--output', outputPath],
  ] as const) {
    if (value.length === 0) {
      throw new GithubSourceGateSemanticError(`${label} is required.`);
    }
  }

  return {
    repo,
    headSha,
    outputPath,
  };
}

function formatError(error: unknown): string {
  if (error instanceof GithubCliError && error.stderr.trim().length > 0) {
    return `${error.message}\n${error.stderr.trim()}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function runGithubActionsSourceGateCli(options: GithubSourceGateCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const stderr = options.stderr ?? ((message: string) => {
    console.error(message);
  });
  const stdout = options.stdout ?? ((message: string) => {
    console.log(message);
  });
  const [command, ...commandArgv] = argv;

  try {
    if (command === 'download-run-artifacts') {
      runDownloadRunArtifacts(parseDownloadRunArtifactsConfig(commandArgv), {
        ...options,
        stdout,
        stderr,
      });
      return 0;
    }
    if (command === 'list-successful-runs') {
      runListSuccessfulRuns(parseListSuccessfulRunsConfig(commandArgv), {
        ...options,
        stdout,
        stderr,
      });
      return 0;
    }

    throw new GithubSourceGateSemanticError(
      'usage: github-actions-source-gate.ts <download-run-artifacts|list-successful-runs> [options]',
    );
  } catch (error) {
    stderr(`GitHub Actions source gate failed: ${formatError(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runGithubActionsSourceGateCli());
}
