import path from 'node:path';
import {
  loadAllStoryDefinitionsSync,
  type StorySceneDefinition,
} from './story-loader';
import type {
  StoryAuthLane,
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
  storyEvidencePolicy: VisualBaselineStoryEvidencePolicy;
  storyEvidenceKind: VisualBaselineStoryEvidenceKind;
  storyEvidenceOwner: VisualBaselineStoryEvidenceOwner;
  entries: VisualBaselineCatalogEntry[];
};

export type VisualBaselineReviewVerdict = 'pending' | 'aligned' | 'needs_work' | 'blocked';

export type VisualBaselineReviewRecord = {
  reviewer: string;
  reviewedAt: string;
  verdict: VisualBaselineReviewVerdict;
  cursorFit: 'aligned' | 'partial' | 'drifting';
  uxFit: 'low_mindload' | 'mixed' | 'friction';
  notes: string[];
  blockingFindings?: string[];
};

const STORY_ROOT = path.resolve('e2e/stories');

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

export function resolveVisualBaselineReviewDir(options: {
  outputRoot?: string;
  runId: string;
  scenarioId: string;
}): string {
  const root = path.resolve(options.outputRoot ?? process.env.VISUAL_BASELINE_REVIEW_ROOT ?? 'artifacts/visual-baseline-reviews');
  return path.join(root, options.runId, options.scenarioId);
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
  ];
  if (build) {
    lines.push(
      `- build_lane: ${build.lane}`,
      `- build_run_id: ${build.runId}`,
      `- build_git_sha: ${build.gitSha}`,
      `- build_fingerprint: ${build.fingerprint}`,
      `- build_started_at: ${build.startedAt}`,
    );
  }
  lines.push(
    `- reviewer: ${review.reviewer}`,
    `- reviewed_at: ${review.reviewedAt}`,
    `- verdict: ${review.verdict}`,
    `- cursor_fit: ${review.cursorFit}`,
    `- ux_fit: ${review.uxFit}`,
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
    '## Notes',
    '',
    ...(review.notes.length ? review.notes.map((note) => `- ${note}`) : ['- <none>']),
  );
  if (review.blockingFindings?.length) {
    lines.push('', '## Blocking Findings', '', ...review.blockingFindings.map((item) => `- ${item}`));
  }
  return `${lines.join('\n')}\n`;
}

export function resolveVisualBaselineStableMarkers(scenarioId: string): readonly string[] {
  return getMockLaneCatalogEntries().find((scenario) => scenario.scenarioId === scenarioId)?.stableMarkers ?? [];
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
