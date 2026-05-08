import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import {
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import type {
  CurrentVerificationCampaignEvidenceCheck,
  CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';
import {
  findCurrentReleaseCampaignEvidenceArtifact,
  type CurrentGateUxTraceExpectedMembership,
} from './current-gate-manifest';
import {
  parseVisualBaselineBuildRecord,
} from '../../e2e/visual-baseline-support';
import {
  UX_TRACE_INDEX_FILE,
  validateUxTraceBundleArtifact,
} from '../../e2e/trace-bundle-support';

export interface ReleaseCampaignResultInput {
  step: CurrentVerificationCampaignStep;
  campaignRoot: string;
  status: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  stage: string;
  summary: string;
}

export interface ReleaseCampaignEvidencePathRecord {
  id: string;
  path: string;
  kind: string;
  exists: boolean;
  matches?: readonly string[];
  min_count?: number;
  error?: string;
  failure_class?: CurrentGateResultFailureClass;
}

export interface ReleaseCampaignEvidencePointer {
  schema_version: string;
  step_id: string;
  gate_id: string;
  evidence_topology: 'campaign_root';
  campaign_root: string;
  evidence_dir: string;
  native_result: {
    path: string;
    exists: boolean;
    gate_id: string | null;
    status: string | null;
    failure_class: string | null;
    error?: string;
  } | null;
  required_paths: readonly ReleaseCampaignEvidencePathRecord[];
  generated_at: string;
}

export function buildReleaseCampaignEvidencePathRecord(
  input: ReleaseCampaignEvidencePathRecord,
): ReleaseCampaignEvidencePathRecord {
  return {
    id: input.id,
    path: input.path,
    kind: input.kind,
    exists: input.exists,
    ...(input.matches ? { matches: input.matches } : {}),
    ...(input.min_count !== undefined ? { min_count: input.min_count } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.failure_class ? { failure_class: input.failure_class } : {}),
  };
}

export interface ParsedGateResult {
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

export interface SafeGateResultRead {
  ok: boolean;
  value?: ParsedGateResult;
  error?: string;
}

const RELEASE_CAMPAIGN_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const DEFAULT_RELEASE_RUNS_ROOT = join('artifacts', 'release-runs');

export function assertSafeReleaseCampaignRunId(
  value: string | undefined,
  label = 'RELEASE_CAMPAIGN_RUN_ID',
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid ${label}: must be a non-empty safe basename id.`);
  }
  if (
    value !== value.trim()
    || /\s/u.test(value)
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || value.includes('..')
    || !RELEASE_CAMPAIGN_RUN_ID_PATTERN.test(value)
  ) {
    throw new Error(
      `invalid ${label}: must be a safe basename id using only letters, numbers, "-" or "_".`,
    );
  }
  return value;
}

function releaseCampaignRunIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.RELEASE_CAMPAIGN_RUN_ID !== undefined
    ? assertSafeReleaseCampaignRunId(env.RELEASE_CAMPAIGN_RUN_ID)
    : null;
}

export function resolveReleaseRunsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.RELEASE_RUNS_ROOT?.trim() || DEFAULT_RELEASE_RUNS_ROOT);
}

function directoryStatIfExists(targetPath: string, label: string): ReturnType<typeof lstatSync> | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(targetPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${targetPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${targetPath}`);
  }
  return stat;
}

function assertDirectoryIsNotSymlinkIfExists(targetPath: string, label: string): void {
  directoryStatIfExists(targetPath, label);
}

function symlinkInspectionAnchorFor(targetPath: string): string {
  const cwd = resolve(process.cwd());
  const absoluteTarget = resolve(targetPath);
  return isPathAtOrUnderRoot(cwd, absoluteTarget) ? cwd : parse(absoluteTarget).root;
}

function assertNoSymlinkSegmentsBetween(anchorPath: string, targetPath: string, label: string): void {
  const absoluteAnchor = resolve(anchorPath);
  const absoluteTarget = resolve(targetPath);
  if (!isPathAtOrUnderRoot(absoluteAnchor, absoluteTarget)) {
    throw new Error(`${label} must stay under symlink inspection anchor: ${absoluteTarget}`);
  }

  assertDirectoryIsNotSymlinkIfExists(absoluteAnchor, `${label} anchor`);
  const relativePath = relative(absoluteAnchor, absoluteTarget);
  if (relativePath === '') {
    return;
  }

  let currentPath = absoluteAnchor;
  for (const segment of relativePath.split(/[\\/]+/u)) {
    currentPath = join(currentPath, segment);
    if (!directoryStatIfExists(currentPath, label)) {
      return;
    }
  }
}

function assertNoSymlinkSegmentsUnderRoot(rootPath: string, targetPath: string, label: string): void {
  const absoluteRoot = resolve(rootPath);
  const absoluteTarget = resolve(targetPath);
  if (!isPathAtOrUnderRoot(absoluteRoot, absoluteTarget)) {
    throw new Error(`${label} must stay under release runs root: ${absoluteTarget}`);
  }

  assertNoSymlinkSegmentsBetween(symlinkInspectionAnchorFor(absoluteRoot), absoluteTarget, label);
}

function assertNoSymlinkSegmentsToPath(targetPath: string, label: string): void {
  const absoluteTarget = resolve(targetPath);
  assertNoSymlinkSegmentsBetween(symlinkInspectionAnchorFor(absoluteTarget), absoluteTarget, label);
}

function assertRealpathUnderReleaseRunsRoot(releaseRunsRoot: string, campaignRoot: string): void {
  const realReleaseRunsRoot = realpathSync(releaseRunsRoot);
  const realCampaignRoot = realpathSync(campaignRoot);
  if (!isPathAtOrUnderRoot(realReleaseRunsRoot, realCampaignRoot)) {
    throw new Error(`release campaign root realpath must stay under release runs root: ${campaignRoot}`);
  }
}

export function resolveDefaultReleaseCampaignRoot(
  campaignRunId: string,
  options: { releaseRunsRoot?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const safeRunId = assertSafeReleaseCampaignRunId(campaignRunId);
  const releaseRunsRoot = resolve(options.releaseRunsRoot ?? resolveReleaseRunsRoot(options.env));
  const campaignRoot = join(releaseRunsRoot, safeRunId);
  assertNoSymlinkSegmentsUnderRoot(releaseRunsRoot, campaignRoot, 'release campaign root');
  if (existsSync(releaseRunsRoot) && existsSync(campaignRoot)) {
    assertRealpathUnderReleaseRunsRoot(releaseRunsRoot, campaignRoot);
  }
  return campaignRoot;
}

export function prepareDefaultReleaseCampaignRoot(
  campaignRunId: string,
  options: { releaseRunsRoot?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const releaseRunsRoot = resolve(options.releaseRunsRoot ?? resolveReleaseRunsRoot(options.env));
  const campaignRoot = resolveDefaultReleaseCampaignRoot(campaignRunId, { releaseRunsRoot });
  assertNoSymlinkSegmentsUnderRoot(releaseRunsRoot, campaignRoot, 'release campaign root');
  mkdirSync(campaignRoot, { recursive: true });
  assertNoSymlinkSegmentsUnderRoot(releaseRunsRoot, campaignRoot, 'release campaign root');
  assertRealpathUnderReleaseRunsRoot(releaseRunsRoot, campaignRoot);
  return campaignRoot;
}

export function assertReleaseCampaignRootNotSymlink(
  campaignRoot: string,
  label = 'release campaign root',
): void {
  assertNoSymlinkSegmentsToPath(campaignRoot, label);
}

function prepareCampaignChildDirectory(campaignRoot: string, targetDir: string, label: string): string {
  const absoluteCampaignRoot = resolve(campaignRoot);
  const absoluteTargetDir = resolve(targetDir);
  if (!isPathAtOrUnderRoot(absoluteCampaignRoot, absoluteTargetDir)) {
    throw new Error(`${label} must stay under release campaign root: ${absoluteTargetDir}`);
  }

  assertNoSymlinkSegmentsBetween(absoluteCampaignRoot, absoluteTargetDir, label);
  mkdirSync(absoluteTargetDir, { recursive: true });
  assertNoSymlinkSegmentsBetween(absoluteCampaignRoot, absoluteTargetDir, label);

  const realCampaignRoot = realpathSync(absoluteCampaignRoot);
  const realTargetDir = realpathSync(absoluteTargetDir);
  if (!isPathAtOrUnderRoot(realCampaignRoot, realTargetDir)) {
    throw new Error(`${label} realpath must stay under release campaign root: ${absoluteTargetDir}`);
  }

  return absoluteTargetDir;
}

export function prepareReleaseCampaignRootForWrite(input: {
  campaignRoot: string;
  runId: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const safeRunId = assertSafeReleaseCampaignRunId(input.runId);
  const releaseRunsRoot = resolveReleaseRunsRoot(input.env);
  const defaultCampaignRoot = join(releaseRunsRoot, safeRunId);
  const campaignRoot = resolve(input.campaignRoot);

  if (campaignRoot === defaultCampaignRoot) {
    return prepareDefaultReleaseCampaignRoot(safeRunId, { releaseRunsRoot });
  }

  assertReleaseCampaignRootNotSymlink(campaignRoot);
  mkdirSync(campaignRoot, { recursive: true });
  assertReleaseCampaignRootNotSymlink(campaignRoot);
  return campaignRoot;
}

export function resolveCampaignRoot(campaignRunId: string): string {
  releaseCampaignRunIdFromEnv();
  if (process.env.RELEASE_CAMPAIGN_ROOT?.trim()) {
    return resolve(process.env.RELEASE_CAMPAIGN_ROOT);
  }
  return resolveDefaultReleaseCampaignRoot(campaignRunId);
}

export function resolveExistingCampaignRoot(): string {
  const envRunId = releaseCampaignRunIdFromEnv();
  if (process.env.RELEASE_CAMPAIGN_ROOT?.trim()) {
    const campaignRoot = resolve(process.env.RELEASE_CAMPAIGN_ROOT);
    assertReleaseCampaignRootNotSymlink(campaignRoot);
    return campaignRoot;
  }
  if (envRunId) {
    return resolveDefaultReleaseCampaignRoot(envRunId);
  }
  if (process.env.RELEASE_CAMPAIGN_USE_LATEST !== 'true') {
    throw new Error(
      'gate:release:full requires RELEASE_CAMPAIGN_ROOT or RELEASE_CAMPAIGN_RUN_ID. '
        + 'Run npm run release:campaign:full for release verification; set RELEASE_CAMPAIGN_USE_LATEST=true only for diagnostics.',
    );
  }

  const releaseRunsRoot = resolveReleaseRunsRoot();
  assertNoSymlinkSegmentsBetween(
    symlinkInspectionAnchorFor(releaseRunsRoot),
    releaseRunsRoot,
    'release runs root',
  );
  if (!existsSync(releaseRunsRoot)) {
    throw new Error('No release campaign root found. Run npm run release:campaign:full first, or set RELEASE_CAMPAIGN_ROOT.');
  }
  assertDirectoryIsNotSymlinkIfExists(releaseRunsRoot, 'release runs root');

  const candidates = readdirSync(releaseRunsRoot)
    .map((entry) => join(releaseRunsRoot, entry))
    .filter((entry) => {
      try {
        assertSafeReleaseCampaignRunId(basename(entry), 'release campaign run directory');
        return lstatSync(entry).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => lstatSync(right).mtimeMs - lstatSync(left).mtimeMs);

  if (!candidates[0]) {
    throw new Error('No release campaign run directory found under artifacts/release-runs.');
  }
  return resolveDefaultReleaseCampaignRoot(basename(candidates[0]), { releaseRunsRoot });
}

export function resolveCampaignRunId(campaignRoot: string): string {
  return releaseCampaignRunIdFromEnv()
    ?? assertSafeReleaseCampaignRunId(basename(resolve(campaignRoot)), 'campaign root basename');
}

export function stepDir(campaignRoot: string, step: CurrentVerificationCampaignStep): string {
  return join(campaignRoot, step.id);
}

export function resultPath(campaignRoot: string, step: CurrentVerificationCampaignStep): string {
  return join(stepDir(campaignRoot, step), 'result.json');
}

export function evidencePointerPath(campaignRoot: string, step: CurrentVerificationCampaignStep): string {
  return join(stepDir(campaignRoot, step), 'evidence.json');
}

export function materializeCampaignPath(campaignRoot: string, path: string): string {
  const runId = resolveCampaignRunId(campaignRoot);
  const replaced = path
    .replaceAll('<campaign-root>', campaignRoot)
    .replaceAll('<campaign-run-id>', runId);
  return replaced.startsWith('/') ? replaced : resolve(replaced);
}

export function materializeEvidenceHints(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
): readonly string[] {
  return step.evidenceHints.map((hint) => {
    if (hint.includes('<visual-scenario-id>')) {
      return materializeCampaignPath(campaignRoot, hint.replaceAll('<visual-scenario-id>', '*'));
    }
    return materializeCampaignPath(campaignRoot, hint);
  });
}

function readDirectoryEntries(path: string): readonly string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function listRecursiveFiles(root: string): readonly string[] {
  if (!existsSync(root)) {
    return [];
  }
  try {
    if (!lstatSync(root).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readDirectoryEntries(dir)) {
      const path = join(dir, entry);
      try {
        const stats = lstatSync(path);
        if (stats.isDirectory()) {
          visit(path);
          continue;
        }
        if (stats.isFile()) {
          files.push(path);
        }
      } catch {
        // Evidence verification is conservative: unreadable paths simply do not count as matches.
      }
    }
  };
  visit(root);
  return files;
}

function matchesFileName(path: string, fileName: string): boolean {
  if (fileName.startsWith('.')) {
    return path.endsWith(fileName);
  }
  return basename(path) === fileName;
}

function readMarkdownMetadata(markdown: string): Map<string, string> {
  const metadata = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    const match = /^-\s+([a-z_]+):\s*(.*)$/.exec(line);
    if (match) {
      metadata.set(match[1], match[2].trim());
    }
  }
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredMetadata(
  metadata: Map<string, string>,
  field: string,
): string | null {
  const value = metadata.get(field);
  if (!value || value === '<none>') {
    return null;
  }
  return value;
}

function visualReviewValidationFailure(
  failureClass: CurrentGateResultFailureClass,
  message: string,
): { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  return {
    ok: false,
    failureClass,
    message,
  };
}

function collectMissingMetadata(
  metadata: Map<string, string>,
  fields: readonly string[],
): string[] {
  return fields.filter((field) => !requiredMetadata(metadata, field));
}

function requireMetadataFields(args: {
  metadata: Map<string, string>;
  scenarioId: string;
  fields: readonly string[];
  artifactLabel: string;
  label: string;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const missing = collectMissingMetadata(args.metadata, args.fields);
  if (missing.length > 0) {
    return visualReviewValidationFailure(
      'contract_drift',
      `${args.artifactLabel} metadata for ${args.scenarioId} must include ${args.label}: ${missing.join(', ')}.`,
    );
  }
  return { ok: true };
}

function parseSha256HashMap(value: string | null): { ok: true; hashes: Map<string, string> } | { ok: false; message: string } {
  if (!value) {
    return {
      ok: false,
      message: 'missing hash metadata',
    };
  }
  const hashes = new Map<string, string>();
  for (const segment of value.split(';')) {
    const normalized = segment.trim();
    if (!normalized) {
      continue;
    }
    const match = /^([^=]+)=sha256:([a-f0-9]{64})$/.exec(normalized);
    if (!match) {
      return {
        ok: false,
        message: `malformed hash entry: ${normalized}`,
      };
    }
    hashes.set(match[1], match[2]);
  }
  return { ok: true, hashes };
}

function normalizeVisualBaselineManifestUrlPath(value: string): string {
  const parsed = new URL(value, 'http://agentsmith.visual.local');
  return `${parsed.pathname}${parsed.search}`;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSafeRelativeFilePath(value: string): boolean {
  return Boolean(value.trim())
    && !value.startsWith('..')
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

type VisualRunManifestScreenshotRecord = {
  fileName: string;
  actualRelPath: string;
  actualSha256: string;
  baselineSha256: string;
};

type VisualRunManifestScenarioRecord = {
  scenarioId: string;
  actualUrl: string;
  storyFingerprint: string;
  screenshots: readonly VisualRunManifestScreenshotRecord[];
};

type VisualRunManifestCoverageScope = 'full_catalog' | 'partial_catalog';

type VisualRunManifestCoverageRecord = {
  scope: VisualRunManifestCoverageScope;
  expectedScenarioIds: readonly string[];
  capturedScenarioIds: readonly string[];
};

type VisualRunManifestSnapshot = {
  path: string;
  runId: string;
  build: ReturnType<typeof parseVisualBaselineBuildRecord>;
  coverage: VisualRunManifestCoverageRecord;
  scenarios: readonly VisualRunManifestScenarioRecord[];
};

export type VisualRunManifestCompletenessRequirement = 'allow_partial' | 'require_full_catalog';

function resolveVisualRunManifestPath(campaignRoot: string): string {
  return join(
    campaignRoot,
    'lane-visual',
    'visual-baseline-reviews',
    resolveCampaignRunId(campaignRoot),
    'run-manifest.json',
  );
}

function parseUniqueScenarioIdList(
  value: unknown,
  sourceLabel: string,
): { ok: true; values: readonly string[] } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return visualReviewValidationFailure(
      'contract_drift',
      `${sourceLabel} must be a non-empty string array.`,
    );
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${sourceLabel} must contain only non-empty scenario ids.`,
      );
    }
    if (seen.has(entry)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${sourceLabel} must not include duplicate scenario ids.`,
      );
    }
    seen.add(entry);
    values.push(entry);
  }

  return {
    ok: true,
    values: [...values].sort((left, right) => left.localeCompare(right)),
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseVisualRunManifestCoverage(args: {
  coverage: unknown;
  scenarioIds: readonly string[];
  path: string;
  requiredCompleteness: VisualRunManifestCompletenessRequirement;
}): { ok: true; coverage: VisualRunManifestCoverageRecord } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  if (!isRecord(args.coverage)) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual run-manifest.json at ${args.path} must include coverage { scope, expected_scenario_ids, captured_scenario_ids }.`,
    );
  }

  const scope = args.coverage.scope;
  if (scope !== 'full_catalog' && scope !== 'partial_catalog') {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual run-manifest.json at ${args.path} must define coverage.scope as full_catalog or partial_catalog.`,
    );
  }

  const expectedIds = parseUniqueScenarioIdList(
    args.coverage.expected_scenario_ids,
    `visual run-manifest.json coverage.expected_scenario_ids at ${args.path}`,
  );
  if (!expectedIds.ok) {
    return expectedIds;
  }
  const capturedIds = parseUniqueScenarioIdList(
    args.coverage.captured_scenario_ids,
    `visual run-manifest.json coverage.captured_scenario_ids at ${args.path}`,
  );
  if (!capturedIds.ok) {
    return capturedIds;
  }

  const scenarioIds = [...args.scenarioIds].sort((left, right) => left.localeCompare(right));
  if (!arraysEqual(capturedIds.values, scenarioIds)) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual run-manifest.json at ${args.path} must bind coverage.captured_scenario_ids to scenarios[].`,
    );
  }

  const expectedScenarioIdSet = new Set(expectedIds.values);
  for (const scenarioId of capturedIds.values) {
    if (!expectedScenarioIdSet.has(scenarioId)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${args.path} must keep coverage.captured_scenario_ids within coverage.expected_scenario_ids.`,
      );
    }
  }

  const isFullCatalog = arraysEqual(expectedIds.values, capturedIds.values);
  if (scope === 'full_catalog' && !isFullCatalog) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual run-manifest.json at ${args.path} cannot declare coverage.scope=full_catalog unless every expected scenario was captured.`,
    );
  }
  if (scope === 'partial_catalog' && isFullCatalog) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual run-manifest.json at ${args.path} must declare coverage.scope=full_catalog when it captures the full catalog.`,
    );
  }
  if (args.requiredCompleteness === 'require_full_catalog' && scope !== 'full_catalog') {
    return visualReviewValidationFailure(
      'evidence_missing',
      `visual run-manifest.json at ${args.path} must declare full catalog coverage for release-grade evidence.`,
    );
  }

  return {
    ok: true,
    coverage: {
      scope,
      expectedScenarioIds: expectedIds.values,
      capturedScenarioIds: capturedIds.values,
    },
  };
}

function parseVisualRunManifestScreenshotEntries(args: {
  scenarioId: string;
  screenshots: unknown;
  path: string;
}): { ok: true; screenshots: readonly VisualRunManifestScreenshotRecord[] } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  if (!Array.isArray(args.screenshots) || args.screenshots.length === 0) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual run-manifest.json for ${args.scenarioId} at ${args.path} must include screenshots[].`,
    );
  }

  const runRoot = dirname(args.path);
  const seenFiles = new Set<string>();
  const parsedScreenshots: VisualRunManifestScreenshotRecord[] = [];

  for (const screenshot of args.screenshots) {
    if (!isRecord(screenshot)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json for ${args.scenarioId} at ${args.path} includes a malformed screenshot entry.`,
      );
    }

    const fileName = typeof screenshot.file_name === 'string' ? screenshot.file_name : null;
    const actualRelPath = typeof screenshot.actual_relpath === 'string' ? screenshot.actual_relpath : null;
    const actualSha256 = typeof screenshot.actual_sha256 === 'string' ? screenshot.actual_sha256 : null;
    const baselineSha256 = typeof screenshot.baseline_sha256 === 'string' ? screenshot.baseline_sha256 : null;

    if (!fileName || !actualRelPath || !actualSha256 || !baselineSha256) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json for ${args.scenarioId} at ${args.path} must include file_name, actual_relpath, actual_sha256, and baseline_sha256 for every screenshot.`,
      );
    }
    if (seenFiles.has(fileName)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json for ${args.scenarioId} at ${args.path} includes duplicate screenshot ${fileName}.`,
      );
    }
    if (!isSafeRelativeFilePath(actualRelPath)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json for ${args.scenarioId} at ${args.path} includes unsafe actual_relpath for ${fileName}.`,
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(actualSha256) || !/^sha256:[a-f0-9]{64}$/.test(baselineSha256)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json for ${args.scenarioId} at ${args.path} must use sha256:<hex> screenshot hashes.`,
      );
    }

    const actualPath = join(runRoot, actualRelPath);
    try {
      if (!statSync(actualPath).isFile()) {
        return visualReviewValidationFailure(
          'evidence_missing',
          `visual run-manifest.json actual capture for ${args.scenarioId} is missing: ${actualRelPath}.`,
        );
      }
    } catch {
      return visualReviewValidationFailure(
        'evidence_missing',
        `visual run-manifest.json actual capture for ${args.scenarioId} is missing: ${actualRelPath}.`,
      );
    }

    if (actualSha256 !== `sha256:${sha256Hex(readFileSync(actualPath))}`) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json actual screenshot hash drift for ${args.scenarioId}: ${fileName}.`,
      );
    }

    seenFiles.add(fileName);
    parsedScreenshots.push({
      fileName,
      actualRelPath,
      actualSha256,
      baselineSha256,
    });
  }

  return {
    ok: true,
    screenshots: parsedScreenshots,
  };
}

export function readVisualBaselineRunManifestArtifact(args: {
  path: string;
  expectedRunId: string;
  requiredCompleteness?: VisualRunManifestCompletenessRequirement;
}): { ok: true; snapshot: VisualRunManifestSnapshot } | { ok: false; path: string; failureClass: CurrentGateResultFailureClass; message: string } {
  const path = args.path;
  let payload: unknown;

  try {
    if (!statSync(path).isFile()) {
      return {
        ...visualReviewValidationFailure(
          'evidence_missing',
          `Missing visual authority artifact run-manifest.json: ${path}.`,
        ),
        path,
      };
    }
    payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    if (!existsSync(path)) {
      return {
        ...visualReviewValidationFailure(
          'evidence_missing',
          `Missing visual authority artifact run-manifest.json: ${path}.`,
        ),
        path,
      };
    }
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} is malformed: ${error instanceof Error ? error.message : String(error)}.`,
      ),
      path,
    };
  }

  if (!isRecord(payload)) {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} must be a JSON object.`,
      ),
      path,
    };
  }
  if (payload.schema !== 'visual_baseline_run_manifest/v2') {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} must include schema: visual_baseline_run_manifest/v2.`,
      ),
      path,
    };
  }

  const expectedRunId = args.expectedRunId;
  if (payload.run_id !== expectedRunId) {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} must bind run_id to the current campaign run.`,
      ),
      path,
    };
  }

  let buildRecord: ReturnType<typeof parseVisualBaselineBuildRecord>;
  try {
    buildRecord = parseVisualBaselineBuildRecord(payload.build, 'visual run-manifest.json build');
  } catch (error) {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} has invalid build metadata: ${error instanceof Error ? error.message : String(error)}.`,
      ),
      path,
    };
  }

  if (buildRecord.runId !== expectedRunId) {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} must bind build.run_id to the current campaign run.`,
      ),
      path,
    };
  }
  if (buildRecord.lane !== 'mock-lane') {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} must bind build.lane to mock-lane.`,
      ),
      path,
    };
  }
  if (Number.isNaN(Date.parse(buildRecord.startedAt))) {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} has an invalid build.started_at value.`,
      ),
      path,
    };
  }

  if (!Array.isArray(payload.scenarios) || payload.scenarios.length === 0) {
    return {
      ...visualReviewValidationFailure(
        'contract_drift',
        `visual run-manifest.json at ${path} must include scenarios[].`,
      ),
      path,
    };
  }

  const scenarioEntries = new Map<string, VisualRunManifestScenarioRecord>();
  for (const scenarioEntry of payload.scenarios) {
    if (!isRecord(scenarioEntry)) {
      return {
        ...visualReviewValidationFailure(
          'contract_drift',
          `visual run-manifest.json at ${path} includes a malformed scenario entry.`,
        ),
        path,
      };
    }

    const scenarioId = typeof scenarioEntry.scenario_id === 'string' ? scenarioEntry.scenario_id : null;
    const actualUrl = typeof scenarioEntry.actual_url === 'string' ? scenarioEntry.actual_url : null;
    const storyFingerprint = typeof scenarioEntry.story_fingerprint === 'string' ? scenarioEntry.story_fingerprint : null;

    if (!scenarioId) {
      return {
        ...visualReviewValidationFailure(
          'contract_drift',
          `visual run-manifest.json at ${path} must include scenario_id for every scenario.`,
        ),
        path,
      };
    }
    if (scenarioEntries.has(scenarioId)) {
      return {
        ...visualReviewValidationFailure(
          'contract_drift',
          `visual run-manifest.json at ${path} includes duplicate scenario ${scenarioId}.`,
        ),
        path,
      };
    }
    if (!actualUrl) {
      return {
        ...visualReviewValidationFailure(
          'contract_drift',
          `visual run-manifest.json for ${scenarioId} at ${path} must include actual_url.`,
        ),
        path,
      };
    }
    try {
      normalizeVisualBaselineManifestUrlPath(actualUrl);
    } catch (error) {
      return {
        ...visualReviewValidationFailure(
          'contract_drift',
          `visual run-manifest.json for ${scenarioId} at ${path} has invalid actual_url: ${error instanceof Error ? error.message : String(error)}.`,
        ),
        path,
      };
    }
    if (!storyFingerprint || !/^sha256:[a-f0-9]{64}$/.test(storyFingerprint)) {
      return {
        ...visualReviewValidationFailure(
          'contract_drift',
          `visual run-manifest.json for ${scenarioId} at ${path} must include story_fingerprint as sha256:<hex>.`,
        ),
        path,
      };
    }

    const screenshotValidation = parseVisualRunManifestScreenshotEntries({
      scenarioId,
      screenshots: scenarioEntry.screenshots,
      path,
    });
    if (!screenshotValidation.ok) {
      return {
        ...screenshotValidation,
        path,
      };
    }

    scenarioEntries.set(scenarioId, {
      scenarioId,
      actualUrl,
      storyFingerprint,
      screenshots: screenshotValidation.screenshots,
    });
  }

  const scenarioValues = [...scenarioEntries.values()].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  const coverageValidation = parseVisualRunManifestCoverage({
    coverage: payload.coverage,
    scenarioIds: scenarioValues.map((scenario) => scenario.scenarioId),
    path,
    requiredCompleteness: args.requiredCompleteness ?? 'allow_partial',
  });
  if (!coverageValidation.ok) {
    return {
      ...coverageValidation,
      path,
    };
  }

  return {
    ok: true,
    snapshot: {
      path,
      runId: expectedRunId,
      build: buildRecord,
      coverage: coverageValidation.coverage,
      scenarios: scenarioValues,
    },
  };
}

function validateVisualAcceptedHashMetadata(args: {
  scenario: VisualRunManifestScenarioRecord;
  metadata: Map<string, string>;
  artifactLabel: string;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const screenshotHashes = parseSha256HashMap(requiredMetadata(args.metadata, 'accepted_screenshot_hashes'));
  const baselineHashes = parseSha256HashMap(requiredMetadata(args.metadata, 'accepted_baseline_hashes'));

  if (!screenshotHashes.ok || !baselineHashes.ok) {
    return visualReviewValidationFailure(
      'contract_drift',
      `${args.artifactLabel} metadata for ${args.scenario.scenarioId} has malformed accepted screenshot/baseline hashes: ${
        !screenshotHashes.ok ? screenshotHashes.message : baselineHashes.message
      }.`,
    );
  }

  const expectedFiles = new Set(args.scenario.screenshots.map((entry) => entry.fileName));
  for (const [field, hashes] of [
    ['accepted_screenshot_hashes', screenshotHashes.hashes],
    ['accepted_baseline_hashes', baselineHashes.hashes],
  ] as const) {
    const actualFiles = new Set(hashes.keys());
    for (const fileName of expectedFiles) {
      if (!actualFiles.has(fileName)) {
        return visualReviewValidationFailure(
          'contract_drift',
          `${args.artifactLabel} metadata for ${args.scenario.scenarioId} ${field} missing ${fileName}.`,
        );
      }
    }
    for (const fileName of actualFiles) {
      if (!expectedFiles.has(fileName)) {
        return visualReviewValidationFailure(
          'contract_drift',
          `${args.artifactLabel} metadata for ${args.scenario.scenarioId} ${field} includes unexpected ${fileName}.`,
        );
      }
    }
  }

  for (const expected of args.scenario.screenshots) {
    if (screenshotHashes.hashes.get(expected.fileName) !== expected.actualSha256.replace(/^sha256:/, '')) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${args.artifactLabel} screenshot hash drift for ${args.scenario.scenarioId}: ${expected.fileName}.`,
      );
    }
    if (baselineHashes.hashes.get(expected.fileName) !== expected.baselineSha256.replace(/^sha256:/, '')) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${args.artifactLabel} baseline hash drift for ${args.scenario.scenarioId}: ${expected.fileName}.`,
      );
    }
  }

  return { ok: true };
}

function validateVisualActualHashMetadata(args: {
  scenario: VisualRunManifestScenarioRecord;
  metadata: Map<string, string>;
  artifactLabel: string;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const screenshotHashes = parseSha256HashMap(requiredMetadata(args.metadata, 'actual_screenshot_hashes'));

  if (!screenshotHashes.ok) {
    return visualReviewValidationFailure(
      'contract_drift',
      `${args.artifactLabel} metadata for ${args.scenario.scenarioId} has malformed actual screenshot hashes: ${screenshotHashes.message}.`,
    );
  }

  const expectedFiles = new Set(args.scenario.screenshots.map((entry) => entry.fileName));
  const actualFiles = new Set(screenshotHashes.hashes.keys());
  for (const fileName of expectedFiles) {
    if (!actualFiles.has(fileName)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${args.artifactLabel} metadata for ${args.scenario.scenarioId} actual_screenshot_hashes missing ${fileName}.`,
      );
    }
  }
  for (const fileName of actualFiles) {
    if (!expectedFiles.has(fileName)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${args.artifactLabel} metadata for ${args.scenario.scenarioId} actual_screenshot_hashes includes unexpected ${fileName}.`,
      );
    }
  }

  for (const expected of args.scenario.screenshots) {
    if (screenshotHashes.hashes.get(expected.fileName) !== expected.actualSha256.replace(/^sha256:/, '')) {
      return visualReviewValidationFailure(
        'contract_drift',
        `${args.artifactLabel} actual screenshot hash drift for ${args.scenario.scenarioId}: ${expected.fileName}.`,
      );
    }
  }

  return { ok: true };
}

function validateVisualBaselineReviewArtifact(args: {
  manifest: VisualRunManifestSnapshot;
  scenario: VisualRunManifestScenarioRecord;
  path: string;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const scenarioId = args.scenario.scenarioId;
  let markdown = '';
  try {
    if (!statSync(args.path).isFile()) {
      return visualReviewValidationFailure('evidence_missing', `Missing visual UX acceptance artifact: ${args.path}`);
    }
    markdown = readFileSync(args.path, 'utf8');
  } catch {
    return visualReviewValidationFailure('evidence_missing', `Missing visual UX acceptance artifact: ${args.path}`);
  }

  if (!markdown.startsWith(`# ${scenarioId}\n`)) {
    return visualReviewValidationFailure('contract_drift', `Visual UX acceptance scenario mismatch for ${scenarioId}.`);
  }

  const metadata = readMarkdownMetadata(markdown);
  if (metadata.get('schema') === 'visual_baseline_automated_pass/v1' || metadata.has('automated_verdict')) {
    return visualReviewValidationFailure(
      'contract_drift',
      `Automated visual pass cannot be used as UX acceptance for ${scenarioId}.`,
    );
  }

  if (metadata.get('schema') !== 'visual_baseline_ux_acceptance/v1') {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} must include schema: visual_baseline_ux_acceptance/v1.`,
    );
  }

  const requiredIdentity = requireMetadataFields({
    metadata,
    scenarioId,
    artifactLabel: 'visual UX acceptance',
    fields: [
      'scenario_id',
      'actual_url',
      'story_fingerprint',
      'accepted_screenshot_hashes',
      'accepted_baseline_hashes',
      'reviewer_id',
      'reviewer_kind',
      'review_mode',
      'reviewed_at',
      'findings',
    ],
    label: 'reviewer proof, URL, story, hash, and findings fields',
  });
  if (!requiredIdentity.ok) {
    return requiredIdentity;
  }

  if (metadata.get('scenario_id') !== scenarioId) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance scenario_id mismatch for ${scenarioId}.`,
    );
  }
  if (metadata.get('story_evidence_owner') !== 'lane:visual') {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} must include story_evidence_owner: lane:visual.`,
    );
  }

  const buildRunId = requiredMetadata(metadata, 'build_run_id');
  if (buildRunId !== args.manifest.runId) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} must include build_run_id for the current campaign run.`,
    );
  }
  if (requiredMetadata(metadata, 'build_git_sha') !== args.manifest.build.gitSha) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} build_git_sha must match the producer snapshot.`,
    );
  }
  if (requiredMetadata(metadata, 'build_fingerprint') !== args.manifest.build.fingerprint) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} build_fingerprint must match the producer snapshot.`,
    );
  }
  if (requiredMetadata(metadata, 'build_started_at') !== args.manifest.build.startedAt) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} build_started_at must match the producer snapshot.`,
    );
  }

  const verdict = metadata.get('verdict');
  if (!verdict) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} must include verdict.`,
    );
  }
  if (verdict !== 'accepted' && verdict !== 'needs_work' && verdict !== 'blocked') {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} verdict must be accepted, needs_work, or blocked.`,
    );
  }
  if (verdict !== 'accepted') {
    return visualReviewValidationFailure(
      'product_regression',
      `Visual UX acceptance ${scenarioId} verdict must be accepted before release.`,
    );
  }

  const reviewerKind = metadata.get('reviewer_kind');
  if (reviewerKind !== 'human' && reviewerKind !== 'ai_reviewer') {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} reviewer_kind is invalid.`,
    );
  }
  const reviewMode = metadata.get('review_mode');
  if (
    reviewMode !== 'manual_screenshot_review'
    && reviewMode !== 'ai_native_screenshot_review'
    && reviewMode !== 'pair_review'
  ) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} review_mode is invalid.`,
    );
  }
  const reviewedAt = requiredMetadata(metadata, 'reviewed_at');
  if (reviewedAt && Number.isNaN(Date.parse(reviewedAt))) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} has an invalid reviewed_at value.`,
    );
  }

  const actualUrl = requiredMetadata(metadata, 'actual_url');
  if (actualUrl && normalizeVisualBaselineManifestUrlPath(actualUrl) !== normalizeVisualBaselineManifestUrlPath(args.scenario.actualUrl)) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance actual_url drift for ${scenarioId}.`,
    );
  }
  if (metadata.get('story_fingerprint') !== args.scenario.storyFingerprint) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance story_fingerprint drift for ${scenarioId}.`,
    );
  }

  const hashValidation = validateVisualAcceptedHashMetadata({
    scenario: args.scenario,
    metadata,
    artifactLabel: 'visual UX acceptance',
  });
  if (!hashValidation.ok) {
    return hashValidation;
  }

  if (/^##\s+Blocking Findings\b/m.test(markdown)) {
    return visualReviewValidationFailure(
      'product_regression',
      `Visual UX acceptance ${scenarioId} contains blocking findings.`,
    );
  }

  return { ok: true };
}

function validateVisualBaselineAutomatedPassArtifact(args: {
  manifest: VisualRunManifestSnapshot;
  scenario: VisualRunManifestScenarioRecord;
  path: string;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const scenarioId = args.scenario.scenarioId;
  let markdown = '';
  try {
    if (!statSync(args.path).isFile()) {
      return visualReviewValidationFailure('evidence_missing', `Missing automated visual pass artifact: ${args.path}`);
    }
    markdown = readFileSync(args.path, 'utf8');
  } catch {
    return visualReviewValidationFailure('evidence_missing', `Missing automated visual pass artifact: ${args.path}`);
  }

  if (!markdown.startsWith(`# ${scenarioId}\n`)) {
    return visualReviewValidationFailure('contract_drift', `Automated visual pass scenario mismatch for ${scenarioId}.`);
  }

  const metadata = readMarkdownMetadata(markdown);
  if (metadata.get('schema') !== 'visual_baseline_automated_pass/v1') {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} must include schema: visual_baseline_automated_pass/v1.`,
    );
  }

  const requiredIdentity = requireMetadataFields({
    metadata,
    scenarioId,
    artifactLabel: 'automated visual pass',
    fields: [
      'scenario_id',
      'actual_url',
      'story_fingerprint',
      'accepted_screenshot_hashes',
      'accepted_baseline_hashes',
      'build_lane',
      'build_run_id',
      'build_git_sha',
      'build_fingerprint',
      'build_started_at',
      'actual_build_run_id',
      'actual_screenshot_hashes',
      'generated_at',
      'automated_verdict',
      'semantic_verdict',
    ],
    label: 'scenario, URL, story, hash, build, and verdict fields',
  });
  if (!requiredIdentity.ok) {
    return requiredIdentity;
  }

  if (metadata.get('scenario_id') !== scenarioId) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass scenario_id mismatch for ${scenarioId}.`,
    );
  }
  if (metadata.get('story_evidence_owner') !== 'lane:visual') {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} must include story_evidence_owner: lane:visual.`,
    );
  }
  if (requiredMetadata(metadata, 'build_lane') !== args.manifest.build.lane) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} build_lane must match the producer snapshot.`,
    );
  }
  if (requiredMetadata(metadata, 'build_run_id') !== args.manifest.runId) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} must include build_run_id for the current campaign run.`,
    );
  }
  if (requiredMetadata(metadata, 'build_git_sha') !== args.manifest.build.gitSha) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} build_git_sha must match the producer snapshot.`,
    );
  }
  if (requiredMetadata(metadata, 'build_fingerprint') !== args.manifest.build.fingerprint) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} build_fingerprint must match the producer snapshot.`,
    );
  }
  if (requiredMetadata(metadata, 'build_started_at') !== args.manifest.build.startedAt) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} build_started_at must match the producer snapshot.`,
    );
  }
  if (requiredMetadata(metadata, 'actual_build_run_id') !== args.manifest.runId) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} actual_build_run_id must match the current campaign run.`,
    );
  }

  const generatedAt = requiredMetadata(metadata, 'generated_at');
  if (generatedAt && Number.isNaN(Date.parse(generatedAt))) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} has an invalid generated_at value.`,
    );
  }

  const actualUrl = requiredMetadata(metadata, 'actual_url');
  if (actualUrl && normalizeVisualBaselineManifestUrlPath(actualUrl) !== normalizeVisualBaselineManifestUrlPath(args.scenario.actualUrl)) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass actual_url drift for ${scenarioId}.`,
    );
  }
  if (metadata.get('story_fingerprint') !== args.scenario.storyFingerprint) {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass story_fingerprint drift for ${scenarioId}.`,
    );
  }

  const acceptedHashValidation = validateVisualAcceptedHashMetadata({
    scenario: args.scenario,
    metadata,
    artifactLabel: 'automated visual pass',
  });
  if (!acceptedHashValidation.ok) {
    return acceptedHashValidation;
  }
  const actualHashValidation = validateVisualActualHashMetadata({
    scenario: args.scenario,
    metadata,
    artifactLabel: 'automated visual pass',
  });
  if (!actualHashValidation.ok) {
    return actualHashValidation;
  }

  const automatedVerdict = metadata.get('automated_verdict');
  if (automatedVerdict !== 'passed' && automatedVerdict !== 'failed') {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} automated_verdict must be passed or failed.`,
    );
  }
  if (automatedVerdict !== 'passed') {
    return visualReviewValidationFailure(
      'product_regression',
      `Automated visual pass ${scenarioId} automated_verdict must be passed before release.`,
    );
  }

  const semanticVerdict = metadata.get('semantic_verdict');
  if (semanticVerdict !== 'passed' && semanticVerdict !== 'failed') {
    return visualReviewValidationFailure(
      'contract_drift',
      `automated visual pass metadata for ${scenarioId} semantic_verdict must be passed or failed.`,
    );
  }
  if (semanticVerdict !== 'passed') {
    return visualReviewValidationFailure(
      'product_regression',
      `Automated visual pass ${scenarioId} semantic_verdict must be passed before release.`,
    );
  }

  return { ok: true };
}

function evaluateVisualBaselineAutomatedPasses(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  const manifestPath = resolveVisualRunManifestPath(campaignRoot);
  const manifest = readVisualBaselineRunManifestArtifact({
    path: manifestPath,
    expectedRunId: resolveCampaignRunId(campaignRoot),
    requiredCompleteness: 'require_full_catalog',
  });
  if (!manifest.ok) {
    return [{
      id: `${check.id}:run-manifest`,
      path: manifest.path,
      kind: check.kind,
      exists: false,
      error: manifest.message,
      failure_class: manifest.failureClass,
    }];
  }

  const records: ReleaseCampaignEvidencePointer['required_paths'] = [];
  for (const scenario of manifest.snapshot.scenarios) {
    const path = materializeCampaignPath(
      campaignRoot,
      check.path.replaceAll('<visual-scenario-id>', scenario.scenarioId),
    );
    const validation = validateVisualBaselineAutomatedPassArtifact({
      manifest: manifest.snapshot,
      scenario,
      path,
    });
    records.push({
      id: `${check.id}:${scenario.scenarioId}`,
      path,
      kind: check.kind,
      exists: validation.ok,
      ...(validation.ok
        ? {}
        : {
            error: validation.message,
            failure_class: validation.failureClass,
          }),
    });
  }
  return records;
}

function evaluateVisualRunManifest(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  const path = materializeCampaignPath(campaignRoot, check.path);
  const validation = readVisualBaselineRunManifestArtifact({
    path,
    expectedRunId: resolveCampaignRunId(campaignRoot),
    requiredCompleteness: 'require_full_catalog',
  });

  return [{
    id: check.id,
    path: validation.ok ? validation.snapshot.path : validation.path,
    kind: check.kind,
    exists: validation.ok,
    ...(validation.ok
      ? {}
      : {
          error: validation.message,
          failure_class: validation.failureClass,
        }),
  }];
}

type UxTraceIndexBundleEntry = {
  bundleRelPath: string;
  reviewPath: string;
  suite?: string;
  storyId?: string;
  scenarioId?: string;
};

export interface EvaluatedUxTraceEvidenceRoot {
  records: ReleaseCampaignEvidencePointer['required_paths'];
  validBundlePaths: readonly string[];
  minCount: number;
}

type ReleaseCampaignTopologyKey = Parameters<typeof findCurrentReleaseCampaignEvidenceArtifact>[0];

function resolveReleaseCampaignTopologyKey(
  step: CurrentVerificationCampaignStep,
): ReleaseCampaignTopologyKey | null {
  switch (step.id) {
    case 'lane-visual':
      return 'laneVisual';
    case 'gate-release':
      return 'gateRelease';
    case 'lane-unified-deploy-substrate':
      return 'unifiedDeploySubstrate';
    case 'lane-unified-deploy-local-kind-images':
      return 'unifiedDeployLocalKindImages';
    case 'lane-unified-deploy-local-kind':
      return 'unifiedDeployLocalKind';
    case 'lane-unified-deploy-product-flows':
      return 'unifiedDeployProductFlows';
    default:
      return null;
  }
}

function expectedUxTraceMembershipKey(membership: CurrentGateUxTraceExpectedMembership): string {
  return `${membership.suite}::${membership.storyId}::${membership.scenarioId ?? ''}`;
}

function actualUxTraceMembershipKey(entry: UxTraceIndexBundleEntry): string | null {
  if (!entry.suite || !entry.storyId) {
    return null;
  }
  return `${entry.suite}::${entry.storyId}::${entry.scenarioId ?? ''}`;
}

function describeUxTraceMembership(membership: CurrentGateUxTraceExpectedMembership): string {
  return `suite=${membership.suite}, story_id=${membership.storyId}, scenario_id=${membership.scenarioId ?? '(any)'}`;
}

function readExpectedUxTraceMembership(
  step: CurrentVerificationCampaignStep,
  check: CurrentVerificationCampaignEvidenceCheck,
): readonly CurrentGateUxTraceExpectedMembership[] {
  const topologyKey = resolveReleaseCampaignTopologyKey(step);
  if (!topologyKey) {
    return [];
  }
  return findCurrentReleaseCampaignEvidenceArtifact(topologyKey, check.id)?.expectedMembership ?? [];
}

export function evaluateUxTraceEvidenceRoot(
  path: string,
  step: CurrentVerificationCampaignStep,
  check: CurrentVerificationCampaignEvidenceCheck,
): EvaluatedUxTraceEvidenceRoot {
  const expectedMembership = readExpectedUxTraceMembership(step, check);
  const minCount = Math.max(check.minCount ?? 1, expectedMembership.length);
  const indexPath = join(path, UX_TRACE_INDEX_FILE);
  let indexPayload: unknown;
  try {
    indexPayload = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown;
  } catch (error) {
    return {
      records: [{
        id: check.id,
        path,
        kind: 'ux_trace_bundle',
        exists: false,
        matches: [],
        min_count: minCount,
        error: existsSync(indexPath)
          ? `Malformed UX trace ${UX_TRACE_INDEX_FILE}: ${error instanceof Error ? error.message : String(error)}`
          : `Missing UX trace ${UX_TRACE_INDEX_FILE}: ${indexPath}`,
        failure_class: existsSync(indexPath) ? 'contract_drift' : 'evidence_missing',
      }],
      validBundlePaths: [],
      minCount,
    };
  }
  if (!isRecord(indexPayload) || indexPayload.version !== 1 || !Array.isArray(indexPayload.bundles)) {
    return {
      records: [{
        id: check.id,
        path,
        kind: 'ux_trace_bundle',
        exists: false,
        matches: [indexPath],
        min_count: minCount,
        error: `Malformed UX trace ${UX_TRACE_INDEX_FILE}: ${indexPath}`,
        failure_class: 'contract_drift',
      }],
      validBundlePaths: [],
      minCount,
    };
  }

  const records: ReleaseCampaignEvidencePointer['required_paths'] = [];
  let validCount = 0;
  const validBundlePaths: string[] = [];
  const bundleEntries = indexPayload.bundles
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.bundle_relpath === 'string')
    .map((entry): UxTraceIndexBundleEntry => ({
      bundleRelPath: String(entry.bundle_relpath),
      reviewPath: typeof entry.review_relpath === 'string'
        ? String(entry.review_relpath)
        : `${String(entry.bundle_relpath)}/review.md`,
      suite: typeof entry.suite === 'string' ? entry.suite : undefined,
      storyId: typeof entry.story_id === 'string' ? entry.story_id : undefined,
      scenarioId: typeof entry.scenario_id === 'string' ? entry.scenario_id : undefined,
    }))
    .sort((left, right) => left.bundleRelPath.localeCompare(right.bundleRelPath));
  if (bundleEntries.length === 0) {
    return {
      records: [{
        id: check.id,
        path,
        kind: 'ux_trace_bundle',
        exists: false,
        matches: [indexPath],
        min_count: minCount,
        error: `UX trace ${UX_TRACE_INDEX_FILE} does not declare any bundles under ${path}.`,
        failure_class: 'evidence_missing',
      }],
      validBundlePaths: [],
      minCount,
    };
  }

  const expectedMembershipKeys = new Set(expectedMembership.map(expectedUxTraceMembershipKey));
  const actualMembershipEntries = new Map<string, UxTraceIndexBundleEntry[]>();
  for (const entry of bundleEntries) {
    const membershipKey = actualUxTraceMembershipKey(entry);
    if (!membershipKey) {
      continue;
    }
    const matches = actualMembershipEntries.get(membershipKey) ?? [];
    matches.push(entry);
    actualMembershipEntries.set(membershipKey, matches);
  }

  for (const membership of expectedMembership) {
    const membershipKey = expectedUxTraceMembershipKey(membership);
    const matches = actualMembershipEntries.get(membershipKey) ?? [];
    if (matches.length === 0) {
      records.push({
        id: `${check.id}:expected:${membershipKey}`,
        path,
        kind: 'ux_trace_bundle',
        exists: false,
        matches: [indexPath],
        min_count: minCount,
        error: `Missing expected backend-real UX trace bundle membership for ${step.id}: ${describeUxTraceMembership(membership)}.`,
        failure_class: 'evidence_missing',
      });
    } else if (matches.length > 1) {
      records.push({
        id: `${check.id}:duplicate:${membershipKey}`,
        path,
        kind: 'ux_trace_bundle',
        exists: false,
        matches: matches.map((entry) => join(path, entry.bundleRelPath)),
        min_count: minCount,
        error: `Duplicate backend-real UX trace bundle membership for ${step.id}: ${describeUxTraceMembership(membership)}.`,
        failure_class: 'contract_drift',
      });
    }
  }

  for (const [membershipKey, entries] of actualMembershipEntries.entries()) {
    if (expectedMembershipKeys.has(membershipKey)) {
      continue;
    }
    const [sample] = entries;
    records.push({
      id: `${check.id}:unexpected:${membershipKey}`,
      path: join(path, sample?.bundleRelPath ?? ''),
      kind: 'ux_trace_bundle',
      exists: false,
      matches: entries.map((entry) => join(path, entry.bundleRelPath)),
      min_count: minCount,
      error: `Unexpected backend-real UX trace bundle membership for ${step.id}: suite=${sample?.suite ?? '(missing)'}, story_id=${sample?.storyId ?? '(missing)'}, scenario_id=${sample?.scenarioId ?? '(missing)'}.`,
      failure_class: 'contract_drift',
    });
  }

  for (const entry of bundleEntries) {
    const bundleDir = join(path, entry.bundleRelPath);
    const reviewPath = join(path, entry.reviewPath);
    const validation = validateUxTraceBundleArtifact({
      bundleDir,
      expectedLane: 'backend-real',
      expectedSuite: entry.suite,
      expectedEvidenceRoot: path,
      expectedCampaignStepId: step.id,
    });
    const membershipKey = actualUxTraceMembershipKey(entry);
    const membershipAccepted = expectedMembership.length === 0
      || (membershipKey !== null && expectedMembershipKeys.has(membershipKey));
    if (validation.ok && membershipAccepted) {
      validCount += 1;
      validBundlePaths.push(bundleDir);
    }
    records.push({
      id: `${check.id}:${entry.bundleRelPath}`,
      path: bundleDir,
      kind: 'ux_trace_bundle',
      exists: validation.ok,
      matches: [reviewPath],
      min_count: minCount,
      ...(validation.ok
        ? {}
        : {
            error: validation.message,
            failure_class: validation.failureClass,
          }),
    });
  }

  if (validCount < minCount) {
    records.push({
      id: `${check.id}:min_count`,
      path,
      kind: 'ux_trace_bundle',
      exists: false,
      matches: bundleEntries.map((entry) => join(path, entry.bundleRelPath)),
      min_count: minCount,
      error: `Expected at least ${minCount} semantically valid UX trace bundle(s), found ${validCount}.`,
      failure_class: 'evidence_missing',
    });
  }

  return {
    records,
    validBundlePaths,
    minCount,
  };
}

function evaluateUxTraceBundles(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  const path = materializeCampaignPath(campaignRoot, check.path);
  return evaluateUxTraceEvidenceRoot(path, step, check).records;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function flowIdsFromAggregate(payload: Record<string, unknown>): Set<string> {
  const flows = Array.isArray(payload.flows) ? payload.flows : [];
  const ids = new Set<string>();
  for (const flow of flows) {
    if (!isRecord(flow)) {
      continue;
    }
    if (typeof flow.flow === 'string' && flow.status === 'passed') {
      ids.add(flow.flow);
    }
  }
  return ids;
}

type UnifiedDeployEvidenceDiagnostic = {
  message: string;
  failureClass: CurrentGateResultFailureClass;
};

const FOCUSED_PRODUCT_FLOW_SCHEMA_VERSION = 'agentsmith.focused-product-flow.evidence/v1';

function isCurrentGateResultFailureClass(value: unknown): value is CurrentGateResultFailureClass {
  return value === 'none'
    || value === 'product_regression'
    || value === 'infra_setup_failure'
    || value === 'environment_conflict'
    || value === 'contract_drift'
    || value === 'evidence_missing';
}

function unifiedDeployDiagnostic(
  message: string,
  failureClass: CurrentGateResultFailureClass,
): UnifiedDeployEvidenceDiagnostic {
  return { message, failureClass };
}

function inferredUnifiedDeployFailureClass(
  check: CurrentVerificationCampaignEvidenceCheck,
): CurrentGateResultFailureClass {
  return stringArray(check.expectedProductFlows).length > 0 ? 'product_regression' : 'infra_setup_failure';
}

function failedPayloadFailureClass(
  payload: Record<string, unknown>,
  check: CurrentVerificationCampaignEvidenceCheck,
): CurrentGateResultFailureClass {
  if (
    isCurrentGateResultFailureClass(payload.failure_class)
    && payload.failure_class !== 'none'
    && payload.failure_class !== 'evidence_missing'
  ) {
    return payload.failure_class;
  }
  return inferredUnifiedDeployFailureClass(check);
}

function productFlowStatusFromAggregate(payload: Record<string, unknown>, expectedFlow: string): string | null {
  const flows = Array.isArray(payload.flows) ? payload.flows : [];
  for (const flow of flows) {
    if (!isRecord(flow) || flow.flow !== expectedFlow) {
      continue;
    }
    return typeof flow.status === 'string' ? flow.status : null;
  }
  return null;
}

function productFlowFailureClassFromAggregate(
  payload: Record<string, unknown>,
  expectedFlows: readonly string[],
): CurrentGateResultFailureClass {
  for (const flow of expectedFlows) {
    if (productFlowStatusFromAggregate(payload, flow) === 'failed') {
      return 'product_regression';
    }
  }
  return 'evidence_missing';
}

function validateFocusedProductFlowEvidence(
  evidencePath: string,
  expectedFlow: string,
  expectedProducer: string | undefined,
): UnifiedDeployEvidenceDiagnostic | null {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
  } catch (error) {
    return unifiedDeployDiagnostic(
      `${evidencePath} focused product flow evidence must be valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      'contract_drift',
    );
  }

  if (!isRecord(payload)) {
    return unifiedDeployDiagnostic(`${evidencePath} focused product flow evidence must be a JSON object.`, 'contract_drift');
  }
  if (payload.schema_version !== FOCUSED_PRODUCT_FLOW_SCHEMA_VERSION) {
    return unifiedDeployDiagnostic(
      `${evidencePath} focused product flow evidence schema_version must be ${FOCUSED_PRODUCT_FLOW_SCHEMA_VERSION}.`,
      'contract_drift',
    );
  }
  if (payload.flow !== expectedFlow) {
    return unifiedDeployDiagnostic(`${evidencePath} focused product flow evidence flow must be ${expectedFlow}.`, 'contract_drift');
  }
  if (expectedProducer && payload.producer !== expectedProducer) {
    return unifiedDeployDiagnostic(`${evidencePath} focused product flow evidence producer must be ${expectedProducer}.`, 'contract_drift');
  }
  if (typeof payload.command !== 'string' || payload.command.trim().length === 0) {
    return unifiedDeployDiagnostic(`${evidencePath} focused product flow evidence must include command.`, 'contract_drift');
  }
  if (payload.status !== 'passed') {
    return unifiedDeployDiagnostic(
      `${evidencePath} focused product flow evidence status must be passed.`,
      payload.status === 'failed' ? 'product_regression' : 'contract_drift',
    );
  }

  return null;
}

function isPathAtOrUnderRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function validateFocusedProductFlowEvidencePaths(
  payload: Record<string, unknown>,
  check: CurrentVerificationCampaignEvidenceCheck,
  path: string,
  expectedFlows: readonly string[],
): UnifiedDeployEvidenceDiagnostic | null {
  if (!isRecord(payload.flow_evidence_paths)) {
    return unifiedDeployDiagnostic(`${path} must include flow_evidence_paths for focused product flow evidence.`, 'evidence_missing');
  }

  const evidenceRoot = realpathSync(dirname(path));
  for (const flow of expectedFlows) {
    const rawPath = payload.flow_evidence_paths[flow];
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      return unifiedDeployDiagnostic(`${path} must include focused product flow evidence path for ${flow}.`, 'evidence_missing');
    }
    const evidencePath = resolve(dirname(path), rawPath);
    if (!existsSync(evidencePath)) {
      return unifiedDeployDiagnostic(`${path} focused product flow evidence file for ${flow} is missing: ${evidencePath}.`, 'evidence_missing');
    }
    const realEvidencePath = realpathSync(evidencePath);
    if (!isPathAtOrUnderRoot(evidenceRoot, realEvidencePath)) {
      return unifiedDeployDiagnostic(
        `${path} focused product flow evidence file for ${flow} must stay under ${evidenceRoot}: ${realEvidencePath}.`,
        'contract_drift',
      );
    }
    const diagnostic = validateFocusedProductFlowEvidence(realEvidencePath, flow, check.expectedProducer);
    if (diagnostic) {
      return diagnostic;
    }
  }

  return null;
}

function unifiedDeployEvidenceFailureClass(
  diagnostics: readonly UnifiedDeployEvidenceDiagnostic[],
): CurrentGateResultFailureClass {
  return diagnostics.find((diagnostic) => diagnostic.failureClass !== 'evidence_missing')?.failureClass
    ?? 'evidence_missing';
}

function validateUnifiedDeployPayload(
  payload: Record<string, unknown>,
  check: CurrentVerificationCampaignEvidenceCheck,
  path: string,
): UnifiedDeployEvidenceDiagnostic | null {
  if (check.expectedStatus && payload.status !== check.expectedStatus) {
    return unifiedDeployDiagnostic(
      `${path} status must be ${check.expectedStatus}.`,
      payload.status === 'failed' ? failedPayloadFailureClass(payload, check) : 'contract_drift',
    );
  }
  if (check.expectedProducer && payload.producer !== check.expectedProducer) {
    return unifiedDeployDiagnostic(`${path} producer must be ${check.expectedProducer}.`, 'contract_drift');
  }
  if (check.expectedCommand && payload.command !== check.expectedCommand) {
    return unifiedDeployDiagnostic(`${path} command must be ${check.expectedCommand}.`, 'contract_drift');
  }
  if (check.expectedProfile && payload.profile !== check.expectedProfile) {
    return unifiedDeployDiagnostic(`${path} profile must be ${check.expectedProfile}.`, 'contract_drift');
  }

  const expectedFlows = stringArray(check.expectedProductFlows);
  if (expectedFlows.length > 0) {
    const passedFlows = flowIdsFromAggregate(payload);
    const missingFlows = expectedFlows.filter((flow) => !passedFlows.has(flow));
    if (missingFlows.length > 0) {
      return unifiedDeployDiagnostic(
        `${path} must include passed product flow evidence for: ${missingFlows.join(', ')}.`,
        productFlowFailureClassFromAggregate(payload, missingFlows),
      );
    }

    const focusedEvidenceDiagnostic = validateFocusedProductFlowEvidencePaths(payload, check, path, expectedFlows);
    if (focusedEvidenceDiagnostic) {
      return focusedEvidenceDiagnostic;
    }
  }

  return null;
}

function evaluateUnifiedDeployEvidence(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  const path = materializeCampaignPath(campaignRoot, check.path);
  const minCount = check.minCount ?? 1;
  const fileName = check.fileName ?? '.json';
  const matches = listRecursiveFiles(path).filter((candidate) => matchesFileName(candidate, fileName));
  const matchingSchemaPaths: string[] = [];
  const validPaths: string[] = [];
  const diagnostics: UnifiedDeployEvidenceDiagnostic[] = [];

  if (matches.length < minCount) {
    diagnostics.push(unifiedDeployDiagnostic(`Expected at least ${minCount} JSON evidence file(s), found ${matches.length}.`, 'evidence_missing'));
  }

  for (const match of matches) {
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(match, 'utf8')) as unknown;
    } catch (error) {
      diagnostics.push(unifiedDeployDiagnostic(`${match} must be valid JSON: ${error instanceof Error ? error.message : String(error)}.`, 'contract_drift'));
      continue;
    }

    if (!isRecord(payload)) {
      diagnostics.push(unifiedDeployDiagnostic(`${match} must be a JSON object.`, 'contract_drift'));
      continue;
    }

    if (check.expectedSchemaVersion && payload.schema_version !== check.expectedSchemaVersion) {
      continue;
    }

    matchingSchemaPaths.push(match);
    const diagnostic = validateUnifiedDeployPayload(payload, check, match);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }

    validPaths.push(match);
  }

  if (check.expectedSchemaVersion && matchingSchemaPaths.length === 0) {
    diagnostics.push(unifiedDeployDiagnostic(`No JSON evidence file declared schema_version ${check.expectedSchemaVersion}.`, 'evidence_missing'));
  }
  if (validPaths.length === 0 && diagnostics.length === 0) {
    diagnostics.push(unifiedDeployDiagnostic('No semantically valid unified deploy evidence file found.', 'evidence_missing'));
  }

  return [{
    id: check.id,
    path,
    kind: check.kind,
    exists: diagnostics.length === 0 && validPaths.length > 0,
    matches: validPaths,
    min_count: minCount,
    ...(diagnostics.length > 0 ? {
      error: diagnostics.map((diagnostic) => diagnostic.message).join(' '),
      failure_class: unifiedDeployEvidenceFailureClass(diagnostics),
    } : {}),
  }];
}

function evaluateEvidenceCheck(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  if (check.semantic === 'ux_trace_bundle') {
    return evaluateUxTraceBundles(campaignRoot, step, check);
  }
  if (check.semantic === 'unified_deploy_evidence') {
    return evaluateUnifiedDeployEvidence(campaignRoot, check);
  }

  const path = materializeCampaignPath(campaignRoot, check.path);
  switch (check.kind) {
    case 'visual_run_manifest':
      return evaluateVisualRunManifest(campaignRoot, check);
    case 'visual_baseline_automated_passes':
      return evaluateVisualBaselineAutomatedPasses(campaignRoot, check);
    case 'visual_baseline_reviews':
      return evaluateVisualBaselineReviews(campaignRoot, check);
    case 'file': {
      let exists = false;
      try {
        exists = statSync(path).isFile();
      } catch {
        exists = false;
      }
      return [{ id: check.id, path, kind: check.kind, exists }];
    }
    case 'directory': {
      let exists = false;
      try {
        exists = statSync(path).isDirectory();
      } catch {
        exists = false;
      }
      return [{ id: check.id, path, kind: check.kind, exists }];
    }
    case 'directory_non_empty': {
      let exists = false;
      try {
        exists = statSync(path).isDirectory() && readdirSync(path).length > 0;
      } catch {
        exists = false;
      }
      return [{ id: check.id, path, kind: check.kind, exists }];
    }
    case 'recursive_file': {
      const minCount = check.minCount ?? 1;
      const fileName = check.fileName ?? 'review.md';
      const matches = listRecursiveFiles(path).filter((candidate) => matchesFileName(candidate, fileName));
      return [{
        id: check.id,
        path,
        kind: check.kind,
        exists: matches.length >= minCount,
        matches,
        min_count: minCount,
      }];
    }
    default: {
      const exhaustiveCheck: never = check.kind;
      throw new Error(`Unsupported evidence check kind: ${String(exhaustiveCheck)}`);
    }
  }
}

export function evaluateCampaignEvidenceChecks(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
): readonly ReleaseCampaignEvidencePathRecord[] {
  if (step.evidenceChecks.length > 0) {
    return step.evidenceChecks.flatMap((check) => evaluateEvidenceCheck(campaignRoot, step, check));
  }

  return materializeEvidenceHints(campaignRoot, step).map((path) => ({
    id: 'evidence_hint',
    path,
    kind: 'path',
    exists: existsSync(path),
  }));
}

export function nativeResultPath(campaignRoot: string, step: CurrentVerificationCampaignStep): string | null {
  if (!step.nativeResult) {
    return null;
  }
  return materializeCampaignPath(campaignRoot, step.nativeResult.path);
}

export function tryReadGateResult(path: string): SafeGateResultRead {
  try {
    return {
      ok: true,
      value: JSON.parse(readFileSync(path, 'utf8')) as ParsedGateResult,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readNativeResultPointer(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
): ReleaseCampaignEvidencePointer['native_result'] {
  const path = nativeResultPath(campaignRoot, step);
  if (!path) {
    return null;
  }
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      gate_id: step.nativeResult?.gateId ?? null,
      status: null,
      failure_class: null,
    };
  }
  const result = tryReadGateResult(path);
  if (!result.ok || !result.value) {
    return {
      path,
      exists: true,
      gate_id: step.nativeResult?.gateId ?? null,
      status: null,
      failure_class: null,
      error: result.error ?? 'invalid_json',
    };
  }
  return {
    path,
    exists: true,
    gate_id: typeof result.value.gate_id === 'string' ? result.value.gate_id : null,
    status: typeof result.value.status === 'string' ? result.value.status : null,
    failure_class: typeof result.value.failure_class === 'string' ? result.value.failure_class : null,
  };
}

export function writeCampaignEvidencePointer(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
): ReleaseCampaignEvidencePointer {
  assertReleaseCampaignRootNotSymlink(campaignRoot);
  const dir = prepareCampaignChildDirectory(
    campaignRoot,
    stepDir(campaignRoot, step),
    'release campaign step evidence directory',
  );
  const requiredPaths = evaluateCampaignEvidenceChecks(campaignRoot, step)
    .map((record) => buildReleaseCampaignEvidencePathRecord(record));
  const payload: ReleaseCampaignEvidencePointer = {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    step_id: step.id,
    gate_id: step.gateId,
    evidence_topology: 'campaign_root',
    campaign_root: resolve(campaignRoot),
    evidence_dir: dir,
    native_result: readNativeResultPointer(campaignRoot, step),
    required_paths: requiredPaths,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(evidencePointerPath(campaignRoot, step), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function writeCampaignGateResult(input: ReleaseCampaignResultInput): void {
  assertReleaseCampaignRootNotSymlink(input.campaignRoot);
  const dir = prepareCampaignChildDirectory(
    input.campaignRoot,
    stepDir(input.campaignRoot, input.step),
    'release campaign step result directory',
  );
  const payload = {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: input.step.gateId,
    gate_adapter: {
      npm_script: input.step.npmScript,
      ci_job: null,
    },
    status: input.status,
    failure_class: input.failureClass,
    stage: input.stage,
    line_kind: input.step.lineKind,
    evidence_dir: dir,
    summary: input.summary,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(resultPath(input.campaignRoot, input.step), `${JSON.stringify(payload, null, 2)}\n`);
}

export function readGateResult(path: string): ParsedGateResult {
  return JSON.parse(readFileSync(path, 'utf8')) as ParsedGateResult;
}
