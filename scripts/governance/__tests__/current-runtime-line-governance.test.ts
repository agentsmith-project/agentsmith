import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_RUNTIME_LINE_MANIFEST,
  CURRENT_RUNTIME_SHARED_RULES,
  listCurrentLocalRuntimeLines,
} from '../current-runtime-line-manifest';

describe('current runtime-line governance', () => {
  it('keeps current runtime-line definitions structurally complete', () => {
    expect(CURRENT_RUNTIME_SHARED_RULES.length).toBeGreaterThan(0);
    expect(CURRENT_RUNTIME_LINE_MANIFEST.length).toBeGreaterThan(0);

    const ids = new Set<string>();
    for (const line of CURRENT_RUNTIME_LINE_MANIFEST) {
      expect(line.id.length).toBeGreaterThan(0);
      expect(line.label.length).toBeGreaterThan(0);
      expect(line.formalName.length).toBeGreaterThan(0);
      expect(line.primaryUse.length).toBeGreaterThan(0);
      expect(line.externalPath.length).toBeGreaterThan(0);
      expect(line.internalPath.length).toBeGreaterThan(0);
      expect(line.substrate.length).toBeGreaterThan(0);
      expect(line.note.length).toBeGreaterThan(0);
      expect(line.guidePath.length).toBeGreaterThan(0);
      expect(ids.has(line.id)).toBe(false);
      ids.add(line.id);
    }
  });

  it('keeps the expected local runtime lines visible', () => {
    expect(listCurrentLocalRuntimeLines().map((line) => line.id)).toEqual([
      'local-manual',
      'demo-rehearsal',
      'cluster-rehearsal',
    ]);
  });

  it('keeps generated runtime-line docs in sync with the repository state', () => {
    expect(() => execSync('npm run current-runtime-lines:check', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8',
    })).not.toThrow();
  });
});
