import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
  CURRENT_CI_WORKFLOW_MANIFEST,
  CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS,
  CURRENT_WORKFLOW_DOCUMENT_FILES,
  CURRENT_WORKFLOW_ENTRY_PATHS,
  CURRENT_WORKFLOW_GLOSSARY,
  CURRENT_WORKFLOW_MANIFEST,
  CURRENT_WORKFLOW_ROLES,
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
  listCurrentCIWorkflowJobs,
  listCurrentWorkflowCommands,
  listQuickHumanCurrentWorkflowSections,
  listRecommendedCurrentWorkflowCommands,
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

function extractGeneratedBlock(relativePath: string, startMarker: string, endMarker: string): string {
  const content = readRepoFile(relativePath);
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`${relativePath} is missing generated block markers: ${startMarker}`);
  }

  return content.slice(startIndex + startMarker.length, endIndex);
}

const QUICK_HUMAN_ENTRYPOINT_COMMANDS = [
  'npm run dev',
  'make local-real-up',
  'make local-real-status',
  'npm run verify',
  'npm run release:ready',
  'npm run release:status',
] as const;

const QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS = [
  /\bnpm run verify:[a-z0-9:_-]+/,
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bmake gate-[a-z0-9_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bmake lane-[a-z0-9_-]+/,
  /\bnpm run release:aggregate\b/,
  /\bnpm run release:campaign:full\b/,
  /\bnpm run gate:release:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT\b/,
  /\bnpm run rehearse:[a-z0-9:_-]+/,
  /\bmake demo-rehearsal-[a-z0-9_-]+/,
  /\bmake cluster-rehearsal-[a-z0-9_-]+/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bmake backend-real-[a-z0-9_-]+/,
] as const;

function extractMarkdownBashCommands(block: string): string[] {
  const commands: string[] = [];
  let inBashFence = false;

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '```bash') {
      inBashFence = true;
      continue;
    }
    if (trimmed === '```') {
      inBashFence = false;
      continue;
    }
    if (inBashFence && trimmed.length > 0) {
      commands.push(trimmed);
    }
  }

  return commands;
}

function extractMakeQuickHelpCommands(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.match(/^\s*@echo "  ((?:npm run|make) [^"]+)"$/)?.[1])
    .filter((command): command is string => Boolean(command));
}

function readTrackedWorkflowFiles(): string[] {
  const stdout = execSync('git ls-files .github/workflows/*.yml', {
    cwd: rootDir,
    encoding: 'utf8',
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseWorkflow(relativePath: string): Record<string, unknown> {
  return asRecord(YAML.parse(readRepoFile(relativePath)) as unknown);
}

function collectWorkflowTriggers(parsedWorkflow: Record<string, unknown>): string[] {
  const rawOn = parsedWorkflow.on ?? parsedWorkflow.true;
  if (typeof rawOn === 'string') {
    return [rawOn];
  }
  if (Array.isArray(rawOn)) {
    return asStringArray(rawOn).sort();
  }
  return Object.keys(asRecord(rawOn)).sort();
}

function collectWorkflowJobIds(parsedWorkflow: Record<string, unknown>): string[] {
  return Object.keys(asRecord(parsedWorkflow.jobs)).sort();
}

function collectJobRunCommands(parsedWorkflow: Record<string, unknown>, jobId: string): string {
  const job = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  const steps = Array.isArray(job.steps) ? job.steps : [];

  return steps
    .map((step) => asRecord(step).run)
    .filter((run): run is string => typeof run === 'string')
    .join('\n');
}

function collectJobArtifactPaths(parsedWorkflow: Record<string, unknown>, jobId: string): string[] {
  const job = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const paths: string[] = [];

  for (const step of steps) {
    const stepRecord = asRecord(step);
    if (stepRecord.uses !== 'actions/upload-artifact@v4') {
      continue;
    }

    const withRecord = asRecord(stepRecord.with);
    if (typeof withRecord.path !== 'string') {
      continue;
    }

    paths.push(
      ...withRecord.path
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }

  return paths.sort();
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
    const recommendedCommands = listRecommendedCurrentWorkflowCommands();
    const quickHumanSections = listQuickHumanCurrentWorkflowSections();
    const recommendedCommandNames = recommendedCommands.map((command) => command.command);
    const quickHumanCommandNames = quickHumanSections.flatMap((section) => section.commands.map((command) => command.command));
    expect(commands.length).toBeGreaterThan(0);
    expect(quickHumanSections.map((section) => section.id)).toEqual(['environment', 'test', 'release']);
    expect(quickHumanCommandNames).toEqual([...QUICK_HUMAN_ENTRYPOINT_COMMANDS]);
    expect(recommendedSections.map((section) => section.title)).toEqual(CURRENT_WORKFLOW_TOP_LEVEL_TERMS);
    expect(recommendedCommandNames).toEqual(expect.arrayContaining([...QUICK_HUMAN_ENTRYPOINT_COMMANDS]));
    expect(recommendedCommandNames).toEqual(expect.arrayContaining([
      'npm run gate:fast',
      'npm run gate:default',
      'npm run gate:release',
      'npm run lane:mock',
      'npm run lane:visual',
      'npm run lane:backend-real:release',
      'npm run lane:demo-rehearsal',
      'npm run lane:cluster-rehearsal',
    ]));
    expect(recommendedCommands.length).toBeGreaterThan(quickHumanCommandNames.length);

    for (const section of quickHumanSections) {
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

      if (command.quickHuman) {
        expect(command.recommended).toBe(true);
        expect(command.gateId).toBeUndefined();
      }
    }

    for (const command of recommendedCommands) {
      if (!command.quickHuman) {
        expect(quickHumanCommandNames).not.toContain(command.command);
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
    const releaseReady = commands.find((command) => command.npmScript === 'release:ready');
    const releaseStatus = commands.find((command) => command.npmScript === 'release:status');
    const releaseAggregate = commands.find((command) => command.npmScript === 'release:aggregate');
    const releaseCampaign = commands.find((command) => command.npmScript === 'release:campaign:full');
    const fullReleaseGate = commands.find((command) => command.npmScript === 'gate:release:full');
    const releaseGate = commands.find((command) => command.npmScript === 'gate:release');
    const demoRehearsalLane = commands.find((command) => command.npmScript === 'lane:demo-rehearsal');
    const clusterRehearsalLane = commands.find((command) => command.npmScript === 'lane:cluster-rehearsal');

    expect(releaseEntry?.startCommands).toContain('npm run release:ready');
    expect(releaseEntry?.startCommands).toContain('npm run release:status');
    expect(releaseEntry?.startCommands).not.toContain('npm run release:aggregate -- --campaign-root=<campaign-root>');
    expect(releaseEntry?.startCommands).not.toContain('npm run rehearse:demo');
    expect(releaseEntry?.startCommands).not.toContain('npm run rehearse:cluster');
    expect(releaseEntry?.startCommands).not.toContain('npm run gate:release:full');

    expect(releaseReady?.workflowRole).toBe('release_operation');
    expect(releaseReady?.recommended).toBe(true);
    expect(releaseReady?.gateId).toBeUndefined();
    expect(releaseStatus?.workflowRole).toBe('release_operation');
    expect(releaseStatus?.description).toMatch(/read-only/i);
    expect(releaseStatus?.description).not.toMatch(/verdict|re-aggregat|aggregate/i);
    expect(releaseAggregate?.workflowRole).toBe('release_operation');
    expect(releaseAggregate?.gateId).toBeUndefined();
    expect(releaseCampaign?.workflowRole).toBe('release_operation');
    expect(releaseCampaign?.recommended).not.toBe(true);
    expect(fullReleaseGate?.workflowRole).toBe('terminal_gate_verdict');
    expect(fullReleaseGate?.command).toBe('RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full');
    expect(fullReleaseGate?.recommended).not.toBe(true);
    expect(releaseGate?.workflowRole).toBe('gate_verdict');
    expect(demoRehearsalLane?.workflowRole).toBe('evidence_lane');
    expect(clusterRehearsalLane?.workflowRole).toBe('evidence_lane');
  });

  it('keeps hidden release launchers out of generated human workflow blocks', () => {
    const packageScripts = readPackageScripts();
    const hiddenCommand = 'npm run release:campaign:full';
    const generatedBlocks = [
      extractGeneratedBlock(
        'README.md',
        '<!-- current-workflow:readme:start -->',
        '<!-- current-workflow:readme:end -->',
      ),
      extractGeneratedBlock(
        'DEVELOPMENT.md',
        '<!-- current-workflow:development:start -->',
        '<!-- current-workflow:development:end -->',
      ),
      extractGeneratedBlock(
        'docs/current-engineering-governance-model.md',
        '<!-- current-workflow:governance-model:start -->',
        '<!-- current-workflow:governance-model:end -->',
      ),
      extractGeneratedBlock(
        'Makefile',
        '# current-workflow:help-extended:start',
        '# current-workflow:help-extended:end',
      ),
      extractGeneratedBlock(
        'Makefile',
        '# current-workflow:quick-help:start',
        '# current-workflow:quick-help:end',
      ),
    ];

    expect(packageScripts.has('release:campaign:full')).toBe(true);
    for (const block of generatedBlocks) {
      expect(block, 'generated human-copyable workflow blocks must hide the internal campaign launcher').not.toContain(hiddenCommand);
    }
  });

  it('keeps generated quick workflow blocks limited to the quick human entrypoints', () => {
    const quickBlocks = [
      {
        label: 'README current workflow block',
        block: extractGeneratedBlock(
          'README.md',
          '<!-- current-workflow:readme:start -->',
          '<!-- current-workflow:readme:end -->',
        ),
        commands: extractMarkdownBashCommands,
      },
      {
        label: 'DEVELOPMENT current workflow block',
        block: extractGeneratedBlock(
          'DEVELOPMENT.md',
          '<!-- current-workflow:development:start -->',
          '<!-- current-workflow:development:end -->',
        ),
        commands: extractMarkdownBashCommands,
      },
      {
        label: 'Makefile quick-help block',
        block: extractGeneratedBlock(
          'Makefile',
          '# current-workflow:quick-help:start',
          '# current-workflow:quick-help:end',
        ),
        commands: extractMakeQuickHelpCommands,
      },
    ];

    for (const { label, block, commands } of quickBlocks) {
      expect(commands(block), label).toEqual([...QUICK_HUMAN_ENTRYPOINT_COMMANDS]);

      for (const pattern of QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS) {
        expect(block, `${label} must not expose ${pattern}`).not.toMatch(pattern);
      }

      expect(block, `${label} must describe release:status as read-only`).toMatch(/release:status[\s\S]*read-only/i);
      expect(block, `${label} must not describe release:status as a verdict producer`).not.toMatch(
        /release:status[\s\S]{0,120}(?:verdict|re-aggregat|aggregate)/i,
      );
    }
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
        'npm run release:ready',
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
    expect(combinedDocs).toMatch(/release:status/);
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
      '.github/workflows/engineering-gate.yml',
      '.github/workflows/integration-e2e.yml',
    ]),
    );
  });

  it('exposes local-real as a local-manual adapter without adding a runtime-line identity', () => {
    const makefile = readRepoFile('Makefile');
    const runtimeManifest = readRepoFile('scripts/governance/current-runtime-line-manifest.ts');
    const localManualEntry = CURRENT_WORKFLOW_ENTRY_PATHS.find((entry) => entry.id === 'local_manual');
    const commands = listCurrentWorkflowCommands();

    expect(localManualEntry?.startCommands).toContain('make local-real-up');
    expect(localManualEntry?.startCommands).toContain('make local-real-status');

    for (const target of ['local-real-up', 'local-real-status', 'local-real-down', 'local-real-reset']) {
      expect(makefile).toMatch(new RegExp(`^${target}:`, 'm'));
      expect(commands.find((command) => command.makeTarget === target)?.gateId).toBeUndefined();
    }

    expect(makefile).toMatch(/local-real-up:[\s\S]*\$\(MAKE\) substrate-up[\s\S]*\$\(MAKE\) substrate-reseed[\s\S]*\$\(MAKE\) local-manual-up/);
    expect(makefile).toMatch(/local-real-status:[\s\S]*\$\(MAKE\) substrate-status[\s\S]*\$\(MAKE\) local-manual-status/);
    expect(runtimeManifest).not.toMatch(/id:\s*'local-real'/);
    expect(runtimeManifest).not.toMatch(/formalName:\s*'local-real'/);
  });

  it('keeps verify aliases as adapters instead of new gate identities', () => {
    const commands = listCurrentWorkflowCommands();
    const verifyScripts = [
      'verify',
      'verify:quick',
      'verify:default',
      'verify:visual',
      'verify:real',
      'verify:release-real',
    ];

    for (const script of verifyScripts) {
      const command = commands.find((candidate) => candidate.npmScript === script);
      expect(command, `${script} must be discoverable in the workflow manifest`).toBeDefined();
      expect(command?.gateId, `${script} must not create or impersonate a gate id`).toBeUndefined();
    }
  });

  it('keeps diagnostic next steps on the human release:ready path', () => {
    const releaseDiagnostics = CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.filter(
      (command) => command.id.startsWith('release-'),
    );

    expect(releaseDiagnostics.length).toBeGreaterThan(0);
    for (const command of releaseDiagnostics) {
      expect(command.nextStep).toContain('npm run release:ready');
      expect(command.nextStep).not.toContain('npm run release:campaign:full');
    }
  });

  it('ignores local evidence artifact roots without ignoring source docs', () => {
    const gitignore = readRepoFile('.gitignore');

    for (const artifactRoot of [
      'artifacts/release-runs/',
      'artifacts/verification/',
      'artifacts/gate-results/',
      'artifacts/visual-baseline-reviews/',
      'artifacts/ux-traces/',
      'artifacts/uxui-reviews/',
      'artifacts/local-runtime/',
      'artifacts/tmp-release-proxy/',
    ]) {
      expect(gitignore).toMatch(new RegExp(`^${artifactRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
    }

    expect(gitignore).not.toMatch(/^docs\/engineering\//m);
    expect(gitignore).not.toMatch(/^docs\/testing\//m);
    expect(gitignore).not.toMatch(/^docs\/user-guides\//m);
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

  it('routes active CI workflow truth through the current workflow contract checker', () => {
    const checker = readRepoFile('scripts/contracts/check-current-workflows.ts');

    expect(checker).toContain('CURRENT_CI_WORKFLOW_MANIFEST');
    expect(checker).toContain(".github/workflows/*.yml");
    expect(checker).toContain('collectJobArtifactPaths');
    expect(checker).toContain('lane:backend-real:core');
  });

  it('keeps every active GitHub workflow declared in the CI workflow manifest', () => {
    expect(CURRENT_CI_WORKFLOW_MANIFEST.map((workflow) => workflow.path).sort()).toEqual(
      readTrackedWorkflowFiles(),
    );
    expect(CURRENT_CI_WORKFLOW_MANIFEST.map((workflow) => workflow.path).sort()).toEqual([
      '.github/workflows/contracts-check.yml',
      '.github/workflows/engineering-gate.yml',
      '.github/workflows/integration-e2e.yml',
      '.github/workflows/quality-gates.yml',
    ]);
  });

  it('keeps CI workflow manifest jobs aligned with GitHub workflow YAML jobs and triggers', () => {
    for (const workflow of CURRENT_CI_WORKFLOW_MANIFEST) {
      const parsedWorkflow = parseWorkflow(workflow.path);

      expect(workflow.workflowName).toBe(parsedWorkflow.name);
      expect([...workflow.triggers].sort()).toEqual(collectWorkflowTriggers(parsedWorkflow));
      expect(workflow.jobs.map((job) => job.id).sort()).toEqual(collectWorkflowJobIds(parsedWorkflow));
      expect(workflow.role.length).toBeGreaterThan(0);

      for (const job of workflow.jobs) {
        expect(job.workflowPath).toBe(workflow.path);
        expect(job.workflowName).toBe(workflow.workflowName);
        expect([...job.triggers].sort()).toEqual([...workflow.triggers].sort());
        expect(job.role.length).toBeGreaterThan(0);
        expect(job.blockingFor).toEqual(expect.arrayContaining(job.blockingFor));
        expect([...job.artifactPaths].sort()).toEqual(collectJobArtifactPaths(parsedWorkflow, job.id));
      }
    }
  });

  it('makes backend-real scheduled regression a real evidence-producing lane instead of a governance-only alias', () => {
    const engineeringWorkflow = CURRENT_CI_WORKFLOW_MANIFEST.find(
      (workflow) => workflow.path === '.github/workflows/engineering-gate.yml',
    );
    const engineeringJob = engineeringWorkflow?.jobs.find((job) => job.id === 'engineering-gate');
    const workflowSource = readRepoFile('.github/workflows/engineering-gate.yml');
    const parsedWorkflow = parseWorkflow('.github/workflows/engineering-gate.yml');
    const runCommands = collectJobRunCommands(parsedWorkflow, 'engineering-gate');

    expect(engineeringWorkflow?.role).toBe('backend_real_regression');
    expect(engineeringWorkflow?.scheduled).toBe(true);
    expect(engineeringJob?.laneId).toBe('lane-backend-real-core');
    expect(engineeringJob?.requiresSecrets).toBe(true);
    expect(engineeringJob?.requiredSecrets).toContain('BACKEND_REAL_API_KEY');
    expect(engineeringJob?.evidenceRequired).toBe(true);
    expect(engineeringJob?.artifactPaths).toEqual(
      expect.arrayContaining([
        'artifacts/backend-real/runs/**',
        'artifacts/mock-lane/runs/**',
        'test-results/**',
        'playwright-report/**',
      ]),
    );
    expect(workflowSource).toContain('Daily UTC off-peak run for backend-real engineering regression.');
    expect(runCommands).toContain('npm run lane:backend-real:core');
    expect(runCommands).not.toContain('make verify-governance');
  });

  it('publishes run-scoped mock-lane evidence from CI jobs that execute mock or visual lanes', () => {
    const jobs = listCurrentCIWorkflowJobs();
    const mockEvidenceOwners = jobs.filter((job) => job.evidenceFamilies.includes('mock_lane_run'));

    expect(mockEvidenceOwners.map((job) => `${job.workflowPath}:${job.id}`).sort()).toEqual([
      '.github/workflows/contracts-check.yml:contracts',
      '.github/workflows/engineering-gate.yml:engineering-gate',
      '.github/workflows/quality-gates.yml:gate-default',
      '.github/workflows/quality-gates.yml:gate-fast',
      '.github/workflows/quality-gates.yml:lane-backend-real-core',
      '.github/workflows/quality-gates.yml:lane-visual',
    ]);

    for (const job of mockEvidenceOwners) {
      expect(job.artifactPaths).toContain('artifacts/mock-lane/runs/**');
    }
  });
});
