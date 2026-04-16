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

  it('models desktop-auth-request visual truth as public missing-link recovery, not an authenticated handoff', async () => {
    const story = await loadStoryDefinition('mock-lane-entry-access');
    const scene = story.scenes.find((entry) => entry.sceneId === 'desktop-auth-request');
    const visualScene = story.runtimeData?.visualReview?.scenes.find((entry) => entry.sceneId === 'desktop-auth-request');
    const grouped = groupVisualBaselineCatalogByScenario();
    const scenario = grouped.get('desktop-auth-request');

    expect(scene).toMatchObject({
      route: '/en-US/desktop/auth/request',
      authLane: 'public',
      stableMarkers: ['desktop-auth-request__title'],
    });
    expect(visualScene).toMatchObject({
      scenarioId: 'desktop-auth-request',
      authLane: 'public',
      scenario: expect.stringContaining('missing-link'),
    });
    expect(scenario).toMatchObject({
      route: '/en-US/desktop/auth/request',
      authLane: 'public',
      recipeFamily: 'public_auth_split',
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
    const semanticIndex = visualSpec.indexOf('expectVisualSemanticAssertions(page, scenario.semanticAssertions, scenario.scenarioId)');
    const helperIndex = visualSpec.indexOf('async function captureSnapshotBoundActualScreenshot');
    const captureIndex = visualSpec.indexOf('const actualCapture = await captureSnapshotBoundActualScreenshot({');
    const snapshotIndex = visualSpec.indexOf('._expectScreenshot({');
    const writeCaptureIndex = visualSpec.indexOf('actualCapture,');

    expect(semanticIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(writeCaptureIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeLessThan(captureIndex);
    expect(semanticIndex).toBeLessThan(captureIndex);
    expect(snapshotIndex).toBeLessThan(writeCaptureIndex);
    expect(visualSpec).not.toContain('toHaveScreenshot(entry.screenshot');
    expect(visualSpec).toMatch(/'workspace-overview':[\s\S]*screenshotOptions:[\s\S]*maxDiffPixelRatio: 0/);
    expect(visualSpec).toContain('scenario.semanticAssertions.requiredViewportTestIds.length > 0');
    expect(visualSpec).toContain('maxDiffPixelRatio: 0');
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

  it('requires notebook create-task CTA semantic visibility in the first viewport instead of DOM visibility only', () => {
    const notebook = groupVisualBaselineCatalogByScenario().get('notebook');
    const lifecycleList = groupVisualBaselineCatalogByScenario().get('notebook-task-lifecycle-list');
    expect(notebook).toBeDefined();
    expect(lifecycleList).toBeDefined();

    expect(notebook?.semanticAssertions.requiredViewportTestIds).toContain('notebook__create-task-btn');
    expect(lifecycleList?.semanticAssertions.requiredViewportTestIds).toContain('notebook__create-task-btn');
    expect(resolveVisualBaselineSemanticAssertions('notebook-task-lifecycle-list').requiredViewportTestIds)
      .toContain('notebook__create-task-btn');
  });

  it('forbids stitched create-task dialog copy and top-level workspace wording in visual semantics', () => {
    const dialog = groupVisualBaselineCatalogByScenario().get('notebook-create-task-dialog');
    const lifecycleDialog = groupVisualBaselineCatalogByScenario().get('notebook-task-lifecycle-create-dialog');
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
    const failedSystemWorkspaces = groupVisualBaselineCatalogByScenario().get('system-workspaces-failed-state');
    const disabledConnections = groupVisualBaselineCatalogByScenario().get('workspace-connections-feishu-disabled');
    const connectedConnections = groupVisualBaselineCatalogByScenario().get('workspace-connections-feishu-connected');

    expect(systemWorkspacesEmpty?.semanticAssertions.primaryActionTestIds).toEqual(['system-workspaces__empty-create']);
    expect(systemWorkspacesEmpty?.semanticAssertions.maxProminentActions).toBe(1);
    expect(systemWorkspacesDefault?.semanticAssertions.primaryActionTestIds).toEqual(['system-workspaces__new-workspace']);
    expect(systemWorkspacesDefault?.semanticAssertions.maxProminentActions).toBe(1);
    expect(failedSystemWorkspaces?.semanticAssertions.primaryActionTestIds).toEqual(['system-workspaces__enable-edit']);
    expect(failedSystemWorkspaces?.semanticAssertions.maxProminentActions).toBe(1);
    expect(disabledConnections?.semanticAssertions.primaryActionTestIds).toEqual([]);
    expect(disabledConnections?.semanticAssertions.maxProminentActions).toBe(0);
    expect(connectedConnections?.semanticAssertions.primaryActionTestIds).toEqual([]);
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
    const notebookLifecycleList = groupVisualBaselineCatalogByScenario().get('notebook-task-lifecycle-list');

    expect(connectedConnections?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'workspace-connections__last-refresh-value',
    ]);
    expect(notebookLifecycleList?.semanticAssertions.requiredViewerLocalDateTimeTestIds).toEqual([
      'notebook__task-last-activity',
      'notebook__task-created-at',
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
    const scenario = grouped.get('desktop-auth-complete');
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
        actualUrl: '/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001',
        findings: ['Single-column completion flow should align with the public auth shell recipe.'],
        blockingFindings: ['Light and dark screenshots must be reviewed together before acceptance.'],
      },
    });

    expect(markdown).toContain('# desktop-auth-complete');
    expect(markdown).toContain('- schema: visual_baseline_ux_acceptance/v1');
    expect(markdown).toContain('- scenario_id: desktop-auth-complete');
    expect(markdown).toContain('- recipe_family: public_auth_single');
    expect(markdown).toContain('- actual_url: /en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001');
    expect(markdown).toContain(`- story_fingerprint: ${evidence.storyFingerprint}`);
    expect(markdown).toContain('- reviewer_id: codex-d1-reviewer');
    expect(markdown).toContain('- reviewer_kind: ai_reviewer');
    expect(markdown).toContain('- review_mode: ai_native_screenshot_review');
    expect(markdown).toContain('- verdict: needs_work');
    expect(markdown).toContain('- accepted_screenshot_hashes: desktop-auth-complete-dark.png=sha256:');
    expect(markdown).toContain('- accepted_baseline_hashes: desktop-auth-complete-dark.png=sha256:');
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
    expect(markdown).toContain('- desktop-auth-complete-dark.png [dark]');
    expect(markdown).toContain('- desktop-auth-complete-light.png [light]');
    expect(markdown).toContain('Light and dark screenshots must be reviewed together before acceptance.');
  });

  it('renders automated visual pass artifacts without UX acceptance verdict or reviewer proof', () => {
    const scenario = groupVisualBaselineCatalogByScenario().get('desktop-auth-complete');
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
        actualUrl: '/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001',
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
    expect(markdown).toContain('- accepted_screenshot_hashes: desktop-auth-complete-dark.png=sha256:');
    expect(markdown).toContain('- accepted_baseline_hashes: desktop-auth-complete-dark.png=sha256:');
    expect(markdown).not.toContain('- verdict:');
    expect(markdown).not.toContain('- reviewer_id:');
  });

  it('renders automated visual pass artifacts with explicit run-local actual screenshot hashes and build ids', () => {
    const scenario = groupVisualBaselineCatalogByScenario().get('desktop-auth-complete');
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
        actualUrl: '/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001',
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
      'project-hub__summary',
      'project-hub__use-summary',
      'project-hub__governance-summary',
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
    expect(grouped.get('notebook-task-lifecycle-list')?.storyId).toBe('mock-lane-notebook-task-lifecycle');
    expect(grouped.get('notebook-task-lifecycle-create-dialog')?.storyId).toBe('mock-lane-notebook-task-lifecycle');
    expect(grouped.get('notebook-task-lifecycle-detail')?.storyId).toBe('mock-lane-notebook-task-lifecycle');
    expect(grouped.get('notebook-task-lifecycle-artifact')?.storyId).toBe('mock-lane-notebook-task-lifecycle');
    expect(grouped.get('project-settings-review')?.storyId).toBe('mock-lane-settings-and-members-review');
    expect(grouped.get('project-members-review')?.storyId).toBe('mock-lane-settings-and-members-review');
  });

  it('reads mock-lane visual scene metadata from the canonical story runtimeData contract', async () => {
    const story = await loadStoryDefinition('mock-lane-chat-operate-and-recover');

    expect(story.runtimeData?.visualReview?.scenes).toEqual([
      {
        sceneId: 'chat-operate',
        scenarioId: 'chat-operate',
        scenario: expect.stringContaining('active thread'),
        group: 'project_pages',
        codeRefs: expect.arrayContaining([
          'e2e/visual.spec.ts',
          'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx',
          'src/components/chat/ChatMainPane.tsx',
          'src/components/chat/ChatHeader.tsx',
          'src/components/chat/ThreadsPane.tsx',
        ]),
        capture: 'full_page',
        authLane: 'authed',
        setupNotes: ['viewport:1440x900'],
        themes: ['light', 'dark'],
      },
      {
        sceneId: 'chat-recover-empty',
        scenarioId: 'chat-recover-empty',
        scenario: expect.stringContaining('search results filtered to zero'),
        group: 'project_pages',
        codeRefs: expect.arrayContaining([
          'e2e/visual.spec.ts',
          'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx',
          'src/components/chat/ChatMainPane.tsx',
          'src/components/chat/ThreadsPane.tsx',
        ]),
        capture: 'full_page',
        authLane: 'authed',
        setupNotes: ['viewport:1440x900'],
        themes: ['light', 'dark'],
      },
    ]);
  });

  it('exposes stable recipe markers for public/auth scenarios so visual waits can target real readiness points', () => {
    expect(resolveVisualBaselineStableMarkers('workspace-select')).toEqual([
      'workspace-select__heading',
      'workspace-select__list',
      'workspace-select__system-link',
    ]);

    expect(resolveVisualBaselineStableMarkers('desktop-auth-request')).toEqual([
      'desktop-auth-request__title',
    ]);

    expect(resolveVisualBaselineStableMarkers('desktop-auth-complete')).toEqual([
      'desktop-auth-complete__title',
      'desktop-auth-complete__workspace-entry-link',
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
      'project-hub__summary',
      'project-hub__use-summary',
      'project-hub__governance-summary',
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
      'chat__threads-empty-new-thread',
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

    expect(resolveVisualBaselineStableMarkers('notebook-task-lifecycle-list')).toEqual([
      'notebook__task-list',
      'notebook__task-card',
      'notebook__create-task-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('notebook-task-lifecycle-create-dialog')).toEqual([
      'notebook__create-task-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('notebook-task-lifecycle-detail')).toEqual([
      'notebook__task-header',
      'notebook__conversation-input',
      'notebook__send-btn',
    ]);

    expect(resolveVisualBaselineStableMarkers('notebook-task-lifecycle-artifact')).toEqual([
      'notebook__task-header',
      'notebook__artifact-card',
      'notebook__artifact-hover-panel',
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
      path.join(outputRoot, runId, 'desktop-auth-complete', 'automated-pass.md'),
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
    const scenarioId = 'desktop-auth-complete';
    const screenshotFile = 'desktop-auth-complete-dark.png';
    const mutatedActual = Buffer.from('run-bound actual screenshot bytes for desktop-auth-complete-dark');
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
      actual_relpath: expect.stringMatching(/^captured\/desktop-auth-complete\/.+\.png$/),
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
    const actualRoot = path.join(path.dirname(buildInfoPath), 'visual-actual-captures', 'desktop-auth-complete');
    mkdirSync(actualRoot, { recursive: true });
    writeFileSync(
      path.join(actualRoot, 'desktop-auth-complete-light.png'),
      Buffer.from('partial run-bound actual screenshot bytes for desktop-auth-complete-light'),
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
      captured_scenario_ids: ['desktop-auth-complete'],
    });
    expect(manifest.coverage?.expected_scenario_ids).toEqual(
      [...groupVisualBaselineCatalogByScenario().keys()].sort((left, right) => left.localeCompare(right)),
    );
    expect(manifest.scenarios?.map((entry) => entry.scenario_id)).toEqual(['desktop-auth-complete']);
    expect(manifest.scenarios?.[0]?.screenshots).toEqual([
      expect.objectContaining({ file_name: 'desktop-auth-complete-light.png' }),
    ]);
    expect(existsSync(path.join(outputRoot, runId, 'desktop-auth-complete', 'automated-pass.md'))).toBe(true);
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
      scenarioId: 'desktop-auth-complete',
      expectedRoute: '/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001',
      actualUrl: 'http://localhost:3001/en-US/desktop/auth/request',
    })).toThrow(/visual route drift.*desktop-auth-complete/);

    expect(() => assertVisualBaselineActualUrlMatchesRoute({
      scenarioId: 'desktop-auth-complete',
      expectedRoute: '/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001',
      actualUrl: 'http://localhost:3001/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001#ignored',
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
      'chat__threads-empty-new-thread',
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
      '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_shared_default',
    );
    expect(scenarios.get('system-workspaces-delete-confirmation')?.route).toBe(
      '/en-US/system/workspaces?workspace=ws_seeded',
    );
  });

  it('documents the mock-lane story family linkage contract', async () => {
    const docSource = await readFile(path.resolve('docs/testing/mock-lane-visual-story-linkage.md'), 'utf-8');

    expect(docSource).toContain('e2e/stories/mock-lane/*.story.md');
    expect(docSource).toContain('runtimeData.visualReview.scenes');
    expect(docSource).toContain('storySourceFile');
    expect(docSource).toContain('storySceneId');
    expect(docSource).toContain('visual-baseline-support.ts');
    expect(docSource).not.toContain('standalone scenario seed');
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
