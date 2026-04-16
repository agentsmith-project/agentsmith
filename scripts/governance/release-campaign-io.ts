import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

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
  assertVisualBaselineActualUrlMatchesRoute,
  buildVisualBaselineScenarioEvidence,
  groupVisualBaselineCatalogByScenario,
  type VisualBaselineScenarioRecord,
} from '../../e2e/visual-baseline-support';
import { validateUxTraceBundleArtifact } from '../../e2e/trace-bundle-support';

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

export function resolveCampaignRoot(campaignRunId: string): string {
  if (process.env.RELEASE_CAMPAIGN_ROOT?.trim()) {
    return resolve(process.env.RELEASE_CAMPAIGN_ROOT);
  }
  return resolve('artifacts', 'release-runs', campaignRunId);
}

export function resolveExistingCampaignRoot(): string {
  if (process.env.RELEASE_CAMPAIGN_ROOT?.trim()) {
    return resolve(process.env.RELEASE_CAMPAIGN_ROOT);
  }
  if (process.env.RELEASE_CAMPAIGN_RUN_ID?.trim()) {
    return resolve('artifacts', 'release-runs', process.env.RELEASE_CAMPAIGN_RUN_ID);
  }
  if (process.env.RELEASE_CAMPAIGN_USE_LATEST !== 'true') {
    throw new Error(
      'gate:release:full requires RELEASE_CAMPAIGN_ROOT or RELEASE_CAMPAIGN_RUN_ID. '
        + 'Run npm run release:campaign:full for release verification; set RELEASE_CAMPAIGN_USE_LATEST=true only for diagnostics.',
    );
  }

  const releaseRunsRoot = resolve('artifacts', 'release-runs');
  if (!existsSync(releaseRunsRoot)) {
    throw new Error('No release campaign root found. Run npm run release:campaign:full first, or set RELEASE_CAMPAIGN_ROOT.');
  }

  const candidates = readdirSync(releaseRunsRoot)
    .map((entry) => join(releaseRunsRoot, entry))
    .filter((entry) => {
      try {
        return statSync(entry).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (!candidates[0]) {
    throw new Error('No release campaign run directory found under artifacts/release-runs.');
  }
  return candidates[0];
}

export function resolveCampaignRunId(campaignRoot: string): string {
  return process.env.RELEASE_CAMPAIGN_RUN_ID?.trim() || basename(resolve(campaignRoot));
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
    if (!statSync(root).isDirectory()) {
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
        const stats = statSync(path);
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
  label: string;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const missing = collectMissingMetadata(args.metadata, args.fields);
  if (missing.length > 0) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${args.scenarioId} must include ${args.label}: ${missing.join(', ')}.`,
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

function validateVisualHashMetadata(args: {
  scenario: VisualBaselineScenarioRecord;
  metadata: Map<string, string>;
}): { ok: true } | { ok: false; failureClass: CurrentGateResultFailureClass; message: string } {
  const evidence = buildVisualBaselineScenarioEvidence(args.scenario);
  const screenshotHashes = parseSha256HashMap(requiredMetadata(args.metadata, 'accepted_screenshot_hashes'));
  const baselineHashes = parseSha256HashMap(requiredMetadata(args.metadata, 'accepted_baseline_hashes'));

  if (!screenshotHashes.ok || !baselineHashes.ok) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${args.scenario.scenarioId} has malformed accepted screenshot/baseline hashes: ${
        !screenshotHashes.ok ? screenshotHashes.message : baselineHashes.message
      }.`,
    );
  }

  const expectedFiles = new Set(evidence.screenshots.map((entry) => entry.fileName));
  for (const [field, hashes] of [
    ['accepted_screenshot_hashes', screenshotHashes.hashes],
    ['accepted_baseline_hashes', baselineHashes.hashes],
  ] as const) {
    const actualFiles = new Set(hashes.keys());
    for (const fileName of expectedFiles) {
      if (!actualFiles.has(fileName)) {
        return visualReviewValidationFailure(
          'contract_drift',
          `visual UX acceptance metadata for ${args.scenario.scenarioId} ${field} missing ${fileName}.`,
        );
      }
    }
    for (const fileName of actualFiles) {
      if (!expectedFiles.has(fileName)) {
        return visualReviewValidationFailure(
          'contract_drift',
          `visual UX acceptance metadata for ${args.scenario.scenarioId} ${field} includes unexpected ${fileName}.`,
        );
      }
    }
  }

  for (const expected of evidence.screenshots) {
    if (screenshotHashes.hashes.get(expected.fileName) !== expected.screenshotSha256) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual UX acceptance screenshot hash drift for ${args.scenario.scenarioId}: ${expected.fileName}.`,
      );
    }
    if (baselineHashes.hashes.get(expected.fileName) !== expected.baselineSha256) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual UX acceptance baseline hash drift for ${args.scenario.scenarioId}: ${expected.fileName}.`,
      );
    }
  }

  return { ok: true };
}

function validateVisualBaselineReviewArtifact(args: {
  campaignRoot: string;
  scenario: VisualBaselineScenarioRecord;
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

  const expectedRunId = resolveCampaignRunId(args.campaignRoot);
  const buildRunId = requiredMetadata(metadata, 'build_run_id');
  if (buildRunId !== expectedRunId) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} must include build_run_id for the current campaign run.`,
    );
  }

  for (const field of ['build_git_sha', 'build_fingerprint', 'build_started_at'] as const) {
    if (!requiredMetadata(metadata, field)) {
      return visualReviewValidationFailure(
        'contract_drift',
        `visual UX acceptance metadata for ${scenarioId} must include ${field}.`,
      );
    }
  }

  const buildStartedAt = requiredMetadata(metadata, 'build_started_at');
  if (buildStartedAt && Number.isNaN(Date.parse(buildStartedAt))) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance metadata for ${scenarioId} has an invalid build_started_at value.`,
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
  if (actualUrl) {
    try {
      assertVisualBaselineActualUrlMatchesRoute({
        scenarioId,
        expectedRoute: args.scenario.route,
        actualUrl,
      });
    } catch (error) {
      return visualReviewValidationFailure(
        'contract_drift',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const expectedEvidence = buildVisualBaselineScenarioEvidence(args.scenario);
  if (metadata.get('story_fingerprint') !== expectedEvidence.storyFingerprint) {
    return visualReviewValidationFailure(
      'contract_drift',
      `visual UX acceptance story_fingerprint drift for ${scenarioId}.`,
    );
  }

  const hashValidation = validateVisualHashMetadata({ scenario: args.scenario, metadata });
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

function evaluateVisualBaselineReviews(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  const grouped = groupVisualBaselineCatalogByScenario();
  const records: ReleaseCampaignEvidencePointer['required_paths'] = [];
  for (const [scenarioId, scenario] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const path = materializeCampaignPath(
      campaignRoot,
      check.path.replaceAll('<visual-scenario-id>', scenarioId),
    );
    const validation = validateVisualBaselineReviewArtifact({
      campaignRoot,
      scenario,
      path,
    });
    records.push({
      id: `${check.id}:${scenarioId}`,
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

function evaluateUxTraceBundles(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  const path = materializeCampaignPath(campaignRoot, check.path);
  const minCount = check.minCount ?? 1;
  const reviewFiles = listRecursiveFiles(path).filter((candidate) => matchesFileName(candidate, check.fileName ?? 'review.md'));
  if (reviewFiles.length === 0) {
    return [{
      id: check.id,
      path,
      kind: 'ux_trace_bundle',
      exists: false,
      matches: [],
      min_count: minCount,
      error: `Missing UX trace review.md, manifest.json, and events.jsonl under ${path}.`,
      failure_class: 'evidence_missing',
    }];
  }

  const records: ReleaseCampaignEvidencePointer['required_paths'] = [];
  let validCount = 0;
  for (const reviewPath of reviewFiles.sort()) {
    const bundleDir = dirname(reviewPath);
    const validation = validateUxTraceBundleArtifact({
      bundleDir,
      expectedLane: 'backend-real',
      expectedEvidenceRoot: path,
      expectedCampaignStepId: step.id,
    });
    if (validation.ok) {
      validCount += 1;
    }
    records.push({
      id: `${check.id}:${basename(bundleDir)}`,
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
      matches: reviewFiles,
      min_count: minCount,
      error: `Expected at least ${minCount} semantically valid UX trace bundle(s), found ${validCount}.`,
      failure_class: 'evidence_missing',
    });
  }

  return records;
}

function evaluateEvidenceCheck(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  check: CurrentVerificationCampaignEvidenceCheck,
): ReleaseCampaignEvidencePointer['required_paths'] {
  if (check.kind === 'visual_baseline_reviews') {
    return evaluateVisualBaselineReviews(campaignRoot, check);
  }
  if (check.semantic === 'ux_trace_bundle') {
    return evaluateUxTraceBundles(campaignRoot, step, check);
  }

  const path = materializeCampaignPath(campaignRoot, check.path);
  if (check.kind === 'file') {
    let exists = false;
    try {
      exists = statSync(path).isFile();
    } catch {
      exists = false;
    }
    return [{ id: check.id, path, kind: check.kind, exists }];
  }

  if (check.kind === 'directory') {
    let exists = false;
    try {
      exists = statSync(path).isDirectory();
    } catch {
      exists = false;
    }
    return [{ id: check.id, path, kind: check.kind, exists }];
  }

  if (check.kind === 'directory_non_empty') {
    let exists = false;
    try {
      exists = statSync(path).isDirectory() && readdirSync(path).length > 0;
    } catch {
      exists = false;
    }
    return [{ id: check.id, path, kind: check.kind, exists }];
  }

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

export function evaluateCampaignEvidenceChecks(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
): readonly ReleaseCampaignEvidencePathRecord[] {
  if (step.evidenceChecks.length > 0) {
    return step.evidenceChecks.flatMap((check) => evaluateEvidenceCheck(campaignRoot, step, check));
  }

  return materializeEvidenceHints(campaignRoot, step).map((path) => ({
    id: 'legacy_hint',
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
  const dir = stepDir(campaignRoot, step);
  mkdirSync(dir, { recursive: true });
  const requiredPaths = evaluateCampaignEvidenceChecks(campaignRoot, step);
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
  const dir = stepDir(input.campaignRoot, input.step);
  mkdirSync(dir, { recursive: true });
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
