import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  groupVisualBaselineCatalogByScenario,
  listVisualBaselineCatalogEntries,
  renderVisualBaselineScenarioReviewMarkdown,
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
      expect(entry.sourceSpec).toBe('e2e/visual.spec.ts');
    }
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

    expect(resolveVisualBaselineStableMarkers('system-info')).toEqual([
      'system-info__shell',
      'system-info__health',
      'system-info__next-steps',
    ]);

    expect(resolveVisualBaselineStableMarkers('usage')).toEqual([
      'usage__work-surface',
      'usage__summary-line',
      'usage__selected-endpoint',
      'usage__trend',
    ]);

    expect(resolveVisualBaselineStableMarkers('usage-endpoint-switch')).toEqual([
      'usage__work-surface',
      'usage__summary-line',
      'usage__selected-endpoint',
      'usage__trend',
      'usage__limits',
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

    expect(resolveVisualBaselineStableMarkers('workspace-settings')).toEqual([
      'ws-settings__summary-line',
      'ws-settings__workspace',
      'ws-settings__integrations',
      'ws-settings__projects',
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

  it('forces the mock lane to write explicit visual build metadata before Playwright starts', async () => {
    const script = await readFile('scripts/run-mock-lane-playwright.sh', 'utf-8');

    expect(script).toContain('VISUAL_BUILD_INFO_FILE');
    expect(script).toContain('write_visual_build_info');
    expect(script).toContain('VISUAL_BASELINE_BUILD_INFO_FILE');
    expect(script).toContain('VISUAL_BASELINE_BUILD_FINGERPRINT');
  });
});
