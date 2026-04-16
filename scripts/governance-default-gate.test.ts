import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

describe('governance-default-gate', () => {
  it('stays shell-syntax valid', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/governance-default-gate.sh'])).not.toThrow();
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
