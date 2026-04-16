import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bindTraceEventToStory, type TraceStoryBinding } from './story-trace-binding';
import {
  buildStorySourceFingerprint,
  type StoryTraceOrderContract,
  type StoryTargetMatch,
} from './story-contract';

export type UxTraceRequestSummary = {
  method: string;
  url: string;
  summary?: string;
};

export type UxTraceResponseSummary = {
  status: number;
  summary?: string;
};

export type UxTraceEventInput = {
  stepId: string;
  action?: string;
  target?: string;
  input?: string;
  route?: string;
  request?: UxTraceRequestSummary;
  response?: UxTraceResponseSummary;
  assertion?: string;
  note?: string;
};

export type UxTraceCaptureEventInput = {
  stepId: string;
  action?: string;
  target?: string;
  input?: string;
  route?: string;
  request?: UxTraceRequestSummary;
  response?: UxTraceResponseSummary;
  assertion?: string;
  note?: string;
  fullPage?: boolean;
};

export type UxTraceEventRecord = UxTraceEventInput & {
  seq: number;
  ts: string;
  action: string;
  screenshot?: string;
};

type TraceEventJson = {
  seq: number;
  ts: string;
  step_id: string;
  action: string;
  target?: string;
  input?: string;
  route?: string;
  request?: UxTraceRequestSummary;
  response?: UxTraceResponseSummary;
  assertion?: string;
  note?: string;
  screenshot?: string;
};

export type UxTraceScreenshotRecord = {
  seq: number;
  step_id: string;
  file: string;
  route: string;
  note?: string;
};

export type UxTraceBundleManifest = {
  version: 1;
  story_id: string;
  story_source?: string;
  story_source_fingerprint?: string;
  story_fingerprint?: string;
  step_map_fingerprint?: string;
  scenario_id: string;
  title: string;
  actor: string;
  lane: string;
  suite: string;
  route: string;
  spec_file: string;
  browser: string;
  run_id: string;
  git_sha: string;
  goal?: string;
  preconditions?: string[];
  seed_data?: string[];
  required_trace_steps: string[];
  required_screenshot_steps: string[];
  trace_order_contract?: StoryTraceOrderContract;
  started_at: string;
  finished_at: string;
  outcome: 'pass' | 'fail';
  event_count: number;
  screenshot_count: number;
  screenshots: UxTraceScreenshotRecord[];
};

export type UxTraceContractSnapshotStep = {
  step_id: string;
  action: string;
  target?: string;
  target_match?: StoryTargetMatch;
  scene_id?: string | null;
};

export type UxTraceBundleContractSnapshot = {
  version: 1;
  lane: string;
  suite: string;
  story_id: string;
  scenario_id: string;
  run_id: string;
  story_source?: string;
  story_source_fingerprint?: string;
  story_fingerprint?: string;
  step_map_fingerprint?: string;
  required_trace_steps: string[];
  required_screenshot_steps: string[];
  trace_order_contract?: StoryTraceOrderContract;
  steps: UxTraceContractSnapshotStep[];
};

export type UxTraceBundleIndexEntry = {
  lane: string;
  suite: string;
  story_id: string;
  scenario_id: string;
  run_id: string;
  bundle_relpath: string;
  manifest_relpath: string;
  review_relpath: string;
  contract_snapshot_relpath: string;
};

export type UxTraceBundleIndex = {
  version: 1;
  generated_at: string;
  bundles: UxTraceBundleIndexEntry[];
};

export type UxTracePageLike = {
  url(): string;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};

export type UxTraceBundleOptions = {
  storyId: string;
  title: string;
  actor: string;
  lane: string;
  suite: string;
  route: string;
  specFile: string;
  browser: string;
  gitSha?: string;
  goal?: string;
  preconditions?: string[];
  seedData?: string[];
  storyBinding?: TraceStoryBinding;
  scenarioId?: string;
  runId?: string;
  startedAt?: string;
  outputRoot?: string;
};

export type UxTraceBundleFinishOptions = {
  outcome: 'pass' | 'fail';
  finishedAt?: string;
};

export type UxTraceBundleWriter = {
  bundleDir: string;
  manifestPath: string;
  eventsPath: string;
  reviewPath: string;
  capture(page: UxTracePageLike, event: UxTraceEventInput & { fullPage?: boolean }): Promise<UxTraceEventRecord>;
  note(event: UxTraceEventInput): UxTraceEventRecord;
  finish(options: UxTraceBundleFinishOptions): Promise<UxTraceBundleManifest>;
  events(): UxTraceEventRecord[];
};

export type UxTraceBundleValidationFailureClass =
  | 'contract_drift'
  | 'evidence_missing'
  | 'product_regression';

export type UxTraceBundleValidationIssue = {
  failureClass: UxTraceBundleValidationFailureClass;
  message: string;
};

export type UxTraceBundleValidationResult =
  | {
      ok: true;
      manifest: UxTraceBundleManifest;
    }
  | {
      ok: false;
      failureClass: UxTraceBundleValidationFailureClass;
      message: string;
      issues: readonly UxTraceBundleValidationIssue[];
    };

export type UxTraceBundleValidationOptions = {
  bundleDir: string;
  expectedLane?: string;
  expectedSuite?: string;
  expectedEvidenceRoot?: string;
  expectedCampaignStepId?: string;
};

export function buildUxTraceCaptureEvent(event: UxTraceCaptureEventInput): UxTraceEventInput {
  return {
    stepId: event.stepId,
    action: event.action,
    target: event.target,
    input: event.input,
    route: event.route,
    request: event.request,
    response: event.response,
    assertion: event.assertion,
    note: event.note,
  };
}

const DEFAULT_TRACE_OUTPUT_ROOT = path.resolve('artifacts/ux-traces');
export const UX_TRACE_CONTRACT_SNAPSHOT_FILE = 'contract-snapshot.json';
export const UX_TRACE_INDEX_FILE = 'ux-trace-index.json';

function sanitizeTraceSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'trace';
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

function resolveStorySourceFingerprint(storySource?: string): string | undefined {
  if (!storySource) {
    return undefined;
  }
  const normalizedSource = storySource.split('#', 1)[0];
  if (!normalizedSource.trim()) {
    return undefined;
  }
  return buildStorySourceFingerprint(readFileSync(path.resolve(normalizedSource), 'utf8'));
}

function requiredTraceStepIds(storyBinding?: TraceStoryBinding): string[] {
  return storyBinding?.steps
    .filter((step) => step.evidence.includes('trace') && !step.optional)
    .map((step) => step.stepId) ?? [];
}

function requiredScreenshotStepIds(storyBinding?: TraceStoryBinding): string[] {
  return storyBinding?.steps
    .filter((step) => step.evidence.includes('trace') && !step.optional && step.sceneId)
    .map((step) => step.stepId) ?? [];
}

function resolveBindingTraceOrderContract(storyBinding?: TraceStoryBinding): StoryTraceOrderContract | undefined {
  if (!storyBinding) {
    return undefined;
  }
  return {
    mode: 'strict_sequence',
    orderedStepIds: storyBinding.steps
      .filter((step) => step.evidence.includes('trace') && !step.optional)
      .map((step) => step.stepId),
  };
}

function traceContractSnapshotSteps(storyBinding?: TraceStoryBinding): UxTraceContractSnapshotStep[] {
  return storyBinding?.steps
    .filter((step) => step.evidence.includes('trace') && !step.optional)
    .map((step) => ({
      step_id: step.stepId,
      action: step.action,
      ...(step.target ? { target: step.target } : {}),
      ...(step.targetMatch ? { target_match: step.targetMatch } : {}),
      scene_id: step.sceneId ?? null,
    })) ?? [];
}

function buildUxTraceContractSnapshot(args: {
  options: UxTraceBundleOptions;
  manifest: UxTraceBundleManifest;
}): UxTraceBundleContractSnapshot {
  return {
    version: 1,
    lane: args.manifest.lane,
    suite: args.manifest.suite,
    story_id: args.manifest.story_id,
    scenario_id: args.manifest.scenario_id,
    run_id: args.manifest.run_id,
    story_source: args.options.storyBinding?.storySource,
    story_source_fingerprint: args.manifest.story_source_fingerprint,
    story_fingerprint: args.manifest.story_fingerprint,
    step_map_fingerprint: args.manifest.step_map_fingerprint,
    required_trace_steps: [...args.manifest.required_trace_steps],
    required_screenshot_steps: [...args.manifest.required_screenshot_steps],
    trace_order_contract: args.manifest.trace_order_contract,
    steps: traceContractSnapshotSteps(args.options.storyBinding),
  };
}

function readTraceIndexPayload(indexPath: string): UxTraceBundleIndex | null {
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as UxTraceBundleIndex;
  } catch {
    return null;
  }
}

function writeUxTraceBundleIndex(args: {
  outputRoot: string;
  bundleDir: string;
  manifest: UxTraceBundleManifest;
}): void {
  const indexPath = path.join(args.outputRoot, UX_TRACE_INDEX_FILE);
  const bundleRelpath = normalizeRelativePath(path.relative(args.outputRoot, args.bundleDir));
  const entry: UxTraceBundleIndexEntry = {
    lane: args.manifest.lane,
    suite: args.manifest.suite,
    story_id: args.manifest.story_id,
    scenario_id: args.manifest.scenario_id,
    run_id: args.manifest.run_id,
    bundle_relpath: bundleRelpath,
    manifest_relpath: `${bundleRelpath}/manifest.json`,
    review_relpath: `${bundleRelpath}/review.md`,
    contract_snapshot_relpath: `${bundleRelpath}/${UX_TRACE_CONTRACT_SNAPSHOT_FILE}`,
  };
  const existing = readTraceIndexPayload(indexPath);
  const preserved = existing?.bundles.filter((candidate) => candidate.bundle_relpath !== bundleRelpath) ?? [];
  const payload: UxTraceBundleIndex = {
    version: 1,
    generated_at: nowIso(),
    bundles: [...preserved, entry].sort((left, right) => left.bundle_relpath.localeCompare(right.bundle_relpath)),
  };
  writeFileSync(indexPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function reviewVerdictForOutcome(outcome: UxTraceBundleManifest['outcome']): 'accepted' | 'blocked' {
  return outcome === 'pass' ? 'accepted' : 'blocked';
}

function reviewFindingsForOutcome(outcome: UxTraceBundleManifest['outcome']): string {
  return outcome === 'pass' ? 'No blocking findings.' : 'Trace finished with failing outcome.';
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultRunId(): string {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export function resolveUxTraceBundleDir(options: {
  outputRoot?: string;
  lane: string;
  suite: string;
  storyId: string;
  runId: string;
}): string {
  const root = path.resolve(options.outputRoot ?? process.env.UX_TRACE_OUTPUT_ROOT ?? DEFAULT_TRACE_OUTPUT_ROOT);
  return path.join(
    root,
    sanitizeTraceSegment(options.lane),
    sanitizeTraceSegment(options.suite),
    sanitizeTraceSegment(options.storyId),
    sanitizeTraceSegment(options.runId),
  );
}

export function renderUxTraceEventsJsonl(events: UxTraceEventRecord[]): string {
  return `${events
    .map((event) => JSON.stringify({
      seq: event.seq,
      ts: event.ts,
      step_id: event.stepId,
      action: event.action,
      target: event.target,
      input: event.input,
      route: event.route,
      request: event.request,
      response: event.response,
      assertion: event.assertion,
      note: event.note,
      screenshot: event.screenshot,
    } satisfies TraceEventJson))
    .join('\n')}\n`;
}

export function renderUxTraceReviewMarkdown(args: {
  manifest: UxTraceBundleManifest;
  events: UxTraceEventRecord[];
}): string {
  const { manifest, events } = args;
  const verdict = reviewVerdictForOutcome(manifest.outcome);
  const lines = [
    `# ${manifest.title}`,
    '',
    '- schema: ux_trace_bundle_review/v1',
    `- story_id: ${manifest.story_id}`,
    `- scenario_id: ${manifest.scenario_id}`,
    `- story_source: ${manifest.story_source ?? '<unset>'}`,
    `- story_source_fingerprint: ${manifest.story_source_fingerprint ?? '<unset>'}`,
    `- story_fingerprint: ${manifest.story_fingerprint ?? '<unset>'}`,
    `- step_map_fingerprint: ${manifest.step_map_fingerprint ?? '<unset>'}`,
    `- actor: ${manifest.actor}`,
    `- lane: ${manifest.lane}`,
    `- suite: ${manifest.suite}`,
    `- route: ${manifest.route}`,
    `- spec_file: ${manifest.spec_file}`,
    `- browser: ${manifest.browser}`,
    `- run_id: ${manifest.run_id}`,
    `- outcome: ${manifest.outcome}`,
    `- verdict: ${verdict}`,
    `- findings: ${reviewFindingsForOutcome(manifest.outcome)}`,
    `- started_at: ${manifest.started_at}`,
    `- finished_at: ${manifest.finished_at}`,
    '',
    '## Intent',
    '',
    `- goal: ${manifest.goal ?? '<unset>'}`,
    `- preconditions: ${manifest.preconditions?.length ? manifest.preconditions.join('; ') : '<none>'}`,
    `- seed_data: ${manifest.seed_data?.length ? manifest.seed_data.join('; ') : '<none>'}`,
    '',
    '## Evidence',
    '',
    '- manifest.json',
    '- events.jsonl',
    '- screenshots/',
    '',
    '## Trace Events',
    '',
    '| Seq | Step | Action | Target | Route | Screenshot | Assertion | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...events.map((event) => `| ${event.seq} | ${event.stepId} | ${event.action} | ${event.target ?? ''} | ${event.route ?? manifest.route} | ${event.screenshot ?? ''} | ${event.assertion ?? ''} | ${event.note ?? ''} |`),
    '',
    '## Screenshots',
    '',
    ...manifest.screenshots.map((shot) => `- ${shot.file} (${shot.step_id})`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathIsWithin(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSafeRelativeFile(value: string): boolean {
  return Boolean(value.trim())
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && !value.split('/').includes('..');
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

function traceValidationIssue(
  issues: UxTraceBundleValidationIssue[],
  failureClass: UxTraceBundleValidationFailureClass,
  message: string,
): void {
  issues.push({ failureClass, message });
}

function traceValidationResult(
  issues: readonly UxTraceBundleValidationIssue[],
  manifest?: UxTraceBundleManifest,
): UxTraceBundleValidationResult {
  if (issues.length === 0 && manifest) {
    return { ok: true, manifest };
  }
  const primary = issues.find((issue) => issue.failureClass === 'product_regression')
    ?? issues.find((issue) => issue.failureClass === 'evidence_missing')
    ?? issues[0]
    ?? {
      failureClass: 'contract_drift' as const,
      message: 'UX trace bundle validation failed without a concrete issue.',
    };
  return {
    ok: false,
    failureClass: primary.failureClass,
    message: issues.map((issue) => issue.message).join(' '),
    issues,
  };
}

function parseTraceJsonFile<T>(
  filePath: string,
  label: string,
  issues: UxTraceBundleValidationIssue[],
): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    traceValidationIssue(
      issues,
      'contract_drift',
      `Malformed UX trace ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function parseTraceEvents(
  eventsPath: string,
  issues: UxTraceBundleValidationIssue[],
): TraceEventJson[] {
  let content = '';
  try {
    content = readFileSync(eventsPath, 'utf8');
  } catch (error) {
    traceValidationIssue(
      issues,
      'evidence_missing',
      `Missing UX trace events.jsonl: ${eventsPath} (${error instanceof Error ? error.message : String(error)})`,
    );
    return [];
  }

  const events: TraceEventJson[] = [];
  for (const [index, line] of content.split('\n').entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('event line is not an object');
      }
      events.push(parsed as TraceEventJson);
    } catch (error) {
      traceValidationIssue(
        issues,
        'contract_drift',
        `Malformed UX trace event line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return events;
}

function statIsFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function requiredStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return strings.length === value.length ? strings : null;
}

function resolveManifestTraceOrderContract(
  value: unknown,
  issues: UxTraceBundleValidationIssue[],
): StoryTraceOrderContract | null {
  if (value === undefined) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest must include trace_order_contract.');
    return null;
  }
  if (!isRecord(value)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest trace_order_contract must be an object.');
    return null;
  }

  if (value.mode !== 'strict_sequence') {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest trace_order_contract.mode must be strict_sequence.');
  }
  const orderedStepIds = requiredStringArray(value.orderedStepIds);
  if (!orderedStepIds) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest trace_order_contract must include orderedStepIds.');
  }
  if (value.mode !== 'strict_sequence' || !orderedStepIds) {
    return null;
  }

  return {
    mode: 'strict_sequence',
    orderedStepIds,
  };
}

function listsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function targetMatches(expected: string, actual: string, mode: StoryTargetMatch = 'exact'): boolean {
  return mode === 'prefix' ? actual.startsWith(expected) : actual === expected;
}

function validateTraceBundlePath(
  options: UxTraceBundleValidationOptions,
  manifest: UxTraceBundleManifest,
  issues: UxTraceBundleValidationIssue[],
): void {
  const canonicalRelativePath = normalizeRelativePath(path.join(
    sanitizeTraceSegment(manifest.lane),
    sanitizeTraceSegment(manifest.suite),
    sanitizeTraceSegment(manifest.story_id),
    sanitizeTraceSegment(manifest.run_id),
  ));

  if (options.expectedEvidenceRoot && !pathIsWithin(options.bundleDir, options.expectedEvidenceRoot)) {
    traceValidationIssue(
      issues,
      'contract_drift',
      `UX trace bundle is outside the expected evidence root for ${options.expectedCampaignStepId ?? 'campaign step'}: ${options.bundleDir}`,
    );
  } else if (options.expectedEvidenceRoot) {
    const actualRelativePath = normalizeRelativePath(
      path.relative(path.resolve(options.expectedEvidenceRoot), path.resolve(options.bundleDir)),
    );
    if (actualRelativePath !== canonicalRelativePath) {
      traceValidationIssue(
        issues,
        'contract_drift',
        `UX trace bundle path drift: expected ${canonicalRelativePath}, received ${actualRelativePath}.`,
      );
    }
  }

  const runSegment = path.basename(options.bundleDir);
  const storySegment = path.basename(path.dirname(options.bundleDir));
  const suiteSegment = path.basename(path.dirname(path.dirname(options.bundleDir)));
  const laneSegment = path.basename(path.dirname(path.dirname(path.dirname(options.bundleDir))));
  const expectedSegments = [
    ['lane', laneSegment, manifest.lane],
    ['suite', suiteSegment, manifest.suite],
    ['story_id', storySegment, manifest.story_id],
    ['run_id', runSegment, manifest.run_id],
  ] as const;
  for (const [label, actual, expected] of expectedSegments) {
    if (actual !== sanitizeTraceSegment(expected)) {
      traceValidationIssue(
        issues,
        'contract_drift',
        `UX trace bundle path ${label} segment drift: expected ${sanitizeTraceSegment(expected)}, received ${actual}.`,
      );
    }
  }
}

function validateTraceBundleIndexMembership(args: {
  options: UxTraceBundleValidationOptions;
  manifest: UxTraceBundleManifest;
  bundleDir: string;
  issues: UxTraceBundleValidationIssue[];
}): void {
  const evidenceRoot = args.options.expectedEvidenceRoot;
  if (!evidenceRoot) {
    return;
  }
  const resolvedRoot = path.resolve(evidenceRoot);
  const indexPath = path.join(resolvedRoot, UX_TRACE_INDEX_FILE);
  if (!statIsFile(indexPath)) {
    traceValidationIssue(args.issues, 'evidence_missing', `Missing UX trace ${UX_TRACE_INDEX_FILE}: ${indexPath}`);
    return;
  }

  const index = parseTraceJsonFile<UxTraceBundleIndex>(indexPath, UX_TRACE_INDEX_FILE, args.issues);
  if (!index || !isRecord(index) || index.version !== 1 || !Array.isArray(index.bundles)) {
    traceValidationIssue(args.issues, 'contract_drift', `Malformed UX trace ${UX_TRACE_INDEX_FILE}: ${indexPath}`);
    return;
  }

  const bundleRelpath = normalizeRelativePath(path.relative(resolvedRoot, args.bundleDir));
  const entry = index.bundles.find((candidate) => isRecord(candidate) && candidate.bundle_relpath === bundleRelpath);
  if (!entry || !isRecord(entry)) {
    traceValidationIssue(
      args.issues,
      'evidence_missing',
      `UX trace ${UX_TRACE_INDEX_FILE} does not declare bundle ${bundleRelpath}.`,
    );
    return;
  }

  for (const [field, expected] of [
    ['lane', args.manifest.lane],
    ['suite', args.manifest.suite],
    ['story_id', args.manifest.story_id],
    ['scenario_id', args.manifest.scenario_id],
    ['run_id', args.manifest.run_id],
  ] as const) {
    if (entry[field] !== expected) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace index ${field} drift for bundle ${bundleRelpath}.`);
    }
  }

  const expectedFiles = {
    manifest_relpath: `${bundleRelpath}/manifest.json`,
    review_relpath: `${bundleRelpath}/review.md`,
    contract_snapshot_relpath: `${bundleRelpath}/${UX_TRACE_CONTRACT_SNAPSHOT_FILE}`,
  } as const;
  for (const [field, expected] of Object.entries(expectedFiles) as Array<[keyof typeof expectedFiles, string]>) {
    if (entry[field] !== expected) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace index ${field} drift for bundle ${bundleRelpath}.`);
    }
  }
}

function validateManifestShape(
  manifest: UxTraceBundleManifest,
  issues: UxTraceBundleValidationIssue[],
): StoryTraceOrderContract | null {
  if (manifest.version !== 1) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest version must be 1.');
  }
  for (const field of [
    'story_id',
    'scenario_id',
    'title',
    'actor',
    'lane',
    'suite',
    'route',
    'spec_file',
    'browser',
    'run_id',
    'git_sha',
    'started_at',
    'finished_at',
  ] as const) {
    if (!requiredString(manifest[field])) {
      traceValidationIssue(issues, 'contract_drift', `UX trace manifest missing ${field}.`);
    }
  }
  if (manifest.outcome !== 'pass' && manifest.outcome !== 'fail') {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest outcome must be pass or fail.');
  }
  if (manifest.outcome === 'fail') {
    traceValidationIssue(issues, 'product_regression', 'UX trace manifest outcome must be pass before release.');
  }
  if (!requiredStringArray(manifest.required_trace_steps)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest must include required_trace_steps.');
  }
  if (!requiredStringArray(manifest.required_screenshot_steps)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest must include required_screenshot_steps.');
  }
  if (!Array.isArray(manifest.screenshots)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest screenshots must be an array.');
  }
  const traceOrderContract = resolveManifestTraceOrderContract(manifest.trace_order_contract, issues);
  if (Number.isNaN(Date.parse(String(manifest.started_at)))) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest started_at is invalid.');
  }
  if (Number.isNaN(Date.parse(String(manifest.finished_at)))) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest finished_at is invalid.');
  }

  return traceOrderContract;
}

function validateContractSnapshotShape(
  snapshot: UxTraceBundleContractSnapshot,
  traceOrderContract: StoryTraceOrderContract | null,
  issues: UxTraceBundleValidationIssue[],
): void {
  if (snapshot.version !== 1) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace contract snapshot version must be 1.');
  }
  for (const field of ['lane', 'suite', 'story_id', 'scenario_id', 'run_id'] as const) {
    if (!requiredString(snapshot[field])) {
      traceValidationIssue(issues, 'contract_drift', `UX trace contract snapshot missing ${field}.`);
    }
  }
  if (!requiredStringArray(snapshot.required_trace_steps)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace contract snapshot must include required_trace_steps.');
  }
  if (!requiredStringArray(snapshot.required_screenshot_steps)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace contract snapshot must include required_screenshot_steps.');
  }
  if (!Array.isArray(snapshot.steps)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace contract snapshot must include steps[].');
  }
  for (const step of snapshot.steps ?? []) {
    if (!isRecord(step) || !requiredString(step.step_id) || !requiredString(step.action)) {
      traceValidationIssue(issues, 'contract_drift', 'UX trace contract snapshot includes a malformed step entry.');
    }
  }
  if (snapshot.trace_order_contract !== undefined) {
    resolveManifestTraceOrderContract(snapshot.trace_order_contract, issues);
  } else if (traceOrderContract) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace contract snapshot must include trace_order_contract.');
  }
}

function validateManifestAgainstContractSnapshot(
  manifest: UxTraceBundleManifest,
  snapshot: UxTraceBundleContractSnapshot,
  traceOrderContract: StoryTraceOrderContract | null,
  issues: UxTraceBundleValidationIssue[],
): void {
  for (const [field, expected] of [
    ['lane', snapshot.lane],
    ['suite', snapshot.suite],
    ['story_id', snapshot.story_id],
    ['scenario_id', snapshot.scenario_id],
    ['run_id', snapshot.run_id],
    ['story_fingerprint', snapshot.story_fingerprint],
    ['step_map_fingerprint', snapshot.step_map_fingerprint],
    ['story_source_fingerprint', snapshot.story_source_fingerprint],
  ] as const) {
    if ((manifest as Record<string, unknown>)[field] !== expected) {
      traceValidationIssue(issues, 'contract_drift', `UX trace ${field} drift for ${manifest.story_id}.`);
    }
  }

  if (!listsEqual(manifest.required_trace_steps ?? [], snapshot.required_trace_steps ?? [])) {
    traceValidationIssue(issues, 'contract_drift', `UX trace required_trace_steps drift for ${manifest.story_id}.`);
  }
  if (!listsEqual(manifest.required_screenshot_steps ?? [], snapshot.required_screenshot_steps ?? [])) {
    traceValidationIssue(issues, 'contract_drift', `UX trace required_screenshot_steps drift for ${manifest.story_id}.`);
  }

  const expectedTraceOrderContract = snapshot.trace_order_contract;
  if (traceOrderContract && expectedTraceOrderContract
    && (traceOrderContract.mode !== expectedTraceOrderContract.mode
      || !listsEqual(traceOrderContract.orderedStepIds, expectedTraceOrderContract.orderedStepIds))) {
    traceValidationIssue(issues, 'contract_drift', `UX trace trace_order_contract drift for ${manifest.story_id}.`);
  }
}

function validateTraceEvents(args: {
  bundleDir: string;
  manifest: UxTraceBundleManifest;
  snapshot: UxTraceBundleContractSnapshot;
  traceOrderContract: StoryTraceOrderContract | null;
  events: readonly TraceEventJson[];
  issues: UxTraceBundleValidationIssue[];
}): void {
  const snapshotStepsById = new Map(args.snapshot.steps.map((step) => [step.step_id, step]));
  const eventsByStep = new Map<string, TraceEventJson[]>();
  const firstEventIndexByStep = new Map<string, number>();
  for (const event of args.events) {
    if (!Number.isInteger(event.seq) || event.seq < 1) {
      traceValidationIssue(args.issues, 'contract_drift', 'UX trace event seq must be a positive integer.');
    }
    if (!requiredString(event.ts) || Number.isNaN(Date.parse(event.ts))) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace event ${String(event.seq)} has invalid ts.`);
    }
    if (!requiredString(event.step_id)) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace event ${String(event.seq)} missing step_id.`);
      continue;
    }
    if (!requiredString(event.action)) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace event ${event.step_id} missing action.`);
    }
    const snapshotStep = snapshotStepsById.get(event.step_id);
    if (!snapshotStep) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace event references unknown story step: ${event.step_id}.`);
      continue;
    }
    if (event.action !== snapshotStep.action) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace action drift for step ${event.step_id}.`);
    }
    if (snapshotStep.target) {
      if (!event.target || !targetMatches(snapshotStep.target, event.target, snapshotStep.target_match ?? 'exact')) {
        traceValidationIssue(args.issues, 'contract_drift', `UX trace target drift for step ${event.step_id}.`);
      }
    }
    const previous = eventsByStep.get(event.step_id) ?? [];
    eventsByStep.set(event.step_id, [...previous, event]);
    if (!firstEventIndexByStep.has(event.step_id)) {
      firstEventIndexByStep.set(event.step_id, args.events.indexOf(event));
    }
  }

  if (args.manifest.event_count !== args.events.length) {
    traceValidationIssue(args.issues, 'contract_drift', 'UX trace manifest event_count does not match events.jsonl.');
  }

  for (const stepId of args.manifest.required_trace_steps ?? []) {
    if (!eventsByStep.has(stepId)) {
      traceValidationIssue(args.issues, 'evidence_missing', `UX trace bundle missing required trace step: ${stepId}.`);
    }
  }

  const manifestScreenshotRecords = Array.isArray(args.manifest.screenshots) ? args.manifest.screenshots : [];
  const manifestScreenshotsByStep = new Map<string, UxTraceScreenshotRecord[]>();
  for (const screenshot of manifestScreenshotRecords) {
    if (!requiredString(screenshot.step_id) || !requiredString(screenshot.file) || !isSafeRelativeFile(screenshot.file)) {
      traceValidationIssue(args.issues, 'contract_drift', 'UX trace manifest contains a malformed screenshot record.');
      continue;
    }
    const previous = manifestScreenshotsByStep.get(screenshot.step_id) ?? [];
    manifestScreenshotsByStep.set(screenshot.step_id, [...previous, screenshot]);
    if (!statIsFile(path.join(args.bundleDir, screenshot.file))) {
      traceValidationIssue(args.issues, 'evidence_missing', `UX trace screenshot file missing for step ${screenshot.step_id}: ${screenshot.file}.`);
    }
  }

  const screenshotEvents = args.events.filter((event) => Boolean(event.screenshot));
  if (args.manifest.screenshot_count !== screenshotEvents.length || args.manifest.screenshot_count !== manifestScreenshotRecords.length) {
    traceValidationIssue(args.issues, 'contract_drift', 'UX trace manifest screenshot_count does not match events/screenshots.');
  }

  for (const stepId of args.manifest.required_screenshot_steps ?? []) {
    const eventWithScreenshot = eventsByStep.get(stepId)?.find((event) => Boolean(event.screenshot));
    const manifestScreenshot = manifestScreenshotsByStep.get(stepId)?.[0];
    if (!eventWithScreenshot || !manifestScreenshot) {
      traceValidationIssue(args.issues, 'evidence_missing', `UX trace bundle missing required screenshot for step: ${stepId}.`);
      continue;
    }
    if (eventWithScreenshot.screenshot !== manifestScreenshot.file) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace screenshot record drift for step: ${stepId}.`);
    }
  }

  if (args.traceOrderContract?.mode === 'strict_sequence') {
    let previousIndex = -1;
    let previousStepId: string | null = null;
    for (const stepId of args.traceOrderContract.orderedStepIds) {
      const firstIndex = firstEventIndexByStep.get(stepId);
      if (firstIndex === undefined) {
        continue;
      }
      if (firstIndex < previousIndex) {
        traceValidationIssue(
          args.issues,
          'contract_drift',
          `UX trace sequence drift: step ${stepId} appears before ${previousStepId ?? 'the previous required step'}.`,
        );
        break;
      }
      previousIndex = firstIndex;
      previousStepId = stepId;
    }
  }
}

function validateTraceReviewMarkdown(args: {
  reviewPath: string;
  manifest: UxTraceBundleManifest;
  issues: UxTraceBundleValidationIssue[];
}): void {
  let markdown = '';
  try {
    markdown = readFileSync(args.reviewPath, 'utf8');
  } catch (error) {
    traceValidationIssue(
      args.issues,
      'evidence_missing',
      `Missing UX trace review.md: ${args.reviewPath} (${error instanceof Error ? error.message : String(error)})`,
    );
    return;
  }
  if (!markdown.startsWith(`# ${args.manifest.title}\n`)) {
    traceValidationIssue(args.issues, 'contract_drift', `UX trace review title mismatch for ${args.manifest.story_id}.`);
  }
  const metadata = readMarkdownMetadata(markdown);
  const requiredMetadata = [
    'schema',
    'story_id',
    'scenario_id',
    'story_fingerprint',
    'step_map_fingerprint',
    'run_id',
    'outcome',
    'verdict',
    'findings',
  ] as const;
  for (const field of requiredMetadata) {
    if (!metadata.get(field)) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace review metadata missing ${field}.`);
    }
  }
  if (metadata.get('schema') !== 'ux_trace_bundle_review/v1') {
    traceValidationIssue(args.issues, 'contract_drift', 'UX trace review schema must be ux_trace_bundle_review/v1.');
  }
  for (const field of ['story_id', 'scenario_id', 'story_fingerprint', 'step_map_fingerprint', 'run_id', 'outcome'] as const) {
    if (metadata.get(field) !== String(args.manifest[field])) {
      traceValidationIssue(args.issues, 'contract_drift', `UX trace review ${field} does not match manifest.`);
    }
  }
  const verdict = metadata.get('verdict');
  if (verdict !== 'accepted' && verdict !== 'needs_work' && verdict !== 'blocked') {
    traceValidationIssue(args.issues, 'contract_drift', 'UX trace review verdict must be accepted, needs_work, or blocked.');
  } else if (verdict !== 'accepted') {
    traceValidationIssue(args.issues, 'product_regression', 'UX trace review verdict must be accepted before release.');
  }
  if (/^##\s+Blocking Findings\b/m.test(markdown)) {
    traceValidationIssue(args.issues, 'product_regression', `UX trace review for ${args.manifest.story_id} contains blocking findings.`);
  }
}

export function validateUxTraceBundleArtifact(options: UxTraceBundleValidationOptions): UxTraceBundleValidationResult {
  const bundleDir = path.resolve(options.bundleDir);
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const eventsPath = path.join(bundleDir, 'events.jsonl');
  const reviewPath = path.join(bundleDir, 'review.md');
  const contractSnapshotPath = path.join(bundleDir, UX_TRACE_CONTRACT_SNAPSHOT_FILE);
  const issues: UxTraceBundleValidationIssue[] = [];

  for (const [label, filePath] of [
    ['manifest.json', manifestPath],
    ['events.jsonl', eventsPath],
    ['review.md', reviewPath],
    [UX_TRACE_CONTRACT_SNAPSHOT_FILE, contractSnapshotPath],
  ] as const) {
    if (!statIsFile(filePath)) {
      traceValidationIssue(issues, 'evidence_missing', `Missing UX trace ${label}: ${filePath}`);
    }
  }
  if (issues.some((issue) => issue.failureClass === 'evidence_missing')) {
    return traceValidationResult(issues);
  }

  const manifest = parseTraceJsonFile<UxTraceBundleManifest>(manifestPath, 'manifest.json', issues);
  if (!manifest) {
    return traceValidationResult(issues);
  }
  if (!isRecord(manifest)) {
    traceValidationIssue(issues, 'contract_drift', 'UX trace manifest.json must be an object.');
    return traceValidationResult(issues);
  }

  const traceOrderContract = validateManifestShape(manifest, issues);
  if (options.expectedLane && manifest.lane !== options.expectedLane) {
    traceValidationIssue(issues, 'contract_drift', `UX trace lane mismatch: expected ${options.expectedLane}, received ${manifest.lane}.`);
  }
  if (options.expectedSuite && manifest.suite !== options.expectedSuite) {
    traceValidationIssue(issues, 'contract_drift', `UX trace suite mismatch: expected ${options.expectedSuite}, received ${manifest.suite}.`);
  }

  const snapshot = parseTraceJsonFile<UxTraceBundleContractSnapshot>(
    contractSnapshotPath,
    UX_TRACE_CONTRACT_SNAPSHOT_FILE,
    issues,
  );
  if (!snapshot) {
    return traceValidationResult(issues);
  }
  if (!isRecord(snapshot)) {
    traceValidationIssue(issues, 'contract_drift', `UX trace ${UX_TRACE_CONTRACT_SNAPSHOT_FILE} must be an object.`);
    return traceValidationResult(issues);
  }
  validateContractSnapshotShape(snapshot, traceOrderContract, issues);
  validateManifestAgainstContractSnapshot(manifest, snapshot, traceOrderContract, issues);
  validateTraceBundlePath({ ...options, bundleDir }, manifest, issues);
  validateTraceBundleIndexMembership({
    options,
    manifest,
    bundleDir,
    issues,
  });

  const events = parseTraceEvents(eventsPath, issues);
  validateTraceEvents({
    bundleDir,
    manifest,
    snapshot,
    traceOrderContract,
    events,
    issues,
  });
  validateTraceReviewMarkdown({
    reviewPath,
    manifest,
    issues,
  });

  return traceValidationResult(issues, manifest);
}

export async function createUxTraceBundleWriter(options: UxTraceBundleOptions): Promise<UxTraceBundleWriter> {
  const runId = options.runId ?? process.env.UX_TRACE_RUN_ID ?? defaultRunId();
  const outputRoot = path.resolve(options.outputRoot ?? process.env.UX_TRACE_OUTPUT_ROOT ?? DEFAULT_TRACE_OUTPUT_ROOT);
  const bundleDir = resolveUxTraceBundleDir({
    outputRoot,
    lane: options.lane,
    suite: options.suite,
    storyId: options.storyId,
    runId,
  });
  const screenshotsDir = path.join(bundleDir, 'screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  const startedAt = options.startedAt ?? nowIso();
  const events: UxTraceEventRecord[] = [];

  const normalizeEvent = (event: UxTraceEventInput): UxTraceEventInput & { action: string } => {
    const normalized = options.storyBinding ? bindTraceEventToStory(options.storyBinding, event) : event;
    if (!normalized.action?.trim()) {
      throw new Error(`missing trace action for step: ${normalized.stepId}`);
    }
    return {
      ...normalized,
      action: normalized.action,
    };
  };

  const writeBundle = async (manifest: UxTraceBundleManifest) => {
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    await writeFile(path.join(bundleDir, 'events.jsonl'), renderUxTraceEventsJsonl(events), 'utf-8');
    await writeFile(path.join(bundleDir, 'review.md'), renderUxTraceReviewMarkdown({ manifest, events }), 'utf-8');
    await writeFile(
      path.join(bundleDir, UX_TRACE_CONTRACT_SNAPSHOT_FILE),
      `${JSON.stringify(buildUxTraceContractSnapshot({ options, manifest }), null, 2)}\n`,
      'utf-8',
    );
    writeUxTraceBundleIndex({
      outputRoot,
      bundleDir,
      manifest,
    });
  };

  return {
    bundleDir,
    manifestPath: path.join(bundleDir, 'manifest.json'),
    eventsPath: path.join(bundleDir, 'events.jsonl'),
    reviewPath: path.join(bundleDir, 'review.md'),
    events: () => [...events],
    capture: async (page, event) => {
      const normalized = normalizeEvent(event);
      const seq = events.length + 1;
      const screenshotFile = `screenshots/${String(seq).padStart(3, '0')}-${sanitizeTraceSegment(normalized.stepId)}.png`;
      await page.screenshot({
        path: path.join(bundleDir, screenshotFile),
        fullPage: normalized.fullPage ?? true,
      });
      const record: UxTraceEventRecord = {
        seq,
        ts: nowIso(),
        stepId: normalized.stepId,
        action: normalized.action,
        target: normalized.target,
        input: normalized.input,
        route: normalized.route ?? page.url(),
        request: normalized.request,
        response: normalized.response,
        assertion: normalized.assertion,
        note: normalized.note,
        screenshot: screenshotFile,
      };
      events.push(record);
      return record;
    },
    note: (event) => {
      const normalized = normalizeEvent(event);
      const record: UxTraceEventRecord = {
        seq: events.length + 1,
        ts: nowIso(),
        stepId: normalized.stepId,
        action: normalized.action,
        target: normalized.target,
        input: normalized.input,
        route: normalized.route,
        request: normalized.request,
        response: normalized.response,
        assertion: normalized.assertion,
        note: normalized.note,
      };
      events.push(record);
      return record;
    },
    finish: async (finishOptions) => {
      const manifest: UxTraceBundleManifest = {
        version: 1,
        story_id: options.storyId,
        story_source: options.storyBinding?.storySource,
        story_source_fingerprint: resolveStorySourceFingerprint(options.storyBinding?.storySource),
        story_fingerprint: options.storyBinding?.storyFingerprint,
        step_map_fingerprint: options.storyBinding?.stepMapFingerprint,
        scenario_id: options.scenarioId ?? options.suite,
        title: options.title,
        actor: options.actor,
        lane: options.lane,
        suite: options.suite,
        route: options.route,
        spec_file: options.specFile,
        browser: options.browser,
        run_id: runId,
        git_sha: options.gitSha?.trim() || process.env.GIT_SHA?.trim() || process.env.CI_COMMIT_SHA?.trim() || 'local',
        goal: options.goal,
        preconditions: options.preconditions,
        seed_data: options.seedData,
        required_trace_steps: requiredTraceStepIds(options.storyBinding),
        required_screenshot_steps: requiredScreenshotStepIds(options.storyBinding),
        trace_order_contract: resolveBindingTraceOrderContract(options.storyBinding),
        started_at: startedAt,
        finished_at: finishOptions.finishedAt ?? nowIso(),
        outcome: finishOptions.outcome,
        event_count: events.length,
        screenshot_count: events.filter((event) => Boolean(event.screenshot)).length,
        screenshots: events
          .filter((event): event is UxTraceEventRecord & { screenshot: string } => Boolean(event.screenshot))
          .map((event) => ({
            seq: event.seq,
            step_id: event.stepId,
            file: event.screenshot,
            route: event.route ?? options.route,
            note: event.note,
          })),
      };

      await writeBundle(manifest);
      return manifest;
    },
  };
}
