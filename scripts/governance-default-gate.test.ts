import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFocusedVisualExpectedSet } from './focused-visual-selection';

function readGovernanceGateScript() {
  return readFileSync('scripts/governance-default-gate.sh', 'utf8');
}

function extractVisualGrep(script: string) {
  const match = script.match(/e2e\/visual\.spec\.ts[\s\S]*?--grep '([^']+)'/);
  if (!match) {
    throw new Error('governance default gate visual grep was not found');
  }
  return new RegExp(match[1]);
}

function extractExpectedSet(script: string): string[] {
  const match = script.match(/GOVERNANCE_FOCUSED_VISUAL_EXPECTED_SET='([^']+)'/);
  if (!match) {
    throw new Error('governance focused visual expected set was not found');
  }
  return parseFocusedVisualExpectedSet(match[1]).map((entry) => entry.key);
}

function extractWarmUrlRoutes(script: string): string[][] {
  return [...script.matchAll(/MOCK_LANE_WARM_URLS=\$'([^']+)'/g)].map((match) =>
    match[1]
      .split('\\n')
      .map((route) => route.trim())
      .filter(Boolean),
  );
}

describe('governance-default-gate', () => {
  it('stays shell-syntax valid', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/governance-default-gate.sh'])).not.toThrow();
  });

  it('keeps focused visual coverage enabled by default and skippable only by explicit flag or env', () => {
    const script = readGovernanceGateScript();

    expect(script).toContain('SKIP_FOCUSED_VISUAL="${GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}"');
    expect(script).toContain('--skip-focused-visual');
    expect(script).toContain('if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then');
    expect(script).toContain('skipping governance focused visual mock lane; full visual evidence is owned by lane:visual');
    expect(script).toContain('e2e/visual.spec.ts');
    expect(script).toContain('--focused-visual-expected-set "${GOVERNANCE_FOCUSED_VISUAL_EXPECTED_SET}"');
    expect(script).not.toContain('--allow-empty-selection');
    expect(extractExpectedSet(script)).toEqual([
      'alerts-notifications-tab:default',
      'drawer-audit-detail:default',
      'members-effective-access-drawer:default',
      'members:dark',
      'members:light',
      'resource-policy:dark',
      'resource-policy:light',
    ]);
    expect(script).toContain("--grep 'Visual - Story Catalog Scenes.*(");
  });

  it('uses governance-scoped warm routes for mock and focused visual Playwright calls', () => {
    const script = readGovernanceGateScript();
    const warmRoutes = extractWarmUrlRoutes(script);

    expect(warmRoutes).toEqual([
      [
        '/en-US/login',
        '/en-US/workspaces/ws_default/projects/proj_001/members',
        '/en-US/workspaces/ws_default/projects/proj_001/resource-policy',
      ],
      [
        '/en-US/login',
        '/en-US/workspaces/ws_default/projects/proj_001/members',
        '/en-US/workspaces/ws_default/projects/proj_001/resource-policy',
        '/en-US/workspaces/ws_default/projects/proj_001/audit',
        '/en-US/workspaces/ws_default/projects/proj_001/alerts',
      ],
    ]);
    for (const routes of warmRoutes) {
      expect(routes).not.toContain('/en-US/user/profile');
      expect(routes).not.toContain('/en-US/workspaces/ws_default/settings');
      expect(routes).not.toContain('/en-US/workspaces/ws_default/projects/proj_001/files');
    }
  });

  it('keeps the visual grep aligned with current governance visual scene titles', () => {
    const grep = extractVisualGrep(readGovernanceGateScript());
    const requiredGovernanceSceneTitles = [
      'Visual - Story Catalog Scenes › governance_pages / members › members [dark]',
      'Visual - Story Catalog Scenes › governance_pages / members › members [light]',
      'Visual - Story Catalog Scenes › overlay_drawers / members-effective-access-drawer › members-effective-access-drawer [default]',
      'Visual - Story Catalog Scenes › governance_pages / resource-policy › resource-policy [dark]',
      'Visual - Story Catalog Scenes › governance_pages / resource-policy › resource-policy [light]',
      'Visual - Story Catalog Scenes › overlay_drawers / drawer-audit-detail › drawer-audit-detail [default]',
      'Visual - Story Catalog Scenes › overlay_drawers / alerts-notifications-tab › alerts-notifications-tab [default]',
    ];

    expect(requiredGovernanceSceneTitles.filter((title) => grep.test(title))).toEqual(requiredGovernanceSceneTitles);
  });
});
