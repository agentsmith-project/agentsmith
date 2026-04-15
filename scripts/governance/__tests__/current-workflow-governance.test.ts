import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_WORKFLOW_MANIFEST,
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
  listCurrentWorkflowCommands,
  listRecommendedCurrentWorkflowSections,
} from '../current-workflow-manifest';
import { GOVERNANCE_CHECK_DEFINITIONS } from '../check-definitions';
import { findCurrentGateDefinition, findCurrentGateDefinitionById } from '../current-gate-manifest';

describe('current workflow governance', () => {
  it('keeps the expected top-level workflow terms and section order', () => {
    expect(CURRENT_WORKFLOW_TOP_LEVEL_TERMS).toEqual([
      '环境',
      '测试',
      '门禁',
      '验证通道',
      '发布',
    ]);
    expect(CURRENT_WORKFLOW_MANIFEST.map((section) => section.title)).toEqual(CURRENT_WORKFLOW_TOP_LEVEL_TERMS);
  });

  it('keeps current workflow commands structurally complete', () => {
    const commands = listCurrentWorkflowCommands();
    const recommendedSections = listRecommendedCurrentWorkflowSections();
    expect(commands.length).toBeGreaterThan(0);
    expect(recommendedSections.length).toBe(CURRENT_WORKFLOW_TOP_LEVEL_TERMS.length);

    for (const section of recommendedSections) {
      expect(section.commands.length).toBeGreaterThan(0);
    }

    for (const command of commands) {
      expect(command.command.length).toBeGreaterThan(0);
      expect(command.description.length).toBeGreaterThan(0);
      expect(['none', 'required']).toContain(command.storyEvidencePolicy);
      expect(Array.isArray(command.storyEvidenceKinds)).toBe(true);
      expect(Array.isArray(command.storyEvidenceArtifacts)).toBe(true);
      expect(Array.isArray(command.storyEvidenceRequiredFor)).toBe(true);

      if (command.gateId) {
        const gate = findCurrentGateDefinitionById(command.gateId);
        expect(gate).toBeDefined();
        expect(gate?.executionTargets.length).toBeGreaterThan(0);
        if (command.npmScript) {
          expect(gate?.npmScript).toBe(command.npmScript);
        }
      }

      if (command.canonical === 'npm') {
        expect(command.npmScript).toBeTruthy();
      }

      if (command.recommended) {
        if (command.canonical === 'make') {
          expect(command.makeTarget).toBeTruthy();
        } else {
          expect(command.npmScript).toBeTruthy();
        }
      }
    }
  });

  it('marks story-evidence-bearing workflow commands explicitly', () => {
    const commands = listCurrentWorkflowCommands();
    const visualTest = commands.find((command) => command.npmScript === 'test:visual');
    const backendRealCoreTest = commands.find((command) => command.npmScript === 'test:backend-real:core');
    const releaseGate = commands.find((command) => command.npmScript === 'gate:release');
    const visualLane = commands.find((command) => command.npmScript === 'lane:visual');
    const backendRealCoreLane = commands.find((command) => command.npmScript === 'lane:backend-real:core');
    const releaseLane = commands.find((command) => command.npmScript === 'lane:backend-real:release');

    expect(visualTest?.storyEvidencePolicy).toBe('required');
    expect(visualTest?.storyEvidenceKinds).toEqual(['visual_scene_catalog']);
    expect(visualTest?.storyEvidenceRequiredFor).toEqual(['visual', 'release']);

    expect(visualLane?.storyEvidencePolicy).toBe('required');
    expect(visualLane?.storyEvidenceKinds).toEqual(['visual_scene_catalog']);
    expect(visualLane?.storyEvidenceRequiredFor).toEqual(['visual', 'release']);

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
    expect(releaseLane?.storyEvidenceRequiredFor).toEqual(['release']);
  });

  it('derives workflow story-evidence ownership from current gate truth', () => {
    const commands = listCurrentWorkflowCommands().filter((command) => command.npmScript);

    for (const command of commands) {
      const gate = command.gateId
        ? findCurrentGateDefinitionById(command.gateId)
        : findCurrentGateDefinition(command.npmScript!);
      if (!gate) {
        continue;
      }

      expect(command.storyEvidencePolicy).toBe(gate.storyEvidencePolicy);
      expect(command.storyEvidenceKinds).toEqual(gate.storyEvidenceKinds);
      expect(command.storyEvidenceArtifacts).toEqual(gate.storyEvidenceArtifacts);
      expect(command.storyEvidenceRequiredFor).toEqual(gate.storyEvidenceRequiredFor);
    }
  });

  it('keeps workflow gate bindings anchored to structured adapters, not free-form command text', () => {
    const workflowCommands = listCurrentWorkflowCommands().filter((command) => command.gateId && command.npmScript);

    for (const command of workflowCommands) {
      const gate = findCurrentGateDefinitionById(command.gateId!);

      expect(gate).toBeDefined();
      expect(gate?.npmScript).toBe(command.npmScript);
      expect(gate?.executionTargets.length).toBeGreaterThan(0);
    }
  });

  it('keeps governance check definitions complete and uniquely keyed', () => {
    expect(GOVERNANCE_CHECK_DEFINITIONS.length).toBeGreaterThan(0);

    const ids = new Set<string>();
    for (const definition of GOVERNANCE_CHECK_DEFINITIONS) {
      expect(definition.id.length).toBeGreaterThan(0);
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.category.length).toBeGreaterThan(0);
      expect(definition.command.length).toBeGreaterThan(0);
      expect(definition.timeout).toBeGreaterThan(0);
      expect(['static', 'e2e', 'backend-real']).toContain(definition.evidenceType);
      expect(ids.has(definition.id)).toBe(false);
      ids.add(definition.id);
    }
  });

  it('keeps generated workflow docs in sync with the repository state', () => {
    expect(() => execSync('npm run current-workflow:check', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8',
    })).not.toThrow();
  });
});
