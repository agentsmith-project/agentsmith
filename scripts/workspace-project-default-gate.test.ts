import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  listVisualBaselineCatalogEntries,
  type VisualBaselineCatalogEntry,
} from '../e2e/visual-baseline-support';
import {
  parseFocusedVisualExpectedSet,
  type FocusedVisualSelectionEntry,
} from './focused-visual-selection';

const VISUAL_TITLE_SEPARATOR = '\u203a';

function readWorkspaceProjectGateScript(): string {
  return readFileSync('scripts/workspace-project-default-gate.sh', 'utf8');
}

function extractExpectedSet(script: string): string[] {
  return extractExpectedSetEntries(script).map((entry) => entry.key);
}

function extractExpectedSetEntries(script: string): FocusedVisualSelectionEntry[] {
  const match = script.match(/WORKSPACE_PROJECT_FOCUSED_VISUAL_EXPECTED_SET='([^']+)'/);
  if (!match) {
    throw new Error('workspace/project focused visual expected set was not found');
  }
  return parseFocusedVisualExpectedSet(match[1]);
}

function extractVisualGrep(script: string): RegExp {
  const match = script.match(/e2e\/visual\.spec\.ts[\s\S]*?--grep '([^']+)'/);
  if (!match) {
    throw new Error('workspace/project default gate visual grep was not found');
  }
  return new RegExp(match[1]);
}

function visualCatalogKey(entry: Pick<VisualBaselineCatalogEntry, 'scenarioId' | 'theme'>): string {
  return `${entry.scenarioId}:${entry.theme}`;
}

function visualCatalogTitle(entry: Pick<VisualBaselineCatalogEntry, 'group' | 'scenarioId' | 'theme'>): string {
  return `Visual - Story Catalog Scenes ${VISUAL_TITLE_SEPARATOR} ${entry.group} / ${entry.scenarioId} ${VISUAL_TITLE_SEPARATOR} ${entry.scenarioId} [${entry.theme}]`;
}

describe('workspace-project-default-gate', () => {
  it('stays shell-syntax valid', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/workspace-project-default-gate.sh'])).not.toThrow();
  });

  it('keeps focused visual coverage enabled by default and skippable only by explicit flag or env', () => {
    const script = readWorkspaceProjectGateScript();

    expect(script).toContain('SKIP_FOCUSED_VISUAL="${WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}"');
    expect(script).toContain('--skip-focused-visual');
    expect(script).toContain('if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then');
    expect(script).toContain('skipping workspace/project focused visual mock lane; full visual evidence is owned by lane:visual');
    expect(script).toContain('e2e/visual.spec.ts');
    expect(script).toContain('--focused-visual-expected-set "${WORKSPACE_PROJECT_FOCUSED_VISUAL_EXPECTED_SET}"');
    expect(script).not.toContain('--allow-empty-selection');
    expect(script).not.toContain('workspace selection|workspace login|workspace home');
    expect(extractExpectedSet(script)).toEqual([
      'dialog-project-join-now:default',
      'dialog-project-join-request:default',
      'notification-center-join-request:default',
      'overview:dark',
      'overview:light',
      'projects-empty:default',
      'projects-list-public-discovery:default',
      'projects-list:default',
      'workspace-home-project-creator:default',
      'workspace-home:dark',
      'workspace-home:light',
      'workspace-login:dark',
      'workspace-login:light',
      'workspace-overview:dark',
      'workspace-overview:light',
      'workspace-select:dark',
      'workspace-select:light',
      'workspace-settings-create-project:default',
      'workspace-settings:dark',
      'workspace-settings:light',
    ]);
    expect(script).toContain(
      "--grep 'Visual - Story Catalog Scenes.*(",
    );
  });

  it('keeps shared preflight skip independent from focused visual skip', () => {
    const script = readWorkspaceProjectGateScript();
    const sharedPreflightIndex = script.indexOf('if [[ "${SKIP_SHARED_PREFLIGHT}" != "1" ]]; then');
    const focusedVisualIndex = script.indexOf('if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then');

    expect(sharedPreflightIndex).toBeGreaterThanOrEqual(0);
    expect(focusedVisualIndex).toBeGreaterThan(sharedPreflightIndex);
    expect(script).toContain('--skip-shared-preflight');
    expect(script).toContain('--skip-focused-visual');
  });

  it('keeps unified deploy diagnostics out of the workspace/project default gate', () => {
    const script = readWorkspaceProjectGateScript();

    expect(script).not.toMatch(/\bnpm run test:unified-deploy(?::[a-z0-9:_-]+)?\b/);
  });

  it('keeps the visual grep exact and aligned with current workspace/project visual catalog titles', () => {
    const script = readWorkspaceProjectGateScript();
    const grep = extractVisualGrep(script);
    const expectedEntries = extractExpectedSetEntries(script);
    const expectedKeys = expectedEntries.map((entry) => entry.key);
    const expectedKeySet = new Set(expectedKeys);
    const catalogEntries = listVisualBaselineCatalogEntries();
    const catalogKeysForExpectedSet = catalogEntries
      .map(visualCatalogKey)
      .filter((key) => expectedKeySet.has(key))
      .sort((left, right) => left.localeCompare(right));
    const grepSelectedEntries = catalogEntries
      .map((entry) => ({
        key: visualCatalogKey(entry),
        title: visualCatalogTitle(entry),
      }))
      .filter((entry) => grep.test(entry.title))
      .sort((left, right) => left.key.localeCompare(right.key));

    expect(catalogKeysForExpectedSet).toEqual(expectedKeys);
    expect(grepSelectedEntries.map((entry) => entry.key)).toEqual(expectedKeys);
    expect(grepSelectedEntries.map((entry) => entry.title)).toEqual([
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'dialog-project-join-now',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'dialog-project-join-request',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'notification-center-join-request',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'project_pages',
        scenarioId: 'overview',
        theme: 'dark',
      }),
      visualCatalogTitle({
        group: 'project_pages',
        scenarioId: 'overview',
        theme: 'light',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'projects-empty',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'projects-list-public-discovery',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'projects-list',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-home-project-creator',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-home',
        theme: 'dark',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-home',
        theme: 'light',
      }),
      visualCatalogTitle({
        group: 'public_pages',
        scenarioId: 'workspace-login',
        theme: 'dark',
      }),
      visualCatalogTitle({
        group: 'public_pages',
        scenarioId: 'workspace-login',
        theme: 'light',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-overview',
        theme: 'dark',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-overview',
        theme: 'light',
      }),
      visualCatalogTitle({
        group: 'public_pages',
        scenarioId: 'workspace-select',
        theme: 'dark',
      }),
      visualCatalogTitle({
        group: 'public_pages',
        scenarioId: 'workspace-select',
        theme: 'light',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-settings-create-project',
        theme: 'default',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-settings',
        theme: 'dark',
      }),
      visualCatalogTitle({
        group: 'workspace_pages',
        scenarioId: 'workspace-settings',
        theme: 'light',
      }),
    ]);
  });
});
