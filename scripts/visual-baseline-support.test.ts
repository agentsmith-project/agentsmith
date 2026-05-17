import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinition, parseStoryDefinition } from '../e2e/story-loader';
import {
  getRequiredStoryVisualSceneBundle,
  listStorySceneIds,
  listStoryVisualSceneIds,
} from './story-visual-scene-fixtures';
import {
  assertVisualBaselineActualUrlMatchesRoute,
  buildVisualBaselineScenarioEvidence,
  fingerprintVisualBaselineSemanticAssertions,
  buildVisualBaselineExecutorScenarios,
  groupVisualBaselineCatalogByScenario,
  listVisualBaselineCatalogEntries,
  listVisualBaselineExecutorScenarios,
  parseVisualBaselineBuildRecord,
  renderVisualBaselineAutomatedPassMarkdown,
  renderVisualBaselineScenarioReviewMarkdown,
  resolveVisualBaselineSemanticAssertions,
  resolveVisualBaselineStoryEvidence,
  resolveVisualBaselineStableMarkers,
  resolveVisualBaselineReviewDir,
  type VisualBaselineCatalogEntry,
} from '../e2e/visual-baseline-support';

function extractSourceSection(args: {
  source: string;
  start: string;
  end: string;
}) {
  const startIndex = args.source.indexOf(args.start);
  const endIndex = args.source.indexOf(args.end, startIndex + args.start.length);

  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);

  return args.source.slice(startIndex, endIndex);
}

function seedRunBoundVisualActualCaptures(
  buildInfoPath: string,
  overrides: Record<string, string | Buffer> = {},
  includedScenarioIds?: readonly string[],
): string {
  const actualRoot = path.join(path.dirname(buildInfoPath), 'visual-actual-captures');
  const screenshotRoot = path.resolve('e2e/__screenshots__/visual.spec.ts');
  const includedScenarios = includedScenarioIds ? new Set(includedScenarioIds) : null;

  for (const scenario of groupVisualBaselineCatalogByScenario().values()) {
    if (includedScenarios && !includedScenarios.has(scenario.scenarioId)) {
      continue;
    }
    for (const entry of scenario.entries) {
      const relativeCapturePath = path.join(scenario.scenarioId, entry.screenshot);
      const targetPath = path.join(actualRoot, relativeCapturePath);
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeFileSync(
        targetPath,
        overrides[relativeCapturePath] ?? readFileSync(path.join(screenshotRoot, entry.screenshot)),
      );
    }
  }

  return actualRoot;
}

describe('visual baseline support', () => {
  it('catalogs every committed visual baseline screenshot exactly once', async () => {
    const entries = listVisualBaselineCatalogEntries();
    const screenshotsDir = path.resolve('e2e/__screenshots__/visual.spec.ts');
    const files = (await readdir(screenshotsDir))
      .filter((file) => file.endsWith('.png'))
      .sort();

    expect(entries.map((entry) => entry.screenshot)).toEqual(files);
  });

  it('records route, recipe family, story, and code references for every baseline', async () => {
    const entries = listVisualBaselineCatalogEntries();
    const screenshotsDir = path.resolve('e2e/__screenshots__/visual.spec.ts');
    const files = (await readdir(screenshotsDir)).filter((file) => file.endsWith('.png'));

    expect(entries).toHaveLength(files.length);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);

    for (const entry of entries) {
      expect(entry.route.startsWith('/en-US/')).toBe(true);
      expect(entry.recipeFamily.length).toBeGreaterThan(0);
      expect(entry.storyId.length).toBeGreaterThan(0);
      expect(entry.scenario.length).toBeGreaterThan(0);
      expect(entry.codeRefs.length).toBeGreaterThan(0);
      expect(entry.storyEvidencePolicy).toBe('required');
      expect(entry.storyEvidenceKind).toBe('visual_scene_catalog');
      expect(entry.storyEvidenceOwner).toBe('lane:visual');
      expect(entry.semanticAssertions.forbiddenVisibleText).toEqual(expect.arrayContaining([
        'Invalid Date',
        '[object Object]',
        'undefined',
      ]));
      expect(entry.sourceSpec).toBe('e2e/visual.spec.ts');
      expect(entry.storySourceFile).toMatch(/^e2e\/stories\/mock-lane\//);
      expect(entry.storySceneId.length).toBeGreaterThan(0);
    }
  });

  it('models workspace-login visual truth as public workspace access, not an authenticated page', async () => {
    const story = await loadStoryDefinition('mock-lane-entry-access');
    const scene = story.scenes.find((entry) => entry.sceneId === 'workspace-login');
    const visualScene = story.runtimeData?.visualReview?.scenes.find((entry) => entry.sceneId === 'workspace-login');
    const grouped = groupVisualBaselineCatalogByScenario();
    const scenario = grouped.get('workspace-login');

    expect(scene).toMatchObject({
      route: '/en-US/workspaces/ws_default/login',
      authLane: 'public',
      stableMarkers: ['public-auth__shell', 'workspace-login__heading', 'workspace-login__keycloak-btn'],
    });
    expect(visualScene).toMatchObject({
      scenarioId: 'workspace-login',
      authLane: 'public',
      scenario: expect.stringContaining('Workspace login'),
    });
    expect(scenario).toMatchObject({
      route: '/en-US/workspaces/ws_default/login',
      authLane: 'public',
      recipeFamily: 'public_auth_single',
    });
  });

  it('keeps visual auth lane metadata explicit and outlaws legacy auth booleans in visual specs', async () => {
    const visualSpec = await readFile(path.resolve('e2e/visual.spec.ts'), 'utf-8');

    expect(visualSpec).toContain('requireMockVisualRuntime');
    expect(visualSpec).toContain('ensureVisualMockAuth');
    expect(visualSpec).not.toContain('requiresMockAuthLane');
  });

  it('runs semantic assertions before visual screenshots and keeps workspace overview exact', async () => {
    const visualSpec = await readFile(path.resolve('e2e/visual.spec.ts'), 'utf-8');
    const captureHelperSource = extractSourceSection({
      source: visualSpec,
      start: 'async function captureSnapshotBoundActualScreenshot',
      end: 'async function runVisualScenario',
    });
    const runScenarioSource = extractSourceSection({
      source: visualSpec,
      start: 'async function runVisualScenario',
      end: "test.describe('Visual Auth Contract'",
    });

    const semanticIndex = runScenarioSource.indexOf(
      'expectVisualSemanticAssertions(page, scenario.semanticAssertions, scenario.scenarioId)',
    );
    const captureCallIndex = runScenarioSource.indexOf(
      'const actualCapture = await captureSnapshotBoundActualScreenshot({',
    );
    const writeCaptureIndex = runScenarioSource.indexOf('await writeRunBoundActualCapture({');
    const captureFactoryIndex = captureHelperSource.indexOf('const capturePageScreenshot = () => args.page.screenshot({');
    const initialCaptureIndex = captureHelperSource.indexOf('const actual = await capturePageScreenshot();');
    const compareFactoryIndex = captureHelperSource.indexOf(
      'const compareScreenshots = async (candidate: Buffer) => screenshotComparator(',
    );
    const initialComparisonIndex = captureHelperSource.indexOf('let comparison = await compareScreenshots(actual);');
    const retryCaptureIndex = captureHelperSource.indexOf('failedActual = await capturePageScreenshot();');
    const retryComparisonIndex = captureHelperSource.indexOf('comparison = await compareScreenshots(failedActual);');
    const comparisonGuardIndex = captureHelperSource.indexOf('if (comparison) {');
    const returnCaptureIndex = captureHelperSource.indexOf('return failedActual;');

    expect(semanticIndex).toBeGreaterThan(-1);
    expect(captureCallIndex).toBeGreaterThan(-1);
    expect(writeCaptureIndex).toBeGreaterThan(-1);
    expect(captureFactoryIndex).toBeGreaterThan(-1);
    expect(initialCaptureIndex).toBeGreaterThan(-1);
    expect(compareFactoryIndex).toBeGreaterThan(-1);
    expect(initialComparisonIndex).toBeGreaterThan(-1);
    expect(retryCaptureIndex).toBeGreaterThan(-1);
    expect(retryComparisonIndex).toBeGreaterThan(-1);
    expect(comparisonGuardIndex).toBeGreaterThan(-1);
    expect(returnCaptureIndex).toBeGreaterThan(-1);
    expect(semanticIndex).toBeLessThan(captureCallIndex);
    expect(captureCallIndex).toBeLessThan(writeCaptureIndex);
    expect(captureFactoryIndex).toBeLessThan(initialCaptureIndex);
    expect(initialCaptureIndex).toBeLessThan(compareFactoryIndex);
    expect(compareFactoryIndex).toBeLessThan(initialComparisonIndex);
    expect(retryCaptureIndex).toBeLessThan(retryComparisonIndex);
    expect(initialComparisonIndex).toBeLessThan(comparisonGuardIndex);
    expect(comparisonGuardIndex).toBeLessThan(returnCaptureIndex);
    expect(visualSpec).not.toContain('toHaveScreenshot(entry.screenshot');
    expect(visualSpec).not.toContain('._expectScreenshot({');
    expect(visualSpec).toMatch(/'workspace-overview':[\s\S]*screenshotOptions:[\s\S]*maxDiffPixelRatio: 0/);
    expect(visualSpec).toContain('scenario.semanticAssertions.requiredViewportTestIds.length > 0');
    expect(visualSpec).toContain('maxDiffPixelRatio: 0');
  });

  it('waits for route workspace identity before visual screenshots to avoid shell-level flakes', async () => {
    const visualSpec = await readFile(path.resolve('e2e/visual.spec.ts'), 'utf-8');
    const runScenarioSource = extractSourceSection({
      source: visualSpec,
      start: 'async function runVisualScenario',
      end: "test.describe('Visual Auth Contract'",
    });

    const identityWaitIndex = runScenarioSource.indexOf('waitForVisualRouteWorkspaceIdentityReady(page, scenario)');
    const captureCallIndex = runScenarioSource.indexOf(
      'const actualCapture = await captureSnapshotBoundActualScreenshot({',
    );

    expect(visualSpec).toContain('async function waitForVisualRouteWorkspaceIdentityReady');
    expect(visualSpec).toContain('topbar__workspace-switcher');
    expect(identityWaitIndex).toBeGreaterThan(-1);
    expect(captureCallIndex).toBeGreaterThan(-1);
    expect(identityWaitIndex).toBeLessThan(captureCallIndex);
  });

  it('groups paired light/dark screenshots under the same scenario record', () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    const workspaceSelect = grouped.get('workspace-select');
    expect(workspaceSelect).toBeDefined();
    expect(workspaceSelect?.recipeFamily).toBe('public_auth_single');
    expect(workspaceSelect?.entries.map((entry) => entry.screenshot)).toEqual([
      'workspace-select-dark.png',
      'workspace-select-light.png',
    ]);

    const usageEndpointSwitch = grouped.get('usage-endpoint-switch');
    expect(usageEndpointSwitch).toBeDefined();
    expect(usageEndpointSwitch?.entries).toHaveLength(1);
    expect(usageEndpointSwitch?.entries[0]?.theme).toBe('default');
  });

  it('resolves story-owned visual semantic assertions with default corrupt-token guards', () => {
    const scenario = groupVisualBaselineCatalogByScenario().get('workspace-overview');
    expect(scenario).toBeDefined();

    expect(scenario?.stableMarkers).toEqual([
      'workspace-overview__list',
      'workspace-overview__summary',
    ]);
    expect(scenario?.semanticAssertions.forbiddenVisibleText).toEqual(expect.arrayContaining([
      'Invalid Date',
      '[object Object]',
      'undefined',
      'overview_updated_at',
    ]));
    expect(fingerprintVisualBaselineSemanticAssertions(scenario!.semanticAssertions)).toMatch(/^sha256:/);
    expect(resolveVisualBaselineSemanticAssertions('workspace-overview').forbiddenVisibleText).toContain('overview_updated_at');
  });

  it('requires agent-tasks create-task CTA semantic visibility in the first viewport instead of DOM visibility only', () => {
    const agentTasks = groupVisualBaselineCatalogByScenario().get('agent-tasks');
    const lifecycleList = groupVisualBaselineCatalogByScenario().get('agent-task-lifecycle-list');
    expect(agentTasks).toBeDefined();
    expect(lifecycleList).toBeDefined();

    expect(agentTasks?.semanticAssertions.requiredViewportTestIds).toContain('agent-tasks__create-task-btn');
    expect(lifecycleList?.semanticAssertions.requiredViewportTestIds).toContain('agent-tasks__create-task-btn');
    expect(resolveVisualBaselineSemanticAssertions('agent-task-lifecycle-list').requiredViewportTestIds)
      .toContain('agent-tasks__create-task-btn');
  });

  it('keeps chat search-empty recovery informational while the header CTA stays visible', () => {
    const chatRecoverEmpty = groupVisualBaselineCatalogByScenario().get('chat-recover-empty');
    expect(chatRecoverEmpty).toBeDefined();

    expect(chatRecoverEmpty?.semanticAssertions.requiredViewportTestIds).toEqual([
      'chat__new-thread-btn',
    ]);
    expect(chatRecoverEmpty?.semanticAssertions.prominentActionScopeTestIds).toEqual([
      'chat__threads-empty-state',
    ]);
    expect(chatRecoverEmpty?.semanticAssertions.maxProminentActions).toBe(0);
  });

  it('forbids stitched create-task dialog copy and top-level workspace wording in visual semantics', () => {
    const dialog = groupVisualBaselineCatalogByScenario().get('agent-tasks-create-task-dialog');
    const lifecycleDialog = groupVisualBaselineCatalogByScenario().get('agent-task-lifecycle-create-dialog');
    expect(dialog).toBeDefined();
    expect(lifecycleDialog).toBeDefined();

    for (const scenario of [dialog!, lifecycleDialog!]) {
      expect(scenario.semanticAssertions.forbiddenVisibleText).toEqual(expect.arrayContaining([
        'Create Task New Task',
        'Create New',
        'Initialize a new workspace automatically',
        'New workspace name',
        'Select Existing Workspace',
      ]));
    }
  });

  it('requires editable project settings review save actions to stay in the first viewport', () => {
    const settingsReview = groupVisualBaselineCatalogByScenario().get('project-settings-review');
    expect(settingsReview).toBeDefined();

    expect(settingsReview?.semanticAssertions.requiredViewportTestIds).toEqual(expect.arrayContaining([
      'settings__save-btn',
      'settings__project-admins-save',
    ]));
  });

  it('declares scene-owned prominent action limits for CTA hierarchy review scenes', () => {
    const systemWorkspacesEmpty = groupVisualBaselineCatalogByScenario().get('system-workspaces-empty');
    const systemWorkspacesDefault = groupVisualBaselineCatalogByScenario().get('system-workspaces-default');
    const systemWorkspacesEditMode = groupVisualBaselineCatalogByScenario().get('system-workspaces-edit-mode');
    const systemWorkspacesDeleteConfirmation = groupVisualBaselineCatalogByScenario().get('system-workspaces-delete-confirmation');
    const failedSystemWorkspaces = groupVisualBaselineCatalogByScenario().get('system-workspaces-failed-state');
    const disabledConnections = groupVisualBaselineCatalogByScenario().get('workspace-connections-feishu-disabled');
    const connectedConnections = groupVisualBaselineCatalogByScenario().get('workspace-connections-feishu-connected');

    expect(systemWorkspacesEmpty?.semanticAssertions.primaryActionTestIds).toEqual([
      'system-workspaces__empty::system-workspaces__empty-create',
    ]);
    expect(systemWorkspacesEmpty?.semanticAssertions.prominentActionScopeTestIds).toEqual([
      'page-layout__header',
      'system-workspaces__list',
      'system-workspaces__editor-empty',
    ]);
    expect(systemWorkspacesEmpty?.semanticAssertions.maxProminentActions).toBe(1);
    expect(systemWorkspacesDefault?.semanticAssertions.primaryActionTestIds).toEqual([
      'page-layout__header::system-workspaces__new-workspace',
    ]);
    expect(systemWorkspacesDefault?.semanticAssertions.prominentActionScopeTestIds).toEqual([
      'page-layout__header',
      'system-workspaces__list',
      'system-workspaces__editor',
    ]);
    expect(systemWorkspacesDefault?.semanticAssertions.maxProminentActions).toBe(1);
    expect(systemWorkspacesEditMode?.semanticAssertions.primaryActionTestIds).toEqual([
      'system-workspaces__editor::system-workspaces__save',
    ]);
    expect(systemWorkspacesEditMode?.semanticAssertions.prominentActionScopeTestIds).toEqual([
      'page-layout__header',
      'system-workspaces__list',
      'system-workspaces__editor',
    ]);
    expect(systemWorkspacesEditMode?.semanticAssertions.maxProminentActions).toBe(1);
    expect(failedSystemWorkspaces?.semanticAssertions.primaryActionTestIds).toEqual([
      'system-workspaces__editor::system-workspaces__enable-edit',
    ]);
    expect(failedSystemWorkspaces?.semanticAssertions.prominentActionScopeTestIds).toEqual([
      'page-layout__header',
      'system-workspaces__list',
      'system-workspaces__editor',
    ]);
    expect(failedSystemWorkspaces?.semanticAssertions.maxProminentActions).toBe(1);
    expect(systemWorkspacesDeleteConfirmation?.semanticAssertions.primaryActionTestIds).toEqual([
      'system-workspaces__delete-dialog::system-workspaces__delete-confirm',
    ]);
    expect(systemWorkspacesDeleteConfirmation?.semanticAssertions.prominentActionScopeTestIds).toEqual([
      'page-layout__header',
      'system-workspaces__list',
      'system-workspaces__editor',
      'system-workspaces__delete-dialog',
    ]);
    expect(systemWorkspacesDeleteConfirmation?.semanticAssertions.maxProminentActions).toBe(1);
    expect(disabledConnections?.semanticAssertions.primaryActionTestIds).toEqual([]);
    expect(disabledConnections?.semanticAssertions.prominentActionScopeTestIds).toEqual([]);
    expect(disabledConnections?.semanticAssertions.maxProminentActions).toBe(0);
    expect(connectedConnections?.semanticAssertions.primaryActionTestIds).toEqual([]);
    expect(connectedConnections?.semanticAssertions.prominentActionScopeTestIds).toEqual([]);
    expect(connectedConnections?.semanticAssertions.maxProminentActions).toBe(0);
  });

  it('forbids raw backend ISO timestamps in workspace connections visual semantics', () => {
    const connectedConnections = groupVisualBaselineCatalogByScenario().get('workspace-connections-feishu-connected');
    expect(connectedConnections).toBeDefined();

    expect(connectedConnections?.semanticAssertions.forbiddenVisibleTextPatterns).toEqual(expect.arrayContaining([
      String.raw`\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b`,
    ]));
    expect(resolveVisualBaselineSemanticAssertions('workspace-connections-feishu-connected').forbiddenVisibleTextPatterns)
      .toContain(String.raw`\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b`);
  });

  it('declares required viewer-local datetime metadata for scenes that expose user-facing timestamps', () => {
    const connectedConnections = groupVisualBaselineCatalogByScenario().get('workspace-connections-feishu-connected');
    const agentTaskLifecycleList = groupVisualBaselineCatalogByScenario().get('agent-task-lifecycle-list');
    const systemWorkspacesDefault = groupVisualBaselineCatalogByScenario().get('system-workspaces-default');
    const systemWorkspacesEditMode = groupVisualBaselineCatalogByScenario().get('system-workspaces-edit-mode');
    const failedSystemWorkspaces = groupVisualBaselineCatalogByScenario().get('system-workspaces-failed-state');
    const systemWorkspacesDeleteConfirmation = groupVisualBaselineCatalogByScenario().get('system-workspaces-delete-confirmation');

    expect(connectedConnections?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'workspace-connections__last-refresh-value',
    ]);
    expect(agentTaskLifecycleList?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'agent-tasks__task-card--task_001::agent-tasks__task-last-activity',
      'agent-tasks__task-card--task_001::agent-tasks__task-created-at',
      'agent-tasks__task-card--task_002::agent-tasks__task-last-activity',
      'agent-tasks__task-card--task_002::agent-tasks__task-created-at',
    ]);
    expect(systemWorkspacesDefault?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'system-workspaces__list::system-workspaces__card-initialized-at--ws_seeded',
      'system-workspaces__editor::system-workspaces__detail-header-initialized-at',
      'system-workspaces__editor::system-workspaces__detail-facts-initialized-at',
    ]);
    expect(systemWorkspacesEditMode?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'system-workspaces__list::system-workspaces__card-initialized-at--ws_seeded',
      'system-workspaces__editor::system-workspaces__detail-header-initialized-at',
      'system-workspaces__editor::system-workspaces__detail-facts-initialized-at',
    ]);
    expect(failedSystemWorkspaces?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([]);
    expect(systemWorkspacesDeleteConfirmation?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'system-workspaces__list::system-workspaces__card-initialized-at--ws_seeded',
      'system-workspaces__editor::system-workspaces__detail-header-initialized-at',
      'system-workspaces__editor::system-workspaces__detail-facts-initialized-at',
    ]);
    expect(resolveVisualBaselineSemanticAssertions('workspace-connections-feishu-connected').requiredViewerLocalDateTimeTestIds)
      .toContain('workspace-connections__last-refresh-value');
  });

  it('rejects invalid story-owned forbidden visible text regex patterns before visual runtime', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "invalid-visible-text-pattern",
  "title": "Invalid visible text pattern",
  "actor": "reviewer",
  "lane": "mock-lane",
  "family": "visual-review",
  "personas": ["reviewer"],
  "kind": "review",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["visual"]
  },
  "externalDependencies": [],
  "entryRoute": "/en-US/workspaces/ws_default/connections",
  "goal": "Verify visual semantic patterns fail before runtime.",
  "narrative": "Regex semantic rules must be valid and reviewable before the screenshot lane runs.",
  "scenes": [
    {
      "sceneId": "workspace-connections",
      "route": "/en-US/workspaces/ws_default/connections",
      "stableMarkers": ["workspace-connections__capability-note"]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-connections",
      "sceneId": "workspace-connections",
      "intent": "Open workspace connections",
      "action": "Open workspace connections",
      "target": "workspace-connections__capability-note",
      "expectedFeedback": "Workspace connections are ready for review",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "workspace-connections",
          "scenarioId": "workspace-connections",
          "scenario": "Workspace connections visual review.",
          "group": "workspace_pages",
          "codeRefs": ["e2e/visual.spec.ts"],
          "capture": "full_page",
          "semanticAssertions": {
            "forbiddenVisibleTextPatterns": ["["]
          }
        }
      ]
    }
  }
}
---
`),
    ).toThrow(/forbidden visible text pattern/i);
  });

  it('rejects non-list viewer-local datetime semantic assertions before visual runtime', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "invalid-viewer-local-datetime-assertion",
  "title": "Invalid viewer local datetime assertion",
  "actor": "reviewer",
  "lane": "mock-lane",
  "family": "visual-review",
  "personas": ["reviewer"],
  "kind": "review",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["visual"]
  },
  "externalDependencies": [],
  "entryRoute": "/en-US/workspaces/ws_default/connections",
  "goal": "Verify viewer-local datetime semantic contracts fail before runtime.",
  "narrative": "Viewer-local datetime rules must be structurally valid before the screenshot lane runs.",
  "scenes": [
    {
      "sceneId": "workspace-connections",
      "route": "/en-US/workspaces/ws_default/connections",
      "stableMarkers": ["workspace-connections__capability-note"]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-connections",
      "sceneId": "workspace-connections",
      "intent": "Open workspace connections",
      "action": "Open workspace connections",
      "target": "workspace-connections__capability-note",
      "expectedFeedback": "Workspace connections are ready for review",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "workspace-connections",
          "scenarioId": "workspace-connections",
          "scenario": "Workspace connections visual review.",
          "group": "workspace_pages",
          "codeRefs": ["e2e/visual.spec.ts"],
          "capture": "full_page",
          "semanticAssertions": {
            "requiredViewerLocalDateTimeTestIds": "workspace-connections__last-refresh-value"
          }
        }
      ]
    }
  }
}
---
`),
    ).toThrow(/viewer-local datetime test ids must be a list/i);
  });

  it('renders a UX acceptance record with reviewer proof, actual URL, story fingerprint, and screenshot hashes', () => {
    const grouped = groupVisualBaselineCatalogByScenario();
    const scenario = grouped.get('workspace-login');
    expect(scenario).toBeDefined();
    const evidence = buildVisualBaselineScenarioEvidence(scenario!);

    const markdown = renderVisualBaselineScenarioReviewMarkdown({
      scenario: scenario!,
      build: {
        runId: 'run-20260412-001',
        gitSha: 'abc123',
        fingerprint: 'abc123:mock-lane:visual',
        startedAt: '2026-04-12T11:59:00.000Z',
        lane: 'mock-lane',
      },
      review: {
        reviewerId: 'codex-d1-reviewer',
        reviewerKind: 'ai_reviewer',
        reviewMode: 'ai_native_screenshot_review',
        reviewedAt: '2026-04-12T12:00:00.000Z',
        verdict: 'needs_work',
        actualUrl: '/en-US/workspaces/ws_default/login',
        findings: ['Single-column completion flow should align with the public auth shell recipe.'],
        blockingFindings: ['Light and dark screenshots must be reviewed together before acceptance.'],
      },
    });

    expect(markdown).toContain('# workspace-login');
    expect(markdown).toContain('- schema: visual_baseline_ux_acceptance/v1');
    expect(markdown).toContain('- scenario_id: workspace-login');
    expect(markdown).toContain('- recipe_family: public_auth_single');
    expect(markdown).toContain('- actual_url: /en-US/workspaces/ws_default/login');
    expect(markdown).toContain(`- story_fingerprint: ${evidence.storyFingerprint}`);
    expect(markdown).toContain('- reviewer_id: codex-d1-reviewer');
    expect(markdown).toContain('- reviewer_kind: ai_reviewer');
    expect(markdown).toContain('- review_mode: ai_native_screenshot_review');
    expect(markdown).toContain('- verdict: needs_work');
    expect(markdown).toContain('- accepted_screenshot_hashes: workspace-login-dark.png=sha256:');
    expect(markdown).toContain('- accepted_baseline_hashes: workspace-login-dark.png=sha256:');
    expect(markdown).toContain('- build_run_id: run-20260412-001');
    expect(markdown).toContain('- build_git_sha: abc123');
    expect(markdown).toContain('- build_fingerprint: abc123:mock-lane:visual');
    expect(markdown).toContain('- build_started_at: 2026-04-12T11:59:00.000Z');
    expect(markdown).toContain('- story_evidence_policy: required');
    expect(markdown).toContain('- story_evidence_kind: visual_scene_catalog');
    expect(markdown).toContain('- story_evidence_owner: lane:visual');
    expect(markdown).toContain('- semantic_contract_fingerprint: sha256:');
    expect(markdown).toContain('- semantic_forbidden_visible_text: Invalid Date, [object Object], undefined');
    expect(markdown).toContain('- semantic_forbidden_visible_text_patterns: <none>');
    expect(markdown).toContain('- workspace-login-dark.png [dark]');
    expect(markdown).toContain('- workspace-login-light.png [light]');
    expect(markdown).toContain('Light and dark screenshots must be reviewed together before acceptance.');
  });

  it('renders automated visual pass artifacts without UX acceptance verdict or reviewer proof', () => {
    const scenario = groupVisualBaselineCatalogByScenario().get('workspace-login');
    expect(scenario).toBeDefined();
    const evidence = buildVisualBaselineScenarioEvidence(scenario!);

    const markdown = renderVisualBaselineAutomatedPassMarkdown({
      scenario: scenario!,
      build: {
        runId: 'run-20260412-001',
        gitSha: 'abc123',
        fingerprint: 'abc123:mock-lane:visual',
        startedAt: '2026-04-12T11:59:00.000Z',
        lane: 'mock-lane',
      },
      automated: {
        generatedAt: '2026-04-12T12:00:00.000Z',
        automatedVerdict: 'passed',
        semanticVerdict: 'passed',
        actualUrl: '/en-US/workspaces/ws_default/login',
        notes: ['Playwright visual lane completed for this scenario.'],
      },
    });

    expect(markdown).toContain('- schema: visual_baseline_automated_pass/v1');
    expect(markdown).toContain('- automated_verdict: passed');
    expect(markdown).toContain('- semantic_verdict: passed');
    expect(markdown).toContain('- semantic_contract_fingerprint: sha256:');
    expect(markdown).toContain('- semantic_forbidden_visible_text: Invalid Date, [object Object], undefined');
    expect(markdown).toContain('- semantic_forbidden_visible_text_patterns: <none>');
    expect(markdown).toContain(`- story_fingerprint: ${evidence.storyFingerprint}`);
    expect(markdown).toContain('- accepted_screenshot_hashes: workspace-login-dark.png=sha256:');
    expect(markdown).toContain('- accepted_baseline_hashes: workspace-login-dark.png=sha256:');
    expect(markdown).not.toContain('- verdict:');
    expect(markdown).not.toContain('- reviewer_id:');
  });

  it('renders automated visual pass artifacts with explicit run-local actual screenshot hashes and build ids', () => {
    const scenario = groupVisualBaselineCatalogByScenario().get('workspace-login');
    expect(scenario).toBeDefined();
    const evidence = buildVisualBaselineScenarioEvidence(scenario!);

    const markdown = renderVisualBaselineAutomatedPassMarkdown({
      scenario: scenario!,
      build: {
        runId: 'run-local-20260412-001',
        gitSha: 'abc123',
        fingerprint: 'abc123:mock-lane:visual',
        startedAt: '2026-04-12T11:59:00.000Z',
        lane: 'mock-lane',
      },
      automated: {
        generatedAt: '2026-04-12T12:00:00.000Z',
        automatedVerdict: 'passed',
        semanticVerdict: 'passed',
        actualUrl: '/en-US/workspaces/ws_default/login',
        notes: ['Playwright visual lane completed for this scenario.'],
      },
    });

    expect(markdown).toContain('- actual_build_run_id: run-local-20260412-001');
    expect(markdown).toContain(
      `- actual_screenshot_hashes: ${evidence.screenshots[0]?.fileName}=sha256:`,
    );
  });

  it('includes stable marker metadata in review markdown for non-public recipe families', () => {
    const grouped = groupVisualBaselineCatalogByScenario();
    const scenario = grouped.get('system-workspaces-empty');
    expect(scenario).toBeDefined();

    const markdown = renderVisualBaselineScenarioReviewMarkdown({
      scenario: scenario!,
      review: {
        reviewerId: 'codex-d1-reviewer',
        reviewerKind: 'ai_reviewer',
        reviewMode: 'ai_native_screenshot_review',
        reviewedAt: '2026-04-12T12:05:00.000Z',
        verdict: 'accepted',
        actualUrl: '/en-US/system/workspaces',
        findings: ['System workspaces now wait on the list/detail recipe instead of the old heading.'],
      },
    });

    expect(markdown).toContain('- stable_markers: system-workspaces__list, system-workspaces__editor-empty');
    expect(markdown).toContain('System workspaces now wait on the list/detail recipe instead of the old heading.');
  });

  it('carries stable markers for self-service and governance catalog entries used by targeted rebuilds', () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    expect(grouped.get('profile')?.stableMarkers).toEqual([
      'profile__form',
      'profile__save-btn',
    ]);
    expect(grouped.get('api-keys')?.stableMarkers).toEqual([
      'api-keys__list-section',
      'api-keys__create-btn',
    ]);
    expect(grouped.get('api-keys-create-dialog')?.stableMarkers).toEqual([
      'api-keys__create-dialog',
    ]);
    expect(grouped.get('api-keys-key-created-dialog')?.stableMarkers).toEqual([
      'api-keys__key-created-dialog',
    ]);
    expect(grouped.get('workspace-feishu-setup-credentials')?.stableMarkers).toEqual([
      'ws-feishu__save-draft',
    ]);
    expect(grouped.get('third-party-accounts')?.stableMarkers).toEqual([
      'third-party-accounts__list-section',
      'third-party-accounts__create-btn',
    ]);
    expect(grouped.get('third-party-accounts-create-sheet')?.stableMarkers).toEqual([
      'third-party-accounts__sheet',
    ]);
    expect(grouped.get('third-party-accounts-edit-sheet')?.stableMarkers).toEqual([
      'third-party-accounts__sheet',
    ]);
    expect(grouped.get('members')?.stableMarkers).toEqual([
      'members__work-surface',
      'members__invite-btn',
    ]);
    expect(grouped.get('endpoints')?.stableMarkers).toEqual([
      'endpoints__work-toolbar',
      'endpoints__create-btn',
    ]);
    expect(grouped.get('audit')?.stableMarkers).toEqual([
      'audit__page',
      'audit__work-surface',
      'audit__table',
    ]);
    expect(grouped.get('alerts-rule-create-dialog')?.stableMarkers).toEqual([
      'alerts__main-surface',
      'alert-center-page',
      'alert-center__summary-meta',
      'alerts__tab__rules',
      'alert-center__create-button',
    ]);
    expect(grouped.get('usage-endpoint-switch')?.stableMarkers).toEqual([
      'usage__work-surface',
      'usage__summary-line',
      'usage__selected-endpoint',
      'usage__limits',
    ]);
  });


  it('carries stable markers for the core surface and settings catalog entries used by targeted rebuilds', () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    expect(grouped.get('chat-standard')?.stableMarkers).toEqual([
      'chat__surface',
      'chat__threads-pane',
      'chat__main-pane',
      'chat__header',
      'chat__composer',
    ]);
    expect(grouped.get('files')?.stableMarkers).toEqual([
      'files__workspace-surface',
      'files__workspace-grid',
      'files__libraries-shell',
      'files__browser-shell',
      'files__library-list',
      'files__objects-table',
    ]);
    expect(grouped.get('alerts')?.stableMarkers).toEqual([
      'alerts__main-surface',
      'alert-center-page',
      'alert-center__summary-meta',
      'alerts__open-audit',
      'alerts__open-usage',
    ]);
    expect(grouped.get('workspace-settings')?.stableMarkers).toEqual([
      'ws-settings__summary-line',
      'ws-settings__workspace',
      'ws-settings__integrations',
      'ws-settings__projects',
    ]);
    expect(grouped.get('workspace-personal-context')?.stableMarkers).toEqual([
      'context-store__list-card',
      'context-store__editor-card',
    ]);
    expect(grouped.get('project-personal-context')?.stableMarkers).toEqual([
      'context-store__list-card',
      'context-store__editor-card',
    ]);
    expect(grouped.get('settings')?.stableMarkers).toEqual([
      'settings__summary-line',
      'settings__general-section',
      'settings__ownership-section',
      'settings__project-admins-section',
    ]);
    expect(grouped.get('system-workspaces-edit-mode')?.stableMarkers).toEqual([
      'system-workspaces__list',
      'system-workspaces__editor',
      'system-workspaces__basics',
    ]);
    expect(grouped.get('overview')?.stableMarkers).toEqual([
      'project-overview__page',
      'project-overview__primary-cta',
      'project-overview__secondary-steps',
      'project-overview__surface-group--govern',
    ]);
    expect(grouped.get('system-workspaces-create-wizard')?.stableMarkers).toEqual([
      'system-workspace-create__shell',
      'system-workspace-create__step-tracker',
      'system-workspace-create__next',
    ]);
    expect(grouped.get('system-workspaces-failed-state')?.stableMarkers).toEqual([
      'system-workspaces__list',
      'system-workspaces__editor',
      'system-workspaces__card--ws_seeded',
      'system-workspaces__read-only-notice',
    ]);
    expect(grouped.get('system-workspaces-delete-confirmation')?.stableMarkers).toEqual([
      'system-workspaces__delete-dialog',
      'system-workspaces__delete-cancel',
      'system-workspaces__delete-confirm',
    ]);
    expect(grouped.get('files')?.stableMarkers).toEqual([
      'files__workspace-surface',
      'files__workspace-grid',
      'files__libraries-shell',
      'files__browser-shell',
      'files__library-list',
      'files__objects-table',
    ]);
    expect(grouped.get('files-selection-details')?.stableMarkers).toEqual([
      'files__workspace-surface',
      'files__details-shell',
      'files__details-inspector',
    ]);
  });

  it('assigns monitoring and connections lifecycle scenes to dedicated goal-oriented mock-lane stories', () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    expect(grouped.get('alerts')?.storyId).toBe('mock-lane-alerts-and-usage-review');
    expect(grouped.get('alerts-rules-tab')?.storyId).toBe('mock-lane-alerts-and-usage-review');
    expect(grouped.get('alerts-rule-create-dialog')?.storyId).toBe('mock-lane-alerts-and-usage-review');
    expect(grouped.get('usage')?.storyId).toBe('mock-lane-alerts-and-usage-review');
    expect(grouped.get('usage-endpoint-switch')?.storyId).toBe('mock-lane-alerts-and-usage-review');
    expect(grouped.get('audit')?.storyId).toBe('mock-lane-alerts-and-usage-review');
    expect(grouped.get('drawer-audit-detail')?.storyId).toBe('mock-lane-alerts-and-usage-review');

    expect(grouped.get('third-party-accounts')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
    expect(grouped.get('third-party-accounts-edit-sheet')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
    expect(grouped.get('workspace-connections-feishu-disabled')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
    expect(grouped.get('workspace-connections-feishu-connected')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
    expect(grouped.get('workspace-feishu-setup-credentials')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
    expect(grouped.get('credentials')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
    expect(grouped.get('dialog-create-credential')?.storyId).toBe('mock-lane-connections-and-credentials-lifecycle');
  });

  it('assigns second-wave high-frequency mock-lane scenes to dedicated user-goal stories', () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    expect(grouped.get('chat-operate')?.storyId).toBe('mock-lane-chat-operate-and-recover');
    expect(grouped.get('chat-recover-empty')?.storyId).toBe('mock-lane-chat-operate-and-recover');
    expect(grouped.get('agent-task-lifecycle-list')?.storyId).toBe('mock-lane-agent-task-lifecycle');
    expect(grouped.get('agent-task-lifecycle-create-dialog')?.storyId).toBe('mock-lane-agent-task-lifecycle');
    expect(grouped.get('agent-task-lifecycle-detail')?.storyId).toBe('mock-lane-agent-task-lifecycle');
    expect(grouped.get('agent-task-lifecycle-artifact')?.storyId).toBe('mock-lane-agent-task-lifecycle');
    expect(grouped.get('project-settings-review')?.storyId).toBe('mock-lane-settings-and-members-review');
    expect(grouped.get('project-members-review')?.storyId).toBe('mock-lane-settings-and-members-review');
  });

  it('reads mock-lane visual scene metadata from the canonical story runtimeData contract', async () => {
    const story = await loadStoryDefinition('mock-lane-chat-operate-and-recover');
    const providerCapacity = getRequiredStoryVisualSceneBundle(
      story,
      'chat-provider-capacity-retry',
    );
    const grouped = groupVisualBaselineCatalogByScenario();
    const catalogEntry = grouped.get('chat-provider-capacity-retry');

    expect(listVisualBaselineExecutorScenarios()
      .filter((entry) => entry.storyId === story.storyId)
      .map((entry) => entry.storySceneId)
      .sort()).toEqual(listStorySceneIds(story));
    expect(listStoryVisualSceneIds(story)).toEqual(listStorySceneIds(story));
    expect(catalogEntry?.storyId).toBe(story.storyId);
    expect(catalogEntry?.storySceneId).toBe(providerCapacity.visualScene.sceneId);
    expect(catalogEntry?.route).toBe(providerCapacity.storyScene.route);
    expect(catalogEntry?.recipeFamily).toBe(providerCapacity.storyScene.recipeFamily);
    expect(catalogEntry?.stableMarkers).toEqual(providerCapacity.storyScene.stableMarkers);
    expect(catalogEntry?.semanticAssertions.requiredViewportTestIds).toEqual(
      expect.arrayContaining(
        providerCapacity.visualScene.semanticAssertions?.requiredViewportTestIds ?? [],
      ),
    );
    expect(catalogEntry?.semanticAssertions.prominentActionScopeTestIds).toEqual(
      providerCapacity.visualScene.semanticAssertions?.prominentActionScopeTestIds ?? [],
    );
  });

  it('keeps agent-tasks lifecycle baseline metadata derived from canonical story scenes and targeted CTA invariants', async () => {
    const story = await loadStoryDefinition('mock-lane-agent-task-lifecycle');
    const running = getRequiredStoryVisualSceneBundle(story, 'agent-task-running');
    const hiddenTerminalBlocked = getRequiredStoryVisualSceneBundle(
      story,
      'agent-task-hidden-terminal-blocked',
    );
    const terminalTruthUnavailable = getRequiredStoryVisualSceneBundle(
      story,
      'agent-task-terminal-truth-unavailable',
    );
    const grouped = groupVisualBaselineCatalogByScenario();
    const runningCatalog = grouped.get('agent-task-running');
    const hiddenTerminalCatalog = grouped.get('agent-task-hidden-terminal-blocked');
    const terminalTruthUnavailableCatalog = grouped.get('agent-task-terminal-truth-unavailable');

    expect(listVisualBaselineExecutorScenarios()
      .filter((entry) => entry.storyId === story.storyId)
      .map((entry) => entry.storySceneId)
      .sort()).toEqual(listStorySceneIds(story));
    expect(listStoryVisualSceneIds(story)).toEqual(listStorySceneIds(story));

    expect(runningCatalog?.storyId).toBe(story.storyId);
    expect(runningCatalog?.storySceneId).toBe(running.visualScene.sceneId);
    expect(runningCatalog?.stableMarkers).toEqual(running.storyScene.stableMarkers);
    expect(runningCatalog?.semanticAssertions.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['agent-tasks__message-active-run-cancel']),
    );

    expect(hiddenTerminalCatalog?.storyId).toBe(story.storyId);
    expect(hiddenTerminalCatalog?.storySceneId).toBe(hiddenTerminalBlocked.visualScene.sceneId);
    expect(hiddenTerminalCatalog?.stableMarkers).toEqual(hiddenTerminalBlocked.storyScene.stableMarkers);
    expect(hiddenTerminalCatalog?.semanticAssertions.requiredViewportTestIds).toEqual(
      expect.arrayContaining([
        'agent-tasks__task-terminal-status-action',
        'agent-tasks__task-terminal-status-end-all',
      ]),
    );
    expect(hiddenTerminalCatalog?.semanticAssertions.requiredViewportTestIds).not.toContain(
      'agent-tasks__conversation-blocked-action',
    );

    expect(terminalTruthUnavailableCatalog?.storyId).toBe(story.storyId);
    expect(terminalTruthUnavailableCatalog?.storySceneId).toBe(terminalTruthUnavailable.visualScene.sceneId);
    expect(terminalTruthUnavailableCatalog?.stableMarkers).toEqual(
      terminalTruthUnavailable.storyScene.stableMarkers,
    );
    expect(terminalTruthUnavailableCatalog?.semanticAssertions.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['agent-tasks__task-terminal-truth-unavailable-retry']),
    );
    expect(terminalTruthUnavailableCatalog?.semanticAssertions.requiredViewportTestIds).not.toContain(
      'agent-tasks__conversation-blocked-action',
    );
  });

  it('catalogs agent-tasks escalation, provider recovery, and terminal recovery CTA scenes as first-class visual baselines', () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    expect(grouped.get('agent-task-cancel-escalation-confirm')).toMatchObject({
      storyId: 'mock-lane-agent-task-lifecycle',
      recipeFamily: 'overlay_dialog',
      semanticAssertions: {
        requiredViewportTestIds: [
          'agent-task__task-header',
          'agent-tasks__cancel-escalation-dialog',
          'agent-tasks__cancel-escalation-cancel',
          'agent-tasks__cancel-escalation-confirm',
        ],
      },
    });

    expect(grouped.get('agent-task-provider-upstream-error')).toMatchObject({
      storyId: 'mock-lane-agent-task-lifecycle',
      recipeFamily: 'work_surface_immersive',
      semanticAssertions: {
        requiredViewportTestIds: [
          'agent-task__task-header',
          'agent-tasks__agent-message-bubble',
          'agent-tasks__message-run-status',
          'agent-tasks__send-btn',
        ],
      },
    });

    expect(grouped.get('agent-task-hidden-terminal-blocked')).toMatchObject({
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'agent-tasks__task-terminal-status-action',
          'agent-tasks__task-terminal-status-end-all',
        ]),
        prominentActionScopeTestIds: ['agent-tasks__task-terminal-status-strip'],
      },
    });

    expect(grouped.get('agent-task-terminal-truth-unavailable')).toMatchObject({
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'agent-tasks__task-terminal-truth-unavailable-retry',
        ]),
        prominentActionScopeTestIds: ['agent-tasks__task-terminal-truth-unavailable'],
      },
    });
  });

  it('exposes stable recipe markers for public/auth scenarios so visual waits can target real readiness points', () => {
    expect(resolveVisualBaselineStableMarkers('workspace-select')).toEqual([
      'workspace-select__heading',
      'workspace-select__list',
      'workspace-select__system-link',
    ]);

    expect(resolveVisualBaselineStableMarkers('workspace-login')).toEqual([
      'public-auth__shell',
      'workspace-login__heading',
      'workspace-login__keycloak-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('system-workspaces-empty')).toEqual([
      'system-workspaces__list',
      'system-workspaces__editor-empty',
    ]);

    expect(resolveVisualBaselineStableMarkers('system-workspaces-default')).toEqual([
      'system-workspaces__list',
      'system-workspaces__editor',
      'system-workspaces__read-only-notice',
    ]);

    expect(resolveVisualBaselineStableMarkers('workspace-feishu-setup-credentials')).toEqual([
      'ws-feishu__save-draft',
    ]);

    expect(resolveVisualBaselineStableMarkers('overview')).toEqual([
      'project-overview__page',
      'project-overview__primary-cta',
      'project-overview__secondary-steps',
      'project-overview__surface-group--govern',
    ]);

    expect(resolveVisualBaselineStableMarkers('system-info')).toEqual([
      'system-info__shell',
      'system-info__health',
      'system-info__next-steps',
    ]);

    expect(resolveVisualBaselineStableMarkers('usage')).toEqual([
      'usage__work-surface',
      'usage__summary-line',
      'usage__selected-endpoint',
      'usage__limits',
    ]);

    expect(resolveVisualBaselineStableMarkers('usage-endpoint-switch')).toEqual([
      'usage__work-surface',
      'usage__summary-line',
      'usage__selected-endpoint',
      'usage__limits',
    ]);

    expect(resolveVisualBaselineStableMarkers('alerts-rule-create-dialog')).toEqual([
      'alerts__main-surface',
      'alert-center-page',
      'alert-center__summary-meta',
      'alerts__tab__rules',
      'alert-center__create-button',
    ]);
    expect(resolveVisualBaselineStableMarkers('api-keys-create-dialog')).toEqual([
      'api-keys__create-dialog',
    ]);
    expect(resolveVisualBaselineStableMarkers('api-keys-key-created-dialog')).toEqual([
      'api-keys__key-created-dialog',
    ]);
    expect(resolveVisualBaselineStableMarkers('third-party-accounts-create-sheet')).toEqual([
      'third-party-accounts__sheet',
    ]);
    expect(resolveVisualBaselineStableMarkers('third-party-accounts-edit-sheet')).toEqual([
      'third-party-accounts__sheet',
    ]);

    expect(resolveVisualBaselineStableMarkers('chat-standard')).toEqual([
      'chat__surface',
      'chat__threads-pane',
      'chat__main-pane',
      'chat__header',
      'chat__composer',
    ]);

    expect(resolveVisualBaselineStableMarkers('chat-operate')).toEqual([
      'chat__surface',
      'chat__threads-pane',
      'chat__main-pane',
      'chat__header',
      'chat__composer',
    ]);

    expect(resolveVisualBaselineStableMarkers('chat-recover-empty')).toEqual([
      'chat__threads-empty-state',
      'chat__threads-empty-clear-search',
      'chat__new-thread-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('files')).toEqual([
      'files__workspace-surface',
      'files__workspace-grid',
      'files__libraries-shell',
      'files__browser-shell',
      'files__library-list',
      'files__objects-table',
    ]);

    expect(resolveVisualBaselineStableMarkers('alerts')).toEqual([
      'alerts__main-surface',
      'alert-center-page',
      'alert-center__summary-meta',
      'alerts__open-audit',
      'alerts__open-usage',
    ]);

    expect(resolveVisualBaselineStableMarkers('workspace-personal-context')).toEqual([
      'context-store__list-card',
      'context-store__editor-card',
    ]);

    expect(resolveVisualBaselineStableMarkers('project-personal-context')).toEqual([
      'context-store__list-card',
      'context-store__editor-card',
    ]);

    expect(resolveVisualBaselineStableMarkers('agent-task-lifecycle-list')).toEqual([
      'agent-tasks__task-list',
      'agent-tasks__task-card',
      'agent-tasks__create-task-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('agent-task-lifecycle-create-dialog')).toEqual([
      'agent-tasks__create-task-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('agent-task-lifecycle-detail')).toEqual([
      'agent-task__task-header',
      'agent-tasks__conversation-input',
      'agent-tasks__send-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('agent-task-lifecycle-artifact')).toEqual([
      'agent-task__task-header',
      'agent-tasks__artifact-card',
      'agent-tasks__artifact-hover-panel',
    ]);

    expect(resolveVisualBaselineStableMarkers('workspace-settings')).toEqual([
      'ws-settings__summary-line',
      'ws-settings__workspace',
      'ws-settings__integrations',
      'ws-settings__projects',
    ]);

    expect(resolveVisualBaselineStableMarkers('project-settings-review')).toEqual([
      'settings__summary-line',
      'settings__general-section',
      'settings__save-btn',
      'settings__ownership-section',
      'settings__project-admins-section',
      'settings__project-admins-save',
    ]);

    expect(resolveVisualBaselineStableMarkers('project-members-review')).toEqual([
      'members__work-surface',
      'members__table',
      'members__invite-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('settings')).toEqual([
      'settings__summary-line',
      'settings__general-section',
      'settings__ownership-section',
      'settings__project-admins-section',
    ]);
  });

  it('resolves review bundles under a run-scoped visual review tree', () => {
    const resolved = resolveVisualBaselineReviewDir({
      outputRoot: '/tmp/agentsmith-visual-reviews',
      runId: 'run-20260412-001',
      scenarioId: 'workspace-select',
    });

    expect(resolved).toBe(
      path.join('/tmp/agentsmith-visual-reviews', 'run-20260412-001', 'workspace-select'),
    );
  });

  it('parses the visual build metadata file using the snake_case on-disk schema', () => {
    expect(parseVisualBaselineBuildRecord({
      lane: 'mock-lane',
      run_id: 'run-20260412-001',
      git_sha: 'abc123',
      fingerprint: 'fingerprint-001',
      started_at: '2026-04-12T11:59:00.000Z',
      base_url: 'http://127.0.0.1:3001',
    })).toEqual({
      lane: 'mock-lane',
      runId: 'run-20260412-001',
      gitSha: 'abc123',
      fingerprint: 'fingerprint-001',
      startedAt: '2026-04-12T11:59:00.000Z',
    });
  });

  it('rejects missing or camelCase-only visual build metadata instead of silently omitting review metadata', () => {
    expect(() => parseVisualBaselineBuildRecord({
      lane: 'mock-lane',
      run_id: 'run-20260412-001',
      git_sha: 'abc123',
      fingerprint: 'fingerprint-001',
    }, 'fixture-build-info.json')).toThrow(/started_at/);

    expect(() => parseVisualBaselineBuildRecord({
      lane: 'mock-lane',
      runId: 'run-20260412-001',
      gitSha: 'abc123',
      fingerprint: 'fingerprint-001',
      startedAt: '2026-04-12T11:59:00.000Z',
    }, 'fixture-build-info.json')).toThrow(/run_id/);
  });

  it('writes automated visual pass artifacts with required visual build metadata from the snake_case build info file', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'visual-review-writer-'));
    const buildInfoPath = path.join(tempRoot, 'visual-build-info.json');
    const outputRoot = path.join(tempRoot, 'reviews');
    const runId = 'run-20260412-001';
    writeFileSync(buildInfoPath, `${JSON.stringify({
      lane: 'mock-lane',
      run_id: runId,
      git_sha: 'abc123',
      fingerprint: 'fingerprint-001',
      started_at: '2026-04-12T11:59:00.000Z',
    }, null, 2)}\n`);
    seedRunBoundVisualActualCaptures(buildInfoPath);

    execFileSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOCK_RUN_ID: runId,
        VISUAL_BASELINE_BUILD_INFO_FILE: buildInfoPath,
        VISUAL_BASELINE_REVIEW_ROOT: outputRoot,
      },
      stdio: 'pipe',
    });

    const review = readFileSync(
      path.join(outputRoot, runId, 'workspace-login', 'automated-pass.md'),
      'utf8',
    );
    expect(review).toContain('- build_run_id: run-20260412-001');
    expect(review).toContain('- build_git_sha: abc123');
    expect(review).toContain('- build_fingerprint: fingerprint-001');
    expect(review).toContain('- build_started_at: 2026-04-12T11:59:00.000Z');
    expect(review).toContain('- automated_verdict: passed');
    expect(review).not.toContain('- verdict: accepted');
  });

  it('writes a run-scoped visual evidence manifest with current-run build metadata and actual screenshot hashes', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'visual-review-manifest-writer-'));
    const buildInfoPath = path.join(tempRoot, 'visual-build-info.json');
    const outputRoot = path.join(tempRoot, 'reviews');
    const runId = 'run-20260412-001';
    writeFileSync(buildInfoPath, `${JSON.stringify({
      lane: 'mock-lane',
      run_id: runId,
      git_sha: 'abc123',
      fingerprint: 'fingerprint-001',
      started_at: '2026-04-12T11:59:00.000Z',
    }, null, 2)}\n`);
    const scenarioId = 'workspace-login';
    const screenshotFile = 'workspace-login-dark.png';
    const mutatedActual = Buffer.from('run-bound actual screenshot bytes for workspace-login-dark');
    seedRunBoundVisualActualCaptures(buildInfoPath, {
      [path.join(scenarioId, screenshotFile)]: mutatedActual,
    });

    execFileSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOCK_RUN_ID: runId,
        VISUAL_BASELINE_BUILD_INFO_FILE: buildInfoPath,
        VISUAL_BASELINE_REVIEW_ROOT: outputRoot,
      },
      stdio: 'pipe',
    });

    const manifest = JSON.parse(
      readFileSync(path.join(outputRoot, runId, 'run-manifest.json'), 'utf8'),
    ) as {
      schema?: string;
      run_id?: string;
      build?: Record<string, unknown>;
      scenarios?: Array<{
        scenario_id: string;
        actual_url: string;
        screenshots: Array<Record<string, unknown>>;
      }>;
    };
    const scenarioRoute = groupVisualBaselineCatalogByScenario().get(scenarioId)?.route;
    if (!scenarioRoute) {
      throw new Error(`Missing ${scenarioId} visual scenario route.`);
    }

    expect(manifest).toMatchObject({
      schema: 'visual_baseline_run_manifest/v2',
      run_id: runId,
      build: {
        lane: 'mock-lane',
        run_id: runId,
        git_sha: 'abc123',
        fingerprint: 'fingerprint-001',
        started_at: '2026-04-12T11:59:00.000Z',
      },
      coverage: {
        scope: 'full_catalog',
        expected_scenario_ids: expect.any(Array),
        captured_scenario_ids: expect.any(Array),
      },
    });
    expect(manifest.coverage?.expected_scenario_ids).toEqual(
      [...groupVisualBaselineCatalogByScenario().keys()].sort((left, right) => left.localeCompare(right)),
    );
    expect(manifest.coverage?.captured_scenario_ids).toEqual(manifest.coverage?.expected_scenario_ids);

    const scenario = manifest.scenarios?.find((entry) => entry.scenario_id === scenarioId);
    expect(scenario?.actual_url).toBe(scenarioRoute);
    const screenshot = scenario?.screenshots.find((entry) => entry.file_name === screenshotFile);
    expect(screenshot).toMatchObject({
      file_name: expect.any(String),
      actual_relpath: expect.stringMatching(/^captured\/workspace-login\/.+\.png$/),
      actual_sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      baseline_sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    const actualRelPath = typeof screenshot?.actual_relpath === 'string'
      ? screenshot.actual_relpath
      : null;
    const actualSha256 = typeof screenshot?.actual_sha256 === 'string'
      ? screenshot.actual_sha256
      : null;
    expect(actualRelPath).toBeTruthy();
    expect(actualSha256).toBeTruthy();
    const actualCapturePath = path.join(outputRoot, runId, actualRelPath ?? '');
    const actualCapture = readFileSync(actualCapturePath);
    expect(actualSha256).toBe(
      `sha256:${createHash('sha256').update(actualCapture).digest('hex')}`,
    );
    expect(actualCapture.equals(mutatedActual)).toBe(true);
    expect(actualSha256).toBe(`sha256:${createHash('sha256').update(mutatedActual).digest('hex')}`);
    expect(actualSha256).not.toBe(scenario?.screenshots[0]?.baseline_sha256);
  });

  it('writes review artifacts only for scenarios whose run-bound actual captures exist in the current run', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'visual-review-partial-run-'));
    const buildInfoPath = path.join(tempRoot, 'visual-build-info.json');
    const outputRoot = path.join(tempRoot, 'reviews');
    const runId = 'run-20260412-partial';
    writeFileSync(buildInfoPath, `${JSON.stringify({
      lane: 'mock-lane',
      run_id: runId,
      git_sha: 'abc123',
      fingerprint: 'fingerprint-partial',
      started_at: '2026-04-12T11:59:00.000Z',
    }, null, 2)}\n`);
    const actualRoot = path.join(path.dirname(buildInfoPath), 'visual-actual-captures', 'workspace-login');
    mkdirSync(actualRoot, { recursive: true });
    writeFileSync(
      path.join(actualRoot, 'workspace-login-light.png'),
      Buffer.from('partial run-bound actual screenshot bytes for workspace-login-light'),
    );

    execFileSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOCK_RUN_ID: runId,
        VISUAL_BASELINE_BUILD_INFO_FILE: buildInfoPath,
        VISUAL_BASELINE_REVIEW_ROOT: outputRoot,
      },
      stdio: 'pipe',
    });

    const manifest = JSON.parse(
      readFileSync(path.join(outputRoot, runId, 'run-manifest.json'), 'utf8'),
    ) as {
      coverage?: {
        scope?: string;
        expected_scenario_ids?: string[];
        captured_scenario_ids?: string[];
      };
      scenarios?: Array<{ scenario_id: string; screenshots?: Array<{ file_name: string }> }>;
    };

    expect(manifest.coverage).toMatchObject({
      scope: 'partial_catalog',
      captured_scenario_ids: ['workspace-login'],
    });
    expect(manifest.coverage?.expected_scenario_ids).toEqual(
      [...groupVisualBaselineCatalogByScenario().keys()].sort((left, right) => left.localeCompare(right)),
    );
    expect(manifest.scenarios?.map((entry) => entry.scenario_id)).toEqual(['workspace-login']);
    expect(manifest.scenarios?.[0]?.screenshots).toEqual([
      expect.objectContaining({ file_name: 'workspace-login-light.png' }),
    ]);
    expect(existsSync(path.join(outputRoot, runId, 'workspace-login', 'automated-pass.md'))).toBe(true);
    expect(existsSync(path.join(outputRoot, runId, 'access-guide', 'automated-pass.md'))).toBe(false);
  });

  it('fails the review writer when the current run has no run-bound actual captures', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'visual-review-writer-missing-actual-'));
    const buildInfoPath = path.join(tempRoot, 'visual-build-info.json');
    const outputRoot = path.join(tempRoot, 'reviews');
    const runId = 'run-20260412-001';
    writeFileSync(buildInfoPath, `${JSON.stringify({
      lane: 'mock-lane',
      run_id: runId,
      git_sha: 'abc123',
      fingerprint: 'fingerprint-001',
      started_at: '2026-04-12T11:59:00.000Z',
    }, null, 2)}\n`);

    expect(() => execFileSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOCK_RUN_ID: runId,
        VISUAL_BASELINE_BUILD_INFO_FILE: buildInfoPath,
        VISUAL_BASELINE_REVIEW_ROOT: outputRoot,
      },
      stdio: 'pipe',
    })).toThrow();
  });

  it('fails the review writer when an explicit build info file is incomplete', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'visual-review-writer-invalid-'));
    const buildInfoPath = path.join(tempRoot, 'visual-build-info.json');
    writeFileSync(buildInfoPath, `${JSON.stringify({
      lane: 'mock-lane',
      run_id: 'run-20260412-001',
      git_sha: 'abc123',
      fingerprint: 'fingerprint-001',
    }, null, 2)}\n`);

    expect(() => execFileSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOCK_RUN_ID: 'run-20260412-001',
        VISUAL_BASELINE_BUILD_INFO_FILE: buildInfoPath,
        VISUAL_BASELINE_REVIEW_ROOT: path.join(tempRoot, 'reviews'),
      },
      stdio: 'pipe',
    })).toThrow();
  });

  it('fails the review writer when the required build info env is missing', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'visual-review-writer-missing-env-'));
    const { VISUAL_BASELINE_BUILD_INFO_FILE: _omitted, ...envWithoutBuildInfo } = process.env;

    expect(() => execFileSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
      cwd: process.cwd(),
      env: {
        ...envWithoutBuildInfo,
        MOCK_RUN_ID: 'run-20260412-001',
        VISUAL_BASELINE_REVIEW_ROOT: path.join(tempRoot, 'reviews'),
      },
      stdio: 'pipe',
    })).toThrow();
  });

  it('forces the mock lane to write explicit visual build metadata before Playwright starts', async () => {
    const script = await readFile('scripts/run-mock-lane-playwright.sh', 'utf-8');

    expect(script).toContain('VISUAL_BUILD_INFO_FILE');
    expect(script).toContain('write_visual_build_info');
    expect(script).toContain('VISUAL_BASELINE_BUILD_INFO_FILE');
    expect(script).toContain('VISUAL_BASELINE_BUILD_FINGERPRINT');
    expect(script).toContain('"run_id":');
    expect(script).toContain('"git_sha":');
    expect(script).toContain('"started_at":');
  });

  it('persists run-bound actual captures from the visual executor before review artifacts are written', async () => {
    const visualSpec = await readFile(path.resolve('e2e/visual.spec.ts'), 'utf-8');

    expect(visualSpec).toContain('resolveRunBoundActualCaptureRoot');
    expect(visualSpec).toContain('visual-actual-captures');
    expect(visualSpec).toContain('writeRunBoundActualCapture');
    expect(visualSpec).toContain('await writeRunBoundActualCapture');
  });

  it('publishes canonical lane-visual result and review evidence artifacts from CI', async () => {
    const workflow = await readFile('.github/workflows/quality-gates.yml', 'utf-8');

    expect(workflow).toContain('name: lane-visual-artifacts');
    expect(workflow).toContain('artifacts/gate-results/lane-visual/**');
    expect(workflow).toContain('artifacts/visual-baseline-reviews/**');
    expect(workflow).toContain('test-results/**');
    expect(workflow).toContain('playwright-report/**');
  });

  it('links every visual scene back to the lane:visual story-evidence policy', () => {
    expect(resolveVisualBaselineStoryEvidence('workspace-select')).toEqual({
      policy: 'required',
      kind: 'visual_scene_catalog',
      owner: 'lane:visual',
    });

    expect(resolveVisualBaselineStoryEvidence('credentials')).toEqual({
      policy: 'required',
      kind: 'visual_scene_catalog',
      owner: 'lane:visual',
    });
  });

  it('derives the visual catalog from mock-lane story families instead of a standalone scenario seed', async () => {
    const grouped = groupVisualBaselineCatalogByScenario();

    expect(grouped.get('workspace-select')).toMatchObject({
      storyId: expect.stringContaining('mock-lane'),
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-entry-access.story.md',
      storySceneId: 'workspace-select',
    });
    expect(grouped.get('api-keys-create-dialog')).toMatchObject({
      storyId: expect.stringContaining('mock-lane'),
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-self-service.story.md',
      storySceneId: 'api-keys-create-dialog',
    });
    expect(grouped.get('workspace-home-project-creator')).toMatchObject({
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-workspace-project-core.story.md',
      storySceneId: 'workspace-home-project-creator',
    });
    expect(grouped.get('system-workspaces-empty')).toMatchObject({
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-governance-surfaces.story.md',
      storySceneId: 'system-workspaces-empty',
    });
    expect(grouped.get('system-workspaces-default')).toMatchObject({
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-governance-surfaces.story.md',
      storySceneId: 'system-workspaces-default',
    });
    expect(grouped.get('alerts')).toMatchObject({
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-alerts-and-usage-review.story.md',
      storySceneId: 'alerts',
    });
  });

  it('drives visual executor scenarios from the story catalog instead of hardcoded visual spec case arrays', async () => {
    const visualSpec = await readFile(path.resolve('e2e/visual.spec.ts'), 'utf-8');
    const executorScenarios = listVisualBaselineExecutorScenarios();
    const catalogScenarios = [...groupVisualBaselineCatalogByScenario().values()]
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));

    expect(executorScenarios.map((scenario) => scenario.scenarioId)).toEqual(
      catalogScenarios.map((scenario) => scenario.scenarioId),
    );
    expect(visualSpec).toContain('listVisualBaselineExecutorScenarios');
    expect(visualSpec).not.toContain('THEMED_PUBLIC_PAGES');
    expect(visualSpec).not.toContain('THEMED_WORKSPACE_PAGES_AUTHED');
    expect(visualSpec).not.toContain('THEMED_GOVERNANCE_PAGES');
    expect(visualSpec).not.toContain('THEMED_OVERLAY_CASES');
  });

  it('lets catalog route changes drive executor navigation without retaining the old hardcoded route', () => {
    const [workspaceSelect] = listVisualBaselineCatalogEntries()
      .filter((entry) => entry.scenarioId === 'workspace-select');

    expect(workspaceSelect).toBeDefined();
    const movedCatalogEntry: VisualBaselineCatalogEntry = {
      ...workspaceSelect!,
      route: '/en-US/login/workspace-v2',
    };

    const [executorScenario] = buildVisualBaselineExecutorScenarios([movedCatalogEntry]);

    expect(executorScenario?.scenarioId).toBe('workspace-select');
    expect(executorScenario?.route).toBe('/en-US/login/workspace-v2');
  });

  it('fails fast when the browser lands on a route that differs from the story catalog route', () => {
    expect(() => assertVisualBaselineActualUrlMatchesRoute({
      scenarioId: 'workspace-login',
      expectedRoute: '/en-US/workspaces/ws_default/login',
      actualUrl: 'http://localhost:3001/en-US/login/workspace',
    })).toThrow(/visual route drift.*workspace-login/);

    expect(() => assertVisualBaselineActualUrlMatchesRoute({
      scenarioId: 'workspace-login',
      expectedRoute: '/en-US/workspaces/ws_default/login',
      actualUrl: 'http://localhost:3001/en-US/workspaces/ws_default/login#ignored',
    })).not.toThrow();
  });

  it('exposes required stable markers from the story catalog to the visual executor', () => {
    const scenarios = listVisualBaselineExecutorScenarios();
    const workspaceSelect = scenarios.find((scenario) => scenario.scenarioId === 'workspace-select');
    const chatRecoverEmpty = scenarios.find((scenario) => scenario.scenarioId === 'chat-recover-empty');

    expect(workspaceSelect?.stableMarkers).toEqual([
      'workspace-select__heading',
      'workspace-select__list',
      'workspace-select__system-link',
    ]);
    expect(chatRecoverEmpty?.stableMarkers).toEqual([
      'chat__threads-empty-state',
      'chat__threads-empty-clear-search',
      'chat__new-thread-btn',
    ]);
  });

  it('keeps compact chat screenshot viewport metadata in the story catalog instead of hidden spec setup', () => {
    const scenarios = listVisualBaselineExecutorScenarios();

    expect(scenarios.find((scenario) => scenario.scenarioId === 'chat-standard')?.setupNotes).toContain('viewport:1440x900');
    expect(scenarios.find((scenario) => scenario.scenarioId === 'chat-operate')?.setupNotes).toContain('viewport:1440x900');
    expect(scenarios.find((scenario) => scenario.scenarioId === 'chat-recover-empty')?.setupNotes).toContain('viewport:1440x900');
  });

  it('stores canonical URL-owned selection state in story routes for stateful visual scenes', () => {
    const scenarios = groupVisualBaselineCatalogByScenario();

    expect(scenarios.get('dialog-files-create-folder')?.route).toBe(
      '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_shared_default',
    );
    expect(scenarios.get('dialog-files-rename')?.route).toBe(
      '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_shared_default&search=README',
    );
    expect(scenarios.get('system-workspaces-delete-confirmation')?.route).toBe(
      '/en-US/system/workspaces?workspace=ws_seeded',
    );
  });

  it('catalogs focused file update Sheet visual states without expanding the full files catalog', () => {
    const scenarios = groupVisualBaselineCatalogByScenario();
    const idleSheet = scenarios.get('files-version-management-sheet');
    const failedSheet = scenarios.get('files-version-management-failed');
    const recoveryRequiredSheet = scenarios.get('files-version-management-recovery-required');

    expect(idleSheet).toMatchObject({
      storyId: 'mock-lane-workspace-project-core',
      storySceneId: 'files-version-management-sheet',
      group: 'overlay_drawers',
      recipeFamily: 'overlay_sheet',
      route: '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_shared_default',
      stableMarkers: expect.arrayContaining([
        'files__dialog__version-save-restore',
        'files__version-save-restore-scope',
        'files__save-point__message',
      ]),
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'files__dialog__version-save-restore',
          'files__version-save-restore-scope',
          'files__save-point__message',
        ]),
        forbiddenVisibleText: expect.arrayContaining([
          'version operation',
          'Review the reason and try again',
        ]),
      },
    });
    expect(idleSheet?.entries.map((entry) => entry.screenshot).sort()).toEqual([
      'files-version-management-sheet-dark.png',
      'files-version-management-sheet-light.png',
    ]);

    for (const scenario of [failedSheet, recoveryRequiredSheet]) {
      expect(scenario).toMatchObject({
        storyId: 'mock-lane-workspace-project-core',
        group: 'overlay_drawers',
        recipeFamily: 'overlay_sheet',
        route: '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_shared_default',
        stableMarkers: expect.arrayContaining([
          'files__dialog__version-save-restore',
          'files__restore-operation',
          'files__restore-operation-summary',
        ]),
        semanticAssertions: {
          requiredViewportTestIds: expect.arrayContaining([
            'files__dialog__version-save-restore',
            'files__restore-operation',
            'files__restore-operation-summary',
          ]),
        },
      });
      expect(scenario?.entries).toHaveLength(1);
    }
  });

  it('documents the mock-lane story family linkage contract', async () => {
    const docSource = await readFile(path.resolve('docs/testing/mock-lane-visual-story-linkage.md'), 'utf-8');

    expect(docSource).toContain('e2e/stories/mock-lane/*.story.md');
    expect(docSource).toContain('runtimeData.visualReview.scenes');
    expect(docSource).toContain('semanticAssertions');
    expect(docSource).toContain('surface::target');
    expect(docSource).toContain('prominentActionScopeTestIds');
    expect(docSource).toContain('unique surface');
    expect(docSource).toContain('storySourceFile');
    expect(docSource).toContain('storySceneId');
    expect(docSource).toContain('visual-baseline-support.ts');
    expect(docSource).not.toContain('standalone scenario seed');
  });

  it('documents the allowed semantic test-id families and the unique-surface boundary', async () => {
    const docSource = await readFile(path.resolve('docs/testing/2026-02-05-前端-testid-规范.md'), 'utf-8');

    expect(docSource).toContain('语义族');
    expect(docSource).toContain('requiredViewportTestIds');
    expect(docSource).toContain('requiredViewerLocalDateTimeTestIds');
    expect(docSource).toContain('primaryActionTestIds');
    expect(docSource).toContain('prominentActionScopeTestIds');
    expect(docSource).toContain('surface::target');
    expect(docSource).toContain('scope 容器');
    expect(docSource).toContain('唯一 surface');
  });

  it('finalizes lane-local generated root state when the mock visual lane exits', async () => {
    const script = await readFile('scripts/run-mock-lane-playwright.sh', 'utf-8');

    expect(script).toContain('next_generated_root_finalize_lane_cleanup');
    const cleanupIndex = script.indexOf('cleanup()');
    const finalizeIndex = script.indexOf('next_generated_root_finalize_lane_cleanup');

    expect(cleanupIndex).toBeGreaterThanOrEqual(0);
    expect(finalizeIndex).toBeGreaterThan(cleanupIndex);
  });
});
