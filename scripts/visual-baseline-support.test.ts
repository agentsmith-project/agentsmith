import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinition } from '../e2e/story-loader';
import {
  groupVisualBaselineCatalogByScenario,
  listVisualBaselineCatalogEntries,
  parseVisualBaselineBuildRecord,
  renderVisualBaselineScenarioReviewMarkdown,
  resolveVisualBaselineStoryEvidence,
  resolveVisualBaselineStableMarkers,
  resolveVisualBaselineReviewDir,
} from '../e2e/visual-baseline-support';

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

  it('renders a review record that ties screenshots back to route and recipe family', () => {
    const grouped = groupVisualBaselineCatalogByScenario();
    const scenario = grouped.get('desktop-auth-complete');
    expect(scenario).toBeDefined();

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
        reviewer: 'codex',
        reviewedAt: '2026-04-12T12:00:00.000Z',
        verdict: 'needs_work',
        cursorFit: 'partial',
        uxFit: 'mixed',
        notes: ['Single-column completion flow should align with the public auth shell recipe.'],
        blockingFindings: ['Light and dark screenshots must be reviewed together before acceptance.'],
      },
    });

    expect(markdown).toContain('# desktop-auth-complete');
    expect(markdown).toContain('- recipe_family: public_auth_single');
    expect(markdown).toContain('- build_run_id: run-20260412-001');
    expect(markdown).toContain('- build_git_sha: abc123');
    expect(markdown).toContain('- build_fingerprint: abc123:mock-lane:visual');
    expect(markdown).toContain('- build_started_at: 2026-04-12T11:59:00.000Z');
    expect(markdown).toContain('- story_evidence_policy: required');
    expect(markdown).toContain('- story_evidence_kind: visual_scene_catalog');
    expect(markdown).toContain('- story_evidence_owner: lane:visual');
    expect(markdown).toContain('- desktop-auth-complete-dark.png [dark]');
    expect(markdown).toContain('- desktop-auth-complete-light.png [light]');
    expect(markdown).toContain('Light and dark screenshots must be reviewed together before acceptance.');
  });

  it('includes stable marker metadata in review markdown for non-public recipe families', () => {
    const grouped = groupVisualBaselineCatalogByScenario();
    const scenario = grouped.get('system-workspaces');
    expect(scenario).toBeDefined();

    const markdown = renderVisualBaselineScenarioReviewMarkdown({
      scenario: scenario!,
      review: {
        reviewer: 'codex',
        reviewedAt: '2026-04-12T12:05:00.000Z',
        verdict: 'aligned',
        cursorFit: 'aligned',
        uxFit: 'low_mindload',
        notes: ['System workspaces now wait on the list/detail recipe instead of the old heading.'],
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

    expect(resolveVisualBaselineStableMarkers('system-workspaces')).toEqual([
      'system-workspaces__list',
      'system-workspaces__editor-empty',
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
      'settings__ownership-section',
      'settings__project-admins-section',
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

  it('writes review artifacts with required visual build metadata from the snake_case build info file', () => {
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
      path.join(outputRoot, runId, 'desktop-auth-complete', 'review.md'),
      'utf8',
    );
    expect(review).toContain('- build_run_id: run-20260412-001');
    expect(review).toContain('- build_git_sha: abc123');
    expect(review).toContain('- build_fingerprint: fingerprint-001');
    expect(review).toContain('- build_started_at: 2026-04-12T11:59:00.000Z');
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
    expect(grouped.get('system-workspaces')).toMatchObject({
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-governance-surfaces.story.md',
      storySceneId: 'system-workspaces',
    });
    expect(grouped.get('alerts')).toMatchObject({
      storySourceFile: 'e2e/stories/mock-lane/mock-lane-alerts-and-usage-review.story.md',
      storySceneId: 'alerts',
    });
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
