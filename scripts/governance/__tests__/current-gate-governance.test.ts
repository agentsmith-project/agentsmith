import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_GATE_MANIFEST,
  listCurrentGateDefinitionsByKind,
} from '../current-gate-manifest';

describe('current gate governance', () => {
  it('keeps current gate definitions structurally complete and uniquely keyed', () => {
    expect(CURRENT_GATE_MANIFEST.length).toBeGreaterThan(0);

    const ids = new Set<string>();
    const npmScripts = new Set<string>();

    for (const definition of CURRENT_GATE_MANIFEST) {
      expect(definition.id.length).toBeGreaterThan(0);
      expect(definition.npmScript.length).toBeGreaterThan(0);
      expect(definition.command.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(['test', 'gate', 'lane']).toContain(definition.kind);
      expect(['none', 'targeted', 'full']).toContain(definition.visualPolicy);
      expect(['none', 'optional', 'required']).toContain(definition.backendRealPolicy);
      expect(['none', 'required']).toContain(definition.storyEvidencePolicy);
      expect(Array.isArray(definition.storyEvidenceKinds)).toBe(true);
      expect(Array.isArray(definition.storyEvidenceArtifacts)).toBe(true);
      expect(ids.has(definition.id)).toBe(false);
      expect(npmScripts.has(definition.npmScript)).toBe(false);
      ids.add(definition.id);
      npmScripts.add(definition.npmScript);
    }
  });

  it('keeps gate:default and lane:visual semantics separated', () => {
    const gates = listCurrentGateDefinitionsByKind('gate');
    const lanes = listCurrentGateDefinitionsByKind('lane');
    const gateDefault = gates.find((definition) => definition.npmScript === 'gate:default');
    const laneVisual = lanes.find((definition) => definition.npmScript === 'lane:visual');

    expect(gateDefault?.visualPolicy).toBe('targeted');
    expect(gateDefault?.command).not.toContain('test:visual');
    expect(laneVisual?.visualPolicy).toBe('full');
    expect(laneVisual?.command).toBe('npm run test:visual');
  });

  it('keeps release-full semantics explicit', () => {
    const releaseFull = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:release:full');
    const demoLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:demo-rehearsal');
    const clusterLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:cluster-rehearsal');

    expect(releaseFull?.requiredFor).toContain('release');
    expect(releaseFull?.command).toContain('npm run gate:release');
    expect(releaseFull?.command).toContain('npm run lane:visual');
    expect(releaseFull?.command).toContain('npm run lane:demo-rehearsal');
    expect(releaseFull?.command).toContain('npm run lane:cluster-rehearsal');
    expect(demoLane?.requiredFor).toContain('release');
    expect(clusterLane?.requiredFor).toContain('release');
  });

  it('keeps machine-readable story evidence ownership aligned with visual and release lanes', () => {
    const visualLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:visual');
    const visualTest = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'test:visual');
    const releaseGate = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:release');
    const releaseLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:backend-real:release');
    const releaseFull = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:release:full');

    expect(visualLane?.storyEvidencePolicy).toBe('required');
    expect(visualLane?.storyEvidenceKinds).toEqual(['visual_scene_catalog']);
    expect(visualLane?.storyEvidenceSceneSource).toBe('e2e/visual-baseline-support.ts');

    expect(visualTest?.storyEvidencePolicy).toBe('required');
    expect(visualTest?.storyEvidenceKinds).toEqual(['visual_scene_catalog']);

    expect(releaseGate?.storyEvidencePolicy).toBe('required');
    expect(releaseGate?.storyEvidenceKinds).toEqual(['ux_trace_bundle']);

    expect(releaseLane?.storyEvidencePolicy).toBe('required');
    expect(releaseLane?.storyEvidenceKinds).toEqual(['ux_trace_bundle']);
    expect(releaseLane?.storyEvidenceArtifacts).toContain('artifacts/backend-real-visual/<run-id>/ux-traces');

    expect(releaseFull?.storyEvidencePolicy).toBe('required');
    expect(releaseFull?.storyEvidenceKinds).toEqual(['visual_scene_catalog', 'ux_trace_bundle']);
  });

  it('keeps generated gate contracts in sync with the repository state', () => {
    expect(() => execSync('npm run contracts:check-current-gates', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8',
    })).not.toThrow();
  });
});
