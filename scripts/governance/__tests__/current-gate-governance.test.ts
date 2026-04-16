import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_GATE_MANIFEST,
  findCurrentGateDefinition,
  findCurrentGateDefinitionById,
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
      expect(Array.isArray(definition.executionTargets)).toBe(true);
      expect(definition.executionTargets.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(['test', 'gate', 'lane']).toContain(definition.kind);
      expect(['none', 'targeted', 'full']).toContain(definition.visualPolicy);
      expect(['none', 'optional', 'required']).toContain(definition.backendRealPolicy);
      expect(['none', 'required']).toContain(definition.storyEvidencePolicy);
      expect(Array.isArray(definition.storyEvidenceKinds)).toBe(true);
      expect(Array.isArray(definition.storyEvidenceArtifacts)).toBe(true);
      expect(Array.isArray(definition.standaloneEvidenceArtifacts)).toBe(true);
      expect(Array.isArray(definition.campaignEvidenceArtifacts)).toBe(true);
      expect(Array.isArray(definition.storyEvidenceRequiredFor)).toBe(true);
      expect(ids.has(definition.id)).toBe(false);
      expect(npmScripts.has(definition.npmScript)).toBe(false);
      expect(findCurrentGateDefinitionById(definition.id)).toBe(definition);
      ids.add(definition.id);
      npmScripts.add(definition.npmScript);
    }
  });

  it('treats stable gate ids as the primary gate identity', () => {
    const gateDefaultById = findCurrentGateDefinitionById('gate-default');
    const gateDefaultByAdapter = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:default');

    expect(gateDefaultById).toBeDefined();
    expect(gateDefaultByAdapter).toBeDefined();
    expect(gateDefaultById).toBe(gateDefaultByAdapter);
  });

  it('keeps adapter fidelity in structured execution targets instead of free-form command text', () => {
    const gateDefault = findCurrentGateDefinitionById('gate-default');
    const laneMock = findCurrentGateDefinitionById('lane-mock');
    const laneVisual = findCurrentGateDefinitionById('lane-visual');
    const releaseFull = findCurrentGateDefinitionById('gate-release-full');

    expect(gateDefault?.executionTargets).toEqual([
      { kind: 'shell_script', scriptPath: 'scripts/default-gate.sh', args: [] },
    ]);
    expect(laneMock?.executionTargets).toEqual([
      { kind: 'npm_script', npmScript: 'test:e2e' },
    ]);
    expect(laneVisual?.executionTargets).toEqual([
      { kind: 'npm_script', npmScript: 'test:visual' },
    ]);
    expect(releaseFull?.executionTargets).toEqual([
      { kind: 'shell_script', scriptPath: 'scripts/release-full-aggregate-gate.sh', args: [] },
    ]);
  });

  it('keeps gate:default and lane:visual semantics separated', () => {
    const gates = listCurrentGateDefinitionsByKind('gate');
    const lanes = listCurrentGateDefinitionsByKind('lane');
    const gateDefault = gates.find((definition) => definition.npmScript === 'gate:default');
    const laneVisual = lanes.find((definition) => definition.npmScript === 'lane:visual');

    expect(gateDefault?.visualPolicy).toBe('targeted');
    expect(gateDefault?.command).toBe('bash scripts/default-gate.sh');
    expect(laneVisual?.visualPolicy).toBe('full');
    expect(laneVisual?.command).toBe('npm run test:visual');
  });

  it('keeps release-full semantics explicit and aggregate-only', () => {
    const releaseFull = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:release:full');
    const demoLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:demo-rehearsal');
    const clusterLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:cluster-rehearsal');

    expect(releaseFull?.requiredFor).toContain('release');
    expect(releaseFull?.command).toBe('bash scripts/release-full-aggregate-gate.sh');
    expect(releaseFull?.command).not.toContain('npm run gate:release');
    expect(releaseFull?.command).not.toContain('npm run lane:visual');
    expect(demoLane?.requiredFor).toContain('release');
    expect(clusterLane?.requiredFor).toContain('release');
  });

  it('models lane:mock as a canonical lane object with adapter alias support', () => {
    const mockLane = findCurrentGateDefinitionById('lane-mock');

    expect(mockLane?.kind).toBe('lane');
    expect(mockLane?.npmScript).toBe('lane:mock');
    expect(mockLane?.adapterAliases).toContain('test:e2e');
    expect(findCurrentGateDefinition('lane:mock')).toBe(mockLane);
    expect(findCurrentGateDefinition('test:e2e')).toBe(mockLane);
  });

  it('keeps machine-readable story evidence ownership aligned with visual and release lanes', () => {
    const visualLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:visual');
    const visualTest = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'test:visual');
    const backendRealCoreTest = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'test:backend-real:core');
    const backendRealCoreLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:backend-real:core');
    const releaseGate = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:release');
    const releaseLane = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'lane:backend-real:release');
    const releaseFull = CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === 'gate:release:full');

    expect(visualLane?.storyEvidencePolicy).toBe('required');
    expect(visualLane?.storyEvidenceKinds).toEqual(['visual_scene_catalog']);
    expect(visualLane?.storyEvidenceRequiredFor).toEqual(['visual', 'release']);
    expect(visualLane?.storyEvidenceSceneSource).toBe('e2e/visual-baseline-support.ts');

    expect(visualTest?.storyEvidencePolicy).toBe('required');
    expect(visualTest?.storyEvidenceKinds).toEqual(['visual_scene_catalog']);
    expect(visualTest?.storyEvidenceRequiredFor).toEqual(['visual', 'release']);

    expect(backendRealCoreTest?.storyEvidencePolicy).toBe('required');
    expect(backendRealCoreTest?.storyEvidenceKinds).toEqual(['ux_trace_bundle']);
    expect(backendRealCoreTest?.storyEvidenceArtifacts).toContain('artifacts/backend-real/runs/<run-id>/ux-traces');
    expect(backendRealCoreTest?.storyEvidenceRequiredFor).toEqual(['default']);

    expect(backendRealCoreLane?.storyEvidencePolicy).toBe('required');
    expect(backendRealCoreLane?.storyEvidenceKinds).toEqual(['ux_trace_bundle']);
    expect(backendRealCoreLane?.storyEvidenceArtifacts).toContain('artifacts/backend-real/runs/<run-id>/ux-traces');
    expect(backendRealCoreLane?.storyEvidenceRequiredFor).toEqual(['default']);

    expect(releaseGate?.storyEvidencePolicy).toBe('required');
    expect(releaseGate?.storyEvidenceKinds).toEqual(['ux_trace_bundle']);
    expect(releaseGate?.storyEvidenceRequiredFor).toEqual(['release']);

    expect(releaseLane?.storyEvidencePolicy).toBe('required');
    expect(releaseLane?.storyEvidenceKinds).toEqual(['ux_trace_bundle']);
    expect(releaseLane?.storyEvidenceArtifacts).toContain('artifacts/backend-real-visual/<run-id>/ux-traces');
    expect(releaseLane?.storyEvidenceRequiredFor).toEqual(['release']);

    expect(releaseFull?.storyEvidencePolicy).toBe('required');
    expect(releaseFull?.storyEvidenceKinds).toEqual(['visual_scene_catalog', 'ux_trace_bundle']);
    expect(releaseFull?.storyEvidenceRequiredFor).toEqual(['release']);
  });

  it('keeps release evidence topology explicit between standalone and campaign roots', () => {
    const visualLane = findCurrentGateDefinitionById('lane-visual');
    const releaseGate = findCurrentGateDefinitionById('gate-release');
    const releaseLane = findCurrentGateDefinitionById('lane-backend-real-release');
    const releaseFull = findCurrentGateDefinitionById('gate-release-full');

    expect(visualLane?.standaloneEvidenceArtifacts).toContain(
      'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
    );
    expect(visualLane?.campaignEvidenceArtifacts).toContain(
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
    );
    expect(visualLane?.standaloneEvidenceArtifacts).toEqual([
      'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
    ]);
    expect(visualLane?.campaignEvidenceArtifacts).toEqual([
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
    ]);
    expect(visualLane?.standaloneEvidenceArtifacts).not.toContain(
      'artifacts/visual-baseline-reviews/<run-id>/review.md',
    );
    expect(visualLane?.campaignEvidenceArtifacts).not.toContain(
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/review.md',
    );

    expect(releaseGate?.standaloneEvidenceArtifacts).toContain(
      'artifacts/backend-real-visual/<run-id>/ux-traces',
    );
    expect(releaseGate?.campaignEvidenceArtifacts).toEqual([
      '<campaign-root>/gate-release/native/result.json',
      '<campaign-root>/gate-release/backend-real-visual/review.md',
      '<campaign-root>/gate-release/backend-real-visual/ux-traces/ux-trace-index.json',
      '<campaign-root>/gate-release/backend-real-visual/ux-traces',
    ]);

    expect(releaseLane?.standaloneEvidenceArtifacts).toContain(
      'artifacts/backend-real-visual/<run-id>/ux-traces',
    );
    expect(releaseLane?.campaignEvidenceArtifacts).toEqual(releaseGate?.campaignEvidenceArtifacts);

    expect(releaseFull?.standaloneEvidenceArtifacts).toEqual([]);
    expect(releaseFull?.campaignEvidenceArtifacts.length).toBeGreaterThan(0);
    expect(releaseFull?.storyEvidenceArtifacts).toEqual(releaseFull?.campaignEvidenceArtifacts);
    expect(releaseFull?.campaignEvidenceArtifacts.every((path) => path.startsWith('<campaign-root>'))).toBe(true);
    expect(releaseFull?.campaignEvidenceArtifacts).toContain(
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
    );
    expect(releaseFull?.campaignEvidenceArtifacts).not.toContain(
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<visual-scenario-id>/review.md',
    );
    expect(releaseFull?.campaignEvidenceArtifacts).not.toEqual(
      expect.arrayContaining([
        'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
        'artifacts/backend-real-visual/<run-id>/review.md',
        'artifacts/backend-real-visual/<run-id>/ux-traces',
      ]),
    );
  });

  it('keeps generated gate contracts in sync with the repository state', () => {
    expect(() => execSync('npm run contracts:check-current-gates', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8',
    })).not.toThrow();
  });

  it('keeps the release contract checker aligned with campaign launcher and aggregate verifier roles', () => {
    const checker = readFileSync('scripts/contracts/check-current-gates.ts', 'utf8');

    expect(checker).toContain('npm run release:campaign:full');
    expect(checker).toMatch(/aggregate-only terminal verifier/);
    expect(checker).not.toContain('release checklist must define npm run gate:release:full as the full release command');
  });
});
