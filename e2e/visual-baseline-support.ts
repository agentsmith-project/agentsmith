import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadAllStoryDefinitionsSync,
  type StorySceneDefinition,
} from './story-loader';
import type {
  StoryAuthLane,
  StoryRuntimeVisualSemanticAssertionsDefinition,
  StoryRuntimeVisualReviewSceneDefinition,
  StoryVisualReviewCaptureMode,
  StoryVisualReviewScenarioGroup,
  StoryVisualReviewTheme,
} from './story-contract';
import { themedScreenshotName, type VisualTheme } from './utils/visual-theme';

const LOCALE = 'en-US';
const WS_ID = 'ws_default';
const ALT_WS_ID = 'ws_test';
const PROJECT_ID = 'proj_001';

function projectPath(section: string) {
  return `/${LOCALE}/workspaces/${WS_ID}/projects/${PROJECT_ID}/${section}`;
}

export type VisualRecipeFamily =
  | 'public_auth_single'
  | 'public_auth_split'
  | 'work_surface_standard'
  | 'work_surface_immersive'
  | 'settings_sheet'
  | 'governance_table_detail'
  | 'system_admin_detail'
  | 'overlay_dialog'
  | 'overlay_sheet';

export type VisualBaselineTheme = StoryVisualReviewTheme;
export type VisualBaselineScenarioGroup =
  StoryVisualReviewScenarioGroup;

export type VisualBaselineAuthLane = StoryAuthLane;

export type VisualBaselineCaptureMode = StoryVisualReviewCaptureMode;
export type VisualBaselineBuildLane = 'mock-lane' | 'backend-real';
export type VisualBaselineStoryEvidencePolicy = 'required';
export type VisualBaselineStoryEvidenceKind = 'visual_scene_catalog';
export type VisualBaselineStoryEvidenceOwner = 'lane:visual';

export type VisualBaselineBuildRecord = {
  lane: VisualBaselineBuildLane;
  runId: string;
  gitSha: string;
  fingerprint: string;
  startedAt: string;
};

export const VISUAL_BASELINE_DEFAULT_FORBIDDEN_VISIBLE_TEXT = [
  'Invalid Date',
  '[object Object]',
  'undefined',
] as const;

export type VisualBaselineSemanticAssertions = {
  forbiddenVisibleText: readonly string[];
  forbiddenVisibleTextPatterns: readonly string[];
  requiredViewportTestIds: readonly string[];
  primaryActionTestIds: readonly string[];
  maxProminentActions: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueNonEmptyTexts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function resolveSemanticAssertionsFromStoryScene(
  assertions: StoryRuntimeVisualSemanticAssertionsDefinition | undefined,
): VisualBaselineSemanticAssertions {
  const allowedDefaultTokens = new Set(assertions?.allowedDefaultForbiddenVisibleText ?? []);
  const defaultForbiddenVisibleText = VISUAL_BASELINE_DEFAULT_FORBIDDEN_VISIBLE_TEXT
    .filter((text) => !allowedDefaultTokens.has(text));

  return {
    forbiddenVisibleText: uniqueNonEmptyTexts([
      ...defaultForbiddenVisibleText,
      ...(assertions?.forbiddenVisibleText ?? []),
    ]),
    forbiddenVisibleTextPatterns: uniqueNonEmptyTexts(assertions?.forbiddenVisibleTextPatterns ?? []),
    requiredViewportTestIds: uniqueNonEmptyTexts(assertions?.requiredViewportTestIds ?? []),
    primaryActionTestIds: uniqueNonEmptyTexts(assertions?.primaryActionTestIds ?? []),
    maxProminentActions: assertions?.maxProminentActions ?? null,
  };
}

export function fingerprintVisualBaselineSemanticAssertions(
  assertions: VisualBaselineSemanticAssertions,
): string {
  return `sha256:${sha256Hex(stableJsonStringify(assertions))}`;
}

function isVisualBaselineBuildLane(value: unknown): value is VisualBaselineBuildLane {
  return value === 'mock-lane' || value === 'backend-real';
}

function readRequiredBuildString(
  payload: Record<string, unknown>,
  field: 'run_id' | 'git_sha' | 'fingerprint' | 'started_at',
  sourceLabel: string,
): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${sourceLabel} must define non-empty snake_case visual build metadata field: ${field}`);
  }
  return value;
}

export function parseVisualBaselineBuildRecord(
  payload: unknown,
  sourceLabel = 'visual build metadata',
): VisualBaselineBuildRecord {
  if (!isRecord(payload)) {
    throw new Error(`${sourceLabel} must be a JSON object.`);
  }
  if (!isVisualBaselineBuildLane(payload.lane)) {
    throw new Error(`${sourceLabel} must define lane as mock-lane or backend-real.`);
  }

  return {
    lane: payload.lane,
    runId: readRequiredBuildString(payload, 'run_id', sourceLabel),
    gitSha: readRequiredBuildString(payload, 'git_sha', sourceLabel),
    fingerprint: readRequiredBuildString(payload, 'fingerprint', sourceLabel),
    startedAt: readRequiredBuildString(payload, 'started_at', sourceLabel),
  };
}

export function readVisualBaselineBuildRecord(filePath: string): VisualBaselineBuildRecord {
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  return parseVisualBaselineBuildRecord(payload, filePath);
}

export type VisualBaselineCatalogEntry = {
  id: string;
  scenarioId: string;
  storySceneId: string;
  storySourceFile: string;
  screenshot: string;
  route: string;
  theme: VisualBaselineTheme;
  group: VisualBaselineScenarioGroup;
  recipeFamily: VisualRecipeFamily;
  storyId: string;
  scenario: string;
  codeRefs: readonly string[];
  capture: VisualBaselineCaptureMode;
  authLane: VisualBaselineAuthLane;
  viewport: 'default' | 'ultrawide';
  setupNotes: readonly string[];
  stableMarkers: readonly string[];
  semanticAssertions: VisualBaselineSemanticAssertions;
  storyEvidencePolicy: VisualBaselineStoryEvidencePolicy;
  storyEvidenceKind: VisualBaselineStoryEvidenceKind;
  storyEvidenceOwner: VisualBaselineStoryEvidenceOwner;
  sourceSpec: 'e2e/visual.spec.ts';
};

export type VisualBaselineScenarioRecord = {
  scenarioId: string;
  storySceneId: string;
  storySourceFile: string;
  group: VisualBaselineScenarioGroup;
  route: string;
  recipeFamily: VisualRecipeFamily;
  storyId: string;
  scenario: string;
  codeRefs: readonly string[];
  capture: VisualBaselineCaptureMode;
  authLane: VisualBaselineAuthLane;
  viewport: 'default' | 'ultrawide';
  setupNotes: readonly string[];
  stableMarkers: readonly string[];
  semanticAssertions: VisualBaselineSemanticAssertions;
  storyEvidencePolicy: VisualBaselineStoryEvidencePolicy;
  storyEvidenceKind: VisualBaselineStoryEvidenceKind;
  storyEvidenceOwner: VisualBaselineStoryEvidenceOwner;
  entries: VisualBaselineCatalogEntry[];
};

export type VisualBaselineExecutorScenario = Omit<VisualBaselineScenarioRecord, 'entries'> & {
  entries: readonly VisualBaselineCatalogEntry[];
};

export type VisualBaselineReviewVerdict = 'accepted' | 'needs_work' | 'blocked';
export type VisualBaselineAutomatedVerdict = 'passed' | 'failed';
export type VisualBaselineSemanticVerdict = 'passed' | 'failed';
export type VisualBaselineReviewerKind = 'human' | 'ai_reviewer';
export type VisualBaselineReviewMode =
  | 'manual_screenshot_review'
  | 'ai_native_screenshot_review'
  | 'pair_review';

export type VisualBaselineReviewRecord = {
  reviewerId: string;
  reviewerKind: VisualBaselineReviewerKind;
  reviewMode: VisualBaselineReviewMode;
  reviewedAt: string;
  verdict: VisualBaselineReviewVerdict;
  actualUrl: string;
  findings: readonly string[];
  blockingFindings?: string[];
};

export type VisualBaselineAutomatedPassRecord = {
  generatedAt: string;
  automatedVerdict: VisualBaselineAutomatedVerdict;
  semanticVerdict: VisualBaselineSemanticVerdict;
  actualUrl: string;
  notes: readonly string[];
};

export type VisualBaselineScenarioScreenshotEvidence = {
  fileName: string;
  theme: VisualBaselineTheme;
  screenshotSha256: string;
  baselineSha256: string;
};

export type VisualBaselineScenarioEvidence = {
  storyFingerprint: string;
  screenshots: readonly VisualBaselineScenarioScreenshotEvidence[];
};

const STORY_ROOT = path.resolve('e2e/stories');
const VISUAL_SCREENSHOT_ROOT = path.resolve('e2e/__screenshots__/visual.spec.ts');

const VISUAL_BASELINE_STORY_EVIDENCE = {
  policy: 'required',
  kind: 'visual_scene_catalog',
  owner: 'lane:visual',
} as const;

function loadMockLaneVisualStories(): StoryDefinition[] {
  return loadAllStoryDefinitionsSync({ rootDir: STORY_ROOT }).filter((story) => story.lane === 'mock-lane');
}

function resolveStoryScene(story: StoryDefinition, sceneId: string): StorySceneDefinition {
  const scene = story.scenes.find((entry) => entry.sceneId === sceneId);
  if (!scene) {
    throw new Error(`mock-lane visual story ${story.storyId} references unknown story scene: ${sceneId}`);
  }
  return scene;
}

function buildMockLaneCatalogEntries(): VisualBaselineCatalogEntry[] {
  return loadMockLaneVisualStories()
    .flatMap((story) => {
      const storySourceFile = story.sourceFile ?? story.filePath;
      const visualScenes: readonly StoryRuntimeVisualReviewSceneDefinition[] | undefined = story.runtimeData?.visualReview?.scenes;
      if (!visualScenes || visualScenes.length === 0) {
        throw new Error(`mock-lane visual story ${story.storyId} must define runtimeData.visualReview.scenes`);
      }
      return visualScenes.flatMap((scene) => {
        const storyScene = resolveStoryScene(story, scene.sceneId);
        const base = {
          scenarioId: scene.scenarioId,
          storySceneId: scene.sceneId,
          storySourceFile,
          route: storyScene.route,
          group: scene.group,
          recipeFamily: storyScene.recipeFamily ?? 'work_surface_standard',
          storyId: story.storyId,
          scenario: scene.scenario,
          codeRefs: scene.codeRefs,
          capture: scene.capture,
          authLane: scene.authLane ?? storyScene.authLane ?? 'authed',
          viewport: scene.viewport ?? 'default',
          setupNotes: scene.setupNotes ?? [],
          stableMarkers: storyScene.stableMarkers,
          semanticAssertions: resolveSemanticAssertionsFromStoryScene(scene.semanticAssertions),
          storyEvidencePolicy: scene.storyEvidencePolicy ?? VISUAL_BASELINE_STORY_EVIDENCE.policy,
          storyEvidenceKind: scene.storyEvidenceKind ?? VISUAL_BASELINE_STORY_EVIDENCE.kind,
          storyEvidenceOwner: scene.storyEvidenceOwner ?? VISUAL_BASELINE_STORY_EVIDENCE.owner,
          sourceSpec: 'e2e/visual.spec.ts' as const,
        };

        if (scene.themes?.length) {
          return scene.themes.map((theme) => ({
            ...base,
            id: `${scene.scenarioId}-${theme}`,
            screenshot:
              theme === 'default'
                ? `${scene.screenshotBaseName ?? scene.scenarioId}.png`
                : themedScreenshotName(scene.screenshotBaseName ?? scene.scenarioId, theme),
            theme,
          }));
        }

        return [{
          ...base,
          id: scene.scenarioId,
          screenshot: `${scene.screenshotBaseName ?? scene.scenarioId}.png`,
          theme: 'default' as const,
        }];
      });
    })
    .sort((left, right) => left.screenshot.localeCompare(right.screenshot));
}

let cachedMockLaneCatalogEntries: VisualBaselineCatalogEntry[] | undefined;

function getMockLaneCatalogEntries(): VisualBaselineCatalogEntry[] {
  if (!cachedMockLaneCatalogEntries) {
    cachedMockLaneCatalogEntries = buildMockLaneCatalogEntries();
  }
  return cachedMockLaneCatalogEntries;
}

export function listVisualBaselineCatalogEntries(): VisualBaselineCatalogEntry[] {
  return getMockLaneCatalogEntries();
}

export function groupVisualBaselineCatalogByScenario(
  entries: readonly VisualBaselineCatalogEntry[] = listVisualBaselineCatalogEntries(),
): Map<string, VisualBaselineScenarioRecord> {
  const grouped = new Map<string, VisualBaselineScenarioRecord>();
  for (const entry of entries) {
    const existing = grouped.get(entry.scenarioId);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    grouped.set(entry.scenarioId, {
      scenarioId: entry.scenarioId,
      storySceneId: entry.storySceneId,
      storySourceFile: entry.storySourceFile,
      group: entry.group,
      route: entry.route,
      recipeFamily: entry.recipeFamily,
      storyId: entry.storyId,
      scenario: entry.scenario,
      codeRefs: entry.codeRefs,
      capture: entry.capture,
      authLane: entry.authLane,
      viewport: entry.viewport,
      setupNotes: entry.setupNotes,
      stableMarkers: entry.stableMarkers,
      semanticAssertions: entry.semanticAssertions,
      storyEvidencePolicy: entry.storyEvidencePolicy,
      storyEvidenceKind: entry.storyEvidenceKind,
      storyEvidenceOwner: entry.storyEvidenceOwner,
      entries: [entry],
    });
  }
  for (const value of grouped.values()) {
    value.entries.sort((left, right) => left.screenshot.localeCompare(right.screenshot));
  }
  return grouped;
}

export function buildVisualBaselineExecutorScenarios(
  entries: readonly VisualBaselineCatalogEntry[] = listVisualBaselineCatalogEntries(),
): VisualBaselineExecutorScenario[] {
  return [...groupVisualBaselineCatalogByScenario(entries).values()]
    .map((scenario) => ({
      ...scenario,
      entries: [...scenario.entries],
    }))
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
}

export function listVisualBaselineExecutorScenarios(): VisualBaselineExecutorScenario[] {
  return buildVisualBaselineExecutorScenarios();
}

function normalizeRouteFromUrl(value: string): string {
  const parsed = new URL(value, 'http://agentsmith.visual.local');
  return `${parsed.pathname}${parsed.search}`;
}

export function assertVisualBaselineActualUrlMatchesRoute(args: {
  scenarioId: string;
  expectedRoute: string;
  actualUrl: string;
}) {
  const expectedRoute = normalizeRouteFromUrl(args.expectedRoute);
  const actualRoute = normalizeRouteFromUrl(args.actualUrl);
  if (actualRoute !== expectedRoute) {
    throw new Error(
      `visual route drift for ${args.scenarioId}: expected catalog route ${expectedRoute}, received actual route ${actualRoute}`,
    );
  }
}

export function resolveVisualBaselineReviewDir(options: {
  outputRoot?: string;
  runId: string;
  scenarioId: string;
}): string {
  const root = path.resolve(options.outputRoot ?? process.env.VISUAL_BASELINE_REVIEW_ROOT ?? 'artifacts/visual-baseline-reviews');
  return path.join(root, options.runId, options.scenarioId);
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256File(pathname: string): string {
  return sha256Hex(readFileSync(pathname));
}

function formatScreenshotHashMap(
  screenshots: readonly VisualBaselineScenarioScreenshotEvidence[],
  field: 'screenshotSha256' | 'baselineSha256',
): string {
  return screenshots
    .map((entry) => `${entry.fileName}=sha256:${entry[field]}`)
    .join('; ');
}

export function buildVisualBaselineScenarioEvidence(
  scenario: VisualBaselineScenarioRecord,
): VisualBaselineScenarioEvidence {
  const storyFingerprintPayload = {
    scenarioId: scenario.scenarioId,
    storyId: scenario.storyId,
    storySceneId: scenario.storySceneId,
    storySourceFile: scenario.storySourceFile,
    route: scenario.route,
    group: scenario.group,
    recipeFamily: scenario.recipeFamily,
    codeRefs: scenario.codeRefs,
    capture: scenario.capture,
    authLane: scenario.authLane,
    viewport: scenario.viewport,
    setupNotes: scenario.setupNotes,
    stableMarkers: scenario.stableMarkers,
    semanticAssertions: scenario.semanticAssertions,
    screenshots: scenario.entries.map((entry) => ({
      fileName: entry.screenshot,
      theme: entry.theme,
    })),
  };

  return {
    storyFingerprint: `sha256:${sha256Hex(stableJsonStringify(storyFingerprintPayload))}`,
    screenshots: scenario.entries.map((entry) => {
      const baselineSha256 = sha256File(path.join(VISUAL_SCREENSHOT_ROOT, entry.screenshot));
      return {
        fileName: entry.screenshot,
        theme: entry.theme,
        // The mock visual lane only persists committed baselines today; the accepted screenshot
        // hash is therefore bound to the exact baseline the reviewer accepted.
        screenshotSha256: baselineSha256,
        baselineSha256,
      };
    }),
  };
}

function pushScenarioEvidenceMetadata(
  lines: string[],
  scenario: VisualBaselineScenarioRecord,
): void {
  const evidence = buildVisualBaselineScenarioEvidence(scenario);
  lines.push(
    `- story_fingerprint: ${evidence.storyFingerprint}`,
    `- accepted_screenshot_hashes: ${formatScreenshotHashMap(evidence.screenshots, 'screenshotSha256')}`,
    `- accepted_baseline_hashes: ${formatScreenshotHashMap(evidence.screenshots, 'baselineSha256')}`,
  );
}

function pushVisualBaselineBuildMetadata(
  lines: string[],
  build: VisualBaselineBuildRecord | undefined,
): void {
  if (!build) {
    return;
  }
  lines.push(
    `- build_lane: ${build.lane}`,
    `- build_run_id: ${build.runId}`,
    `- build_git_sha: ${build.gitSha}`,
    `- build_fingerprint: ${build.fingerprint}`,
    `- build_started_at: ${build.startedAt}`,
  );
}

function visualBaselineScenarioMetadataLines(
  scenario: VisualBaselineScenarioRecord,
): string[] {
  const forbiddenVisibleText = scenario.semanticAssertions.forbiddenVisibleText;
  const forbiddenVisibleTextPatterns = scenario.semanticAssertions.forbiddenVisibleTextPatterns;
  const requiredViewportTestIds = scenario.semanticAssertions.requiredViewportTestIds;
  const primaryActionTestIds = scenario.semanticAssertions.primaryActionTestIds;
  const maxProminentActions = scenario.semanticAssertions.maxProminentActions;
  return [
    `- scenario_id: ${scenario.scenarioId}`,
    `- route: ${scenario.route}`,
    `- recipe_family: ${scenario.recipeFamily}`,
    `- scenario_group: ${scenario.group}`,
    `- story_id: ${scenario.storyId}`,
    `- story_scene_id: ${scenario.storySceneId}`,
    `- story_source_file: ${scenario.storySourceFile}`,
    `- story_evidence_policy: ${scenario.storyEvidencePolicy}`,
    `- story_evidence_kind: ${scenario.storyEvidenceKind}`,
    `- story_evidence_owner: ${scenario.storyEvidenceOwner}`,
    `- auth_lane: ${scenario.authLane}`,
    `- capture: ${scenario.capture}`,
    `- viewport: ${scenario.viewport}`,
    `- stable_markers: ${scenario.stableMarkers.length > 0 ? scenario.stableMarkers.join(', ') : '<none>'}`,
    `- semantic_contract_fingerprint: ${fingerprintVisualBaselineSemanticAssertions(scenario.semanticAssertions)}`,
    `- semantic_forbidden_visible_text: ${forbiddenVisibleText.length > 0 ? forbiddenVisibleText.join(', ') : '<none>'}`,
    `- semantic_forbidden_visible_text_patterns: ${forbiddenVisibleTextPatterns.length > 0 ? forbiddenVisibleTextPatterns.join(', ') : '<none>'}`,
    `- semantic_required_viewport_test_ids: ${requiredViewportTestIds.length > 0 ? requiredViewportTestIds.join(', ') : '<none>'}`,
    `- semantic_primary_action_test_ids: ${primaryActionTestIds.length > 0 ? primaryActionTestIds.join(', ') : '<none>'}`,
    `- semantic_max_prominent_actions: ${maxProminentActions ?? '<none>'}`,
  ];
}

export function renderVisualBaselineScenarioReviewMarkdown(args: {
  scenario: VisualBaselineScenarioRecord;
  build?: VisualBaselineBuildRecord;
  review: VisualBaselineReviewRecord;
}): string {
  const { scenario, build, review } = args;
  const lines = [
    `# ${scenario.scenarioId}`,
    '',
    '- schema: visual_baseline_ux_acceptance/v1',
    ...visualBaselineScenarioMetadataLines(scenario),
    `- actual_url: ${review.actualUrl}`,
  ];
  pushScenarioEvidenceMetadata(lines, scenario);
  pushVisualBaselineBuildMetadata(lines, build);
  lines.push(
    `- reviewer_id: ${review.reviewerId}`,
    `- reviewer_kind: ${review.reviewerKind}`,
    `- review_mode: ${review.reviewMode}`,
    `- reviewed_at: ${review.reviewedAt}`,
    `- verdict: ${review.verdict}`,
    `- findings: ${review.findings.length > 0 ? `${review.findings.length}` : '<none>'}`,
    '',
    '## Scenario',
    '',
    scenario.scenario,
    '',
    '## Screenshots',
    '',
    ...scenario.entries.map((entry) => `- ${entry.screenshot} [${entry.theme}]`),
    '',
    '## Code References',
    '',
    ...scenario.codeRefs.map((ref) => `- ${ref}`),
    '',
    '## Findings',
    '',
    ...(review.findings.length ? review.findings.map((finding) => `- ${finding}`) : ['- <none>']),
  );
  if (review.blockingFindings?.length) {
    lines.push('', '## Blocking Findings', '', ...review.blockingFindings.map((item) => `- ${item}`));
  }
  return `${lines.join('\n')}\n`;
}

export function renderVisualBaselineAutomatedPassMarkdown(args: {
  scenario: VisualBaselineScenarioRecord;
  build: VisualBaselineBuildRecord;
  automated: VisualBaselineAutomatedPassRecord;
}): string {
  const { scenario, build, automated } = args;
  const lines = [
    `# ${scenario.scenarioId}`,
    '',
    '- schema: visual_baseline_automated_pass/v1',
    ...visualBaselineScenarioMetadataLines(scenario),
    `- actual_url: ${automated.actualUrl}`,
  ];
  pushScenarioEvidenceMetadata(lines, scenario);
  pushVisualBaselineBuildMetadata(lines, build);
  lines.push(
    `- generated_at: ${automated.generatedAt}`,
    `- automated_verdict: ${automated.automatedVerdict}`,
    `- semantic_verdict: ${automated.semanticVerdict}`,
    '',
    '## Scenario',
    '',
    scenario.scenario,
    '',
    '## Screenshots',
    '',
    ...scenario.entries.map((entry) => `- ${entry.screenshot} [${entry.theme}]`),
    '',
    '## Notes',
    '',
    ...(automated.notes.length ? automated.notes.map((note) => `- ${note}`) : ['- <none>']),
  );
  return `${lines.join('\n')}\n`;
}

export function resolveVisualBaselineStableMarkers(scenarioId: string): readonly string[] {
  return getMockLaneCatalogEntries().find((scenario) => scenario.scenarioId === scenarioId)?.stableMarkers ?? [];
}

export function resolveVisualBaselineSemanticAssertions(scenarioId: string): VisualBaselineSemanticAssertions {
  return getMockLaneCatalogEntries().find((scenario) => scenario.scenarioId === scenarioId)?.semanticAssertions
    ?? resolveSemanticAssertionsFromStoryScene(undefined);
}

export function resolveVisualBaselineStoryEvidence(scenarioId: string): {
  policy: VisualBaselineStoryEvidencePolicy;
  kind: VisualBaselineStoryEvidenceKind;
  owner: VisualBaselineStoryEvidenceOwner;
} {
  const scenario = getMockLaneCatalogEntries().find((entry) => entry.scenarioId === scenarioId);
  return {
    policy: scenario?.storyEvidencePolicy ?? VISUAL_BASELINE_STORY_EVIDENCE.policy,
    kind: scenario?.storyEvidenceKind ?? VISUAL_BASELINE_STORY_EVIDENCE.kind,
    owner: scenario?.storyEvidenceOwner ?? VISUAL_BASELINE_STORY_EVIDENCE.owner,
  };
}
