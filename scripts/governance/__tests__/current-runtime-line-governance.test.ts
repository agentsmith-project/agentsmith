import { execFileSync, execSync } from 'node:child_process';

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

    const bindings = Object.fromEntries(CURRENT_RUNTIME_SHARED_RULES.map((rule) => [rule.id, rule.binding]));
    expect(bindings['shared-local-substrate']).toBe('operational_baseline');
    expect(bindings['single-active-local-flow']).toBe('operational_baseline');
    expect(bindings['scenario-owned-kind-worlds']).toBe('contract');
    expect(bindings['deploy-vs-rehearsal-boundary']).toBe('contract');
  });

  it('keeps the expected local runtime lines visible', () => {
    expect(listCurrentLocalRuntimeLines().map((line) => line.id)).toEqual([
      'local-manual',
      'demo-rehearsal',
      'cluster-rehearsal',
    ]);
  });

  it('keeps rehearsal sandbox host-port truth explicit and stable', () => {
    const sandboxPortsByLine = Object.fromEntries(
      CURRENT_RUNTIME_LINE_MANIFEST.map((line) => [
        line.id,
        (line as { sandboxHostPort?: number }).sandboxHostPort,
      ]),
    );

    expect(sandboxPortsByLine['demo-rehearsal']).toBe(29280);
    expect(sandboxPortsByLine['cluster-rehearsal']).toBe(29080);
    expect(new Set([sandboxPortsByLine['demo-rehearsal'], sandboxPortsByLine['cluster-rehearsal']]).size).toBe(2);
  });

  it('keeps rehearsal local registry host-port truth isolated from the shared local registry', () => {
    const registryPortsByLine = Object.fromEntries(
      CURRENT_RUNTIME_LINE_MANIFEST.map((line) => [
        line.id,
        (line as { localRegistryHostPort?: number }).localRegistryHostPort,
      ]),
    );

    expect(registryPortsByLine['demo-rehearsal']).toBe(5003);
    expect(registryPortsByLine['cluster-rehearsal']).toBe(5002);
    expect(registryPortsByLine['demo-rehearsal']).not.toBe(5001);
  });

  it('keeps runtime-line artifact roots machine-readable and aligned with the shell helper', () => {
    for (const line of CURRENT_RUNTIME_LINE_MANIFEST) {
      const helperOutput = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            source "${process.cwd()}/scripts/lib/runtime-line-state.sh"
            printf 'lines_root_relative=%s\\n' "$(runtime_lines_root_relative)"
            printf 'line_root_relative=%s\\n' "$(runtime_line_root_relative "${line.id}")"
            printf 'current_root_relative=%s\\n' "$(runtime_line_current_relative "${line.id}")"
          `,
        ],
        {
          cwd: process.cwd(),
          stdio: 'pipe',
          encoding: 'utf8',
        },
      );

      const helperValues = Object.fromEntries(
        helperOutput
          .trim()
          .split('\n')
          .map((entry) => entry.split(/=(.+)/, 2) as [string, string]),
      );

      const runtimePath = (line as unknown as {
        runtimePath?: {
          linesRootRelative?: string;
          lineRootRelative?: string;
          currentRootRelative?: string;
        };
      }).runtimePath;

      expect(runtimePath?.linesRootRelative).toBe(helperValues.lines_root_relative);
      expect(runtimePath?.lineRootRelative).toBe(helperValues.line_root_relative);
      expect(runtimePath?.currentRootRelative).toBe(helperValues.current_root_relative);
    }
  });

  it('keeps generated runtime-line docs in sync with the repository state', () => {
    expect(() => execSync('npm run current-runtime-lines:check', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8',
    })).not.toThrow();
  });
});
