import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS,
  CURRENT_WORKFLOW_DOCUMENT_FILES,
  CURRENT_WORKFLOW_ENTRY_PATHS,
  CURRENT_WORKFLOW_GLOSSARY,
  CURRENT_WORKFLOW_MANIFEST,
  CURRENT_WORKFLOW_ROLES,
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
  listCurrentWorkflowCommands,
  listRecommendedCurrentWorkflowSections,
} from '../current-workflow-manifest';
import { GOVERNANCE_CHECK_DEFINITIONS } from '../check-definitions';
import { findCurrentGateDefinition, findCurrentGateDefinitionById } from '../current-gate-manifest';

const rootDir = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readPackageScripts(): Set<string> {
  const packageJson = JSON.parse(readRepoFile('package.json')) as { scripts?: Record<string, string> };
  return new Set(Object.keys(packageJson.scripts ?? {}));
}

function extractNpmRunScripts(content: string): string[] {
  return [...content.matchAll(/\bnpm run ([a-z0-9:_-]+)/g)].map((match) => match[1]);
}

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

  it('models entry paths, glossary terms, and diagnostic commands as machine-readable workflow truth', () => {
    expect(CURRENT_WORKFLOW_ROLES).toEqual([
      'environment_setup',
      'diagnostic',
      'diagnostic_lane',
      'evidence_lane',
      'gate_verdict',
      'terminal_gate_verdict',
      'release_operation',
    ]);

    expect(CURRENT_WORKFLOW_ENTRY_PATHS.map((entry) => entry.id)).toEqual([
      'ui_only',
      'local_manual',
      'release_grade',
    ]);

    for (const entry of CURRENT_WORKFLOW_ENTRY_PATHS) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.whenToUse.length).toBeGreaterThan(0);
      expect(entry.startCommands.length).toBeGreaterThan(0);
      expect(entry.docs.length).toBeGreaterThan(0);
    }

    expect(CURRENT_WORKFLOW_GLOSSARY.map((item) => item.term)).toEqual([
      'e2e',
      'lane',
      'gate',
      'campaign',
      'diagnostic',
      'verdict',
    ]);

    for (const item of CURRENT_WORKFLOW_GLOSSARY) {
      expect(item.plainLanguage.length).toBeGreaterThan(0);
      expect(item.currentMeaning.length).toBeGreaterThan(0);
      expect(item.doNotConfuseWith.length).toBeGreaterThan(0);
    }

    expect(CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.length).toBeGreaterThanOrEqual(8);
    expect(CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.map((command) => command.command)).toEqual([
      'npm run test:e2e',
      'npm run test:e2e:all',
      'npm run test:integration',
      'npm run test:run',
      'npm run contracts:check-openapi',
      'npm run openapi:check-generated',
      'npm run ws:typecheck',
      'npm run ws:test',
      'npm run test:release:precheck',
      'npm run lane:mock',
      'npm run gate:release',
      'npm run lane:demo-rehearsal',
      'npm run lane:cluster-rehearsal',
      'RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full',
    ]);
  });

  it('models release-grade entry through the campaign launcher instead of the aggregate-only gate', () => {
    const releaseEntry = CURRENT_WORKFLOW_ENTRY_PATHS.find((entry) => entry.id === 'release_grade');
    const commands = listCurrentWorkflowCommands();
    const releaseCampaign = commands.find((command) => command.npmScript === 'release:campaign:full');
    const fullReleaseGate = commands.find((command) => command.npmScript === 'gate:release:full');
    const releaseGate = commands.find((command) => command.npmScript === 'gate:release');
    const demoRehearsalLane = commands.find((command) => command.npmScript === 'lane:demo-rehearsal');
    const clusterRehearsalLane = commands.find((command) => command.npmScript === 'lane:cluster-rehearsal');

    expect(releaseEntry?.startCommands).toContain('npm run release:campaign:full');
    expect(releaseEntry?.startCommands).not.toContain('npm run gate:release:full');

    expect(releaseCampaign?.workflowRole).toBe('release_operation');
    expect(releaseCampaign?.recommended).toBe(true);
    expect(fullReleaseGate?.workflowRole).toBe('terminal_gate_verdict');
    expect(fullReleaseGate?.command).toBe('RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full');
    expect(fullReleaseGate?.recommended).not.toBe(true);
    expect(releaseGate?.workflowRole).toBe('gate_verdict');
    expect(demoRehearsalLane?.workflowRole).toBe('evidence_lane');
    expect(clusterRehearsalLane?.workflowRole).toBe('evidence_lane');
  });

  it('marks workflow commands with stable roles and keeps lane:mock as a diagnostic lane surface', () => {
    const commands = listCurrentWorkflowCommands();
    const mockLane = commands.find((command) => command.npmScript === 'lane:mock');
    const visualLane = commands.find((command) => command.npmScript === 'lane:visual');
    const fastGate = commands.find((command) => command.npmScript === 'gate:fast');
    const fullReleaseGate = commands.find((command) => command.npmScript === 'gate:release:full');
    const backendRealRun = commands.find((command) => command.npmScript === 'backend-real:run');

    expect(mockLane?.workflowRole).toBe('diagnostic_lane');
    expect(mockLane?.gateId).toBe('lane-mock');
    expect(visualLane?.workflowRole).toBe('evidence_lane');
    expect(fastGate?.workflowRole).toBe('gate_verdict');
    expect(fullReleaseGate?.workflowRole).toBe('terminal_gate_verdict');
    expect(backendRealRun?.workflowRole).toBe('release_operation');
  });

  it('keeps release docs and CI aligned with the campaign-first model', () => {
    const docs = [
      'README.md',
      'DEVELOPMENT.md',
      'docs/testing/diagnostic-catalog-v1.md',
      'docs/testing/verification-campaigns-v1.md',
      'docs/user-guides/release-readiness-checklist.md',
      'docs/current-engineering-governance-model.md',
    ];
    const combinedDocs = docs.map(readRepoFile).join('\n');
    const workflow = readRepoFile('.github/workflows/quality-gates.yml');
    const packageScripts = readPackageScripts();

    for (const doc of docs) {
      expect(readRepoFile(doc), `${doc} must mention the release campaign launcher`).toContain(
        'npm run release:campaign:full',
      );
    }

    for (const surface of ['docs/current-engineering-governance-model.md', 'Makefile']) {
      const content = readRepoFile(surface);
      expect(content, `${surface} must show gate:release:full with explicit campaign context`).toContain(
        'RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full',
      );
      expect(content, `${surface} must not offer bare gate:release:full as a copyable entrypoint`).not.toMatch(
        /(?:^|\n)(?:\s*@echo "\s*)?npm run gate:release:full(?:\s*(?:#|"))/m,
      );
    }

    expect(combinedDocs).not.toMatch(/test:backend-real:full/);
    expect(combinedDocs).not.toMatch(/future .*one-shot campaign launcher|未来提供 one-shot campaign launcher/i);
    expect(combinedDocs).toMatch(/aggregate-only|聚合专用|explicit campaign|显式 campaign/);
    expect(combinedDocs).toMatch(/gate:release/);
    expect(combinedDocs).toMatch(/lane:demo-rehearsal/);
    expect(combinedDocs).toMatch(/lane:cluster-rehearsal/);

    expect(workflow).toContain('lane-visual-artifacts');
    expect(workflow).not.toContain('visual-manual-artifacts');
    expect(workflow).toContain('artifacts/backend-real/runs/**');
    expect(workflow).not.toContain('artifacts/backend-real/current/**');

    for (const script of extractNpmRunScripts(combinedDocs)) {
      expect(packageScripts.has(script), `documented npm script must exist: ${script}`).toBe(true);
    }
  });

  it('tracks the docs and CI surfaces that explain the current workflow model', () => {
    expect(CURRENT_WORKFLOW_DOCUMENT_FILES).toEqual(
      expect.arrayContaining([
        'docs/testing/README.md',
        'docs/testing/diagnostic-catalog-v1.md',
        'docs/testing/story-source-of-truth-and-generated-specs.md',
        'docs/contracts/current-gate-result-schema-contract.md',
      ]),
    );
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
