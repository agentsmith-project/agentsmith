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
  listCurrentGovernanceSurfaceInventory,
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
  return [...content.matchAll(/\bnpm run ([a-z0-9][a-z0-9:_-]*[a-z0-9_-])(?=[\s`.,;)]|$)/g)].map((match) => match[1]);
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

const HUMAN_ENTRYPOINT_COMMANDS = [
  'npm run dev',
  'make local-real-up',
  'make local-real-status',
  'make local-real-down',
  'make local-real-reset',
  'npm run verify',
  'npm run release:ready',
  'npm run release:status',
] as const;
const DEPLOY_TEMPLATE_PACKAGE_INTERNAL_COMMAND =
  'npm run release:deploy-template-package -- --package-uri <remote-artifact-uri> --git-sha <git-sha> --source-git-sha <source-git-sha> --output-dir <artifact-dir> --ci-workflow-name <workflow-name> --ci-run-id <ci-run-id> --ci-run-attempt <ci-run-attempt> --ci-job <ci-job> --generated-at <generated-at-iso> --generator-command <generator-command> --generator-version <generator-version> --attestation none';
const RELEASE_CONTRACT_CI_ARTIFACT_INTERNAL_COMMAND =
  'npm run release:contract:ci-artifact -- --input <release-contract-input.json> --output-dir <artifact-dir>';
const RUNNER_CONTRACT_BUILD_COMMAND = 'npm run build -w @mbos/agent-runner-contract';

const QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS = [
  /\bnpm run verify:[a-z0-9:_-]+/,
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bmake gate-[a-z0-9_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bmake lane-[a-z0-9_-]+/,
  /\bnpm run release:aggregate\b/,
  /\bnpm run release:contract:ci-artifact\b/,
  /\bnpm run release:deploy-template-package\b/,
  /\bnpm run release:campaign:full\b/,
  /\bnpm run gate:release:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT\b/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bmake backend-real-[a-z0-9_-]+/,
] as const;

const HUMAN_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS = [
  /\bnpm run verify:[a-z0-9:_-]+/,
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bmake gate-[a-z0-9_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bmake lane-[a-z0-9_-]+/,
  /\bnpm run release:aggregate\b/,
  /\bnpm run release:contract:ci-artifact\b/,
  /\bnpm run release:deploy-template-package\b/,
  /\bnpm run release:campaign:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bmake backend-real-[a-z0-9_-]+/,
] as const;

const RELEASE_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS = [
  /\bnpm run release:campaign:full\b/,
  /\bnpm run release:contract:ci-artifact\b/,
  /\bnpm run gate:[a-z0-9:_-]+\b/,
  /\bnpm run lane:[a-z0-9:_-]+\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
] as const;

const REMOVED_MAKE_COMPAT_TARGETS = [
  'gate-fast',
  'gate-default',
  'gate-release',
  'lane-mock',
  'lane-visual',
  'lane-real-core',
  'lane-real-release',
  'backend-real-reset',
  'backend-real-bootstrap',
  'backend-real-ready',
  'backend-real-run',
  'backend-real-report',
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

const WORKFLOW_SURFACE_DOCS = [
  'DEVELOPMENT.md',
  'docs/user-guides/release-readiness-checklist.md',
  'docs/testing/diagnostic-catalog-v1.md',
] as const;

const INTERNAL_WORKFLOW_REFERENCE_PATTERN =
  /`(?:npm run (?:(?:test|gate|lane|backend-real):[a-z0-9:_-]+|release:campaign:[a-z0-9:_-]+)|make (?:local-manual|substrate)-[a-z0-9_-]+|(?:gate|lane|backend-real|release:campaign):[a-z0-9:_-]+)`/g;

const INTERNAL_WORKFLOW_CONTEXT_PATTERN =
  /诊断命令|维护者排障|机器可读报告|diagnostic success|Diagnostic Commands|Maintainer Diagnostics|Focused Commands|Maintainer Troubleshooting|Machine-Readable Reports/i;

function lineNumberAtIndex(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function internalReferenceContext(content: string, lineNumber: number): string {
  const lines = content.split('\n');
  const lineIndex = lineNumber - 1;
  const currentHeading = [...lines]
    .slice(0, lineIndex + 1)
    .reverse()
    .find((line) => /^#{1,4}\s+/.test(line.trim())) ?? '';
  const surrounding = lines
    .slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 3))
    .join('\n');
  return `${currentHeading}\n${surrounding}`;
}

function readTrackedWorkflowFiles(): string[] {
  const trackedStdout = execSync('git ls-files .github/workflows/*.yml', {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const untrackedStdout = execSync('git ls-files --others --exclude-standard .github/workflows/*.yml', {
    cwd: rootDir,
    encoding: 'utf8',
  });

  return [...new Set(`${trackedStdout}\n${untrackedStdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean))]
    .sort();
}

function readTrackedScriptFiles(): string[] {
  const stdout = execSync('git ls-files scripts', {
    cwd: rootDir,
    encoding: 'utf8',
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.sh'))
    .sort();
}

function readMakeTargetBlock(content: string, target: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${target}:`));
  if (start === -1) return '';

  const next = lines.findIndex((line, index) => index > start && /^[A-Za-z0-9_.-]+:/.test(line));
  return lines.slice(start, next === -1 ? lines.length : next).join('\n');
}

function dependencyCallerKey(pathName: string, calls: readonly string[]): string {
  return `${pathName}:${calls.join('|')}`;
}

function collectDependencyCallerKeysFromSources(): string[] {
  const keys: string[] = [];
  const makefile = readRepoFile('Makefile');

  if (readMakeTargetBlock(makefile, 'deps-up').includes('integration:deps:up')) {
    keys.push(dependencyCallerKey('Makefile', ['integration:deps:up']));
  }
  if (readMakeTargetBlock(makefile, 'deps-ready').includes('scripts/integration-deps-ready.ts')) {
    keys.push(dependencyCallerKey('Makefile', ['scripts/integration-deps-ready.ts']));
  }
  if (/^deps-bootstrap:\s*deps-up\s+deps-ready/m.test(makefile)) {
    keys.push(dependencyCallerKey('Makefile', ['deps-up', 'deps-ready']));
  }

  for (const scriptPath of readTrackedScriptFiles()) {
    const content = readRepoFile(scriptPath);
    if (/\bnpm run integration:deps:up\b/.test(content)) {
      keys.push(dependencyCallerKey(scriptPath, ['integration:deps:up']));
    }
    if (/\bmake\s+deps-ready\b/.test(content)) {
      keys.push(dependencyCallerKey(scriptPath, ['make deps-ready']));
    }
    if (/\bmake\s+deps-bootstrap\b/.test(content)) {
      keys.push(dependencyCallerKey(scriptPath, ['make deps-bootstrap']));
    }
  }

  return keys.sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function collectWorkflowDispatchStringInputNames(parsedWorkflow: Record<string, unknown>): string[] {
  const rawOn = parsedWorkflow.on ?? parsedWorkflow.true;
  const workflowDispatch = asRecord(asRecord(rawOn).workflow_dispatch);
  const inputs = asRecord(workflowDispatch.inputs);

  return Object.entries(inputs)
    .filter(([, input]) => {
      const inputRecord = asRecord(input);
      const inputType = inputRecord.type;
      return inputType === undefined || inputType === 'string';
    })
    .map(([name]) => name)
    .sort();
}

function collectDirectWorkflowDispatchInputRunInterpolations(
  relativePath: string,
  parsedWorkflow: Record<string, unknown>,
): string[] {
  const inputNames = collectWorkflowDispatchStringInputNames(parsedWorkflow);
  if (inputNames.length === 0) {
    return [];
  }

  const failures: string[] = [];
  for (const [jobId, rawJob] of Object.entries(asRecord(parsedWorkflow.jobs))) {
    const job = asRecord(rawJob);
    const steps = Array.isArray(job.steps) ? job.steps : [];

    for (const [stepIndex, rawStep] of steps.entries()) {
      const run = asRecord(rawStep).run;
      if (typeof run !== 'string') {
        continue;
      }

      for (const inputName of inputNames) {
        const inputExpression = new RegExp(
          String.raw`\$\{\{[^}]*\b(?:inputs|github\.event\.inputs)\.${escapeRegExp(inputName)}\b[^}]*\}\}`,
        );
        if (inputExpression.test(run)) {
          failures.push(`${relativePath}:${jobId}:steps[${stepIndex}] interpolates ${inputName} directly in run`);
        }
      }
    }
  }

  return failures;
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
    if (stepRecord.uses !== 'actions/upload-artifact@v7') {
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
    expect(quickHumanCommandNames).toEqual([...HUMAN_ENTRYPOINT_COMMANDS]);
    expect(recommendedSections.map((section) => section.id)).toEqual(['environment', 'test', 'release']);
    expect(recommendedCommandNames).toEqual([...HUMAN_ENTRYPOINT_COMMANDS]);

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
        expect(command.quickHuman).toBe(true);
        expect(command.gateId).toBeUndefined();
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

    for (const command of commands) {
      if (/^(?:gate:|lane:|backend-real:|release:campaign:full|release:aggregate|release:contract:ci-artifact|release:deploy-template-package|verify:)/.test(command.npmScript ?? '')) {
        expect(command.recommended, `${command.command} must stay an internal adapter, not a human recommendation`).not.toBe(true);
        expect(command.quickHuman, `${command.command} must stay out of the quick human surface`).not.toBe(true);
        expect(command.makeTarget, `${command.command} must not keep a Make compatibility target`).toBeUndefined();
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

    const copyableDiagnosticCommands = CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.flatMap((diagnostic) => (
      diagnostic.command ? [diagnostic.command] : []
    ));
    const internalDiagnosticAdapters = CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.flatMap((diagnostic) => (
      diagnostic.internalAdapter ? [diagnostic.internalAdapter] : []
    ));

    expect(CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.length).toBeGreaterThanOrEqual(8);
    expect(copyableDiagnosticCommands).toEqual([
      'npm run test:e2e',
      'npm run test:e2e:all',
      'npm run test:integration',
      'npm run test:run',
      'npm run contracts:check-openapi',
      'npm run openapi:check-generated',
      'npm run ws:typecheck',
      'npm run ws:test',
      'npm run test:release:precheck',
    ]);
    expect(internalDiagnosticAdapters).toEqual([
      'lane:mock',
      'gate:release',
      'lane:unified-deploy:substrate',
      'lane:unified-deploy:local-kind:images',
      'lane:unified-deploy:local-kind',
      'lane:unified-deploy:product-flows',
      'gate:release:full',
    ]);

    for (const diagnostic of CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS) {
      if (diagnostic.command) {
        expect(diagnostic.command, `${diagnostic.id} must not expose internal adapters as copyable commands`).not.toMatch(
          /\b(?:npm run (?:gate|lane|backend-real):[a-z0-9:_-]+|RELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full)\b/,
        );
      } else {
        expect(diagnostic.internalAdapter, `${diagnostic.id} must identify the internal owner adapter`).toBeTruthy();
        expect(diagnostic.ownerSurface, `${diagnostic.id} must explain the owner surface`).toBeTruthy();
      }
    }
  });

  it('models product-side readiness entry through the campaign launcher instead of the aggregate-only gate', () => {
    const releaseEntry = CURRENT_WORKFLOW_ENTRY_PATHS.find((entry) => entry.id === 'release_grade');
    const commands = listCurrentWorkflowCommands();
    const releaseReady = commands.find((command) => command.npmScript === 'release:ready');
    const releaseStatus = commands.find((command) => command.npmScript === 'release:status');
    const releaseAggregate = commands.find((command) => command.npmScript === 'release:aggregate');
    const releaseDeployTemplatePackage = commands.find(
      (command) => command.npmScript === 'release:deploy-template-package',
    );
    const releaseContractCiArtifact = commands.find(
      (command) => command.npmScript === 'release:contract:ci-artifact',
    );
    const releaseCampaign = commands.find((command) => command.npmScript === 'release:campaign:full');
    const fullReleaseGate = commands.find((command) => command.npmScript === 'gate:release:full');
    const releaseGate = commands.find((command) => command.npmScript === 'gate:release');
    const unifiedDeployLanes = [
      'lane:unified-deploy:substrate',
      'lane:unified-deploy:local-kind:images',
      'lane:unified-deploy:local-kind',
      'lane:unified-deploy:product-flows',
    ].map((npmScript) => commands.find((command) => command.npmScript === npmScript));
    const unifiedDeployHumanChecks = [
      'test:unified-deploy:local-kind:images',
      'test:unified-deploy:local-kind',
      'test:unified-deploy:product-flows',
    ].map((npmScript) => commands.find((command) => command.npmScript === npmScript));

    expect(releaseEntry?.startCommands).toContain('npm run release:ready');
    expect(releaseEntry?.startCommands).toContain('npm run release:status');
    expect(releaseEntry?.startCommands).not.toContain('npm run test:unified-deploy:local-kind:images');
    expect(releaseEntry?.startCommands).not.toContain('npm run test:unified-deploy:local-kind');
    expect(releaseEntry?.startCommands).not.toContain('npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner');
    expect(releaseEntry?.startCommands).not.toContain('npm run release:aggregate -- --campaign-root=<campaign-root>');
    expect(releaseEntry?.startCommands).not.toContain(DEPLOY_TEMPLATE_PACKAGE_INTERNAL_COMMAND);
    expect(releaseEntry?.startCommands).not.toContain('npm run gate:release:full');

    expect(releaseReady?.workflowRole).toBe('release_operation');
    expect(releaseReady?.description).toMatch(/AgentSmith product readiness/i);
    expect(releaseReady?.description).not.toMatch(/deployment|package|operator|verdict/i);
    expect(releaseReady?.recommended).toBe(true);
    expect(releaseReady?.gateId).toBeUndefined();
    expect(releaseStatus?.workflowRole).toBe('release_operation');
    expect(releaseStatus?.description).toMatch(/read-only/i);
    expect(releaseStatus?.description).not.toMatch(/verdict|re-aggregat|aggregate/i);
    expect(releaseAggregate?.workflowRole).toBe('release_operation');
    expect(releaseAggregate?.gateId).toBeUndefined();
    expect(releaseDeployTemplatePackage?.workflowRole).toBe('release_operation');
    expect(releaseDeployTemplatePackage?.recommended).not.toBe(true);
    expect(releaseDeployTemplatePackage?.quickHuman).not.toBe(true);
    expect(releaseDeployTemplatePackage?.gateId).toBeUndefined();
    expect(releaseDeployTemplatePackage?.command).toBe(DEPLOY_TEMPLATE_PACKAGE_INTERNAL_COMMAND);
    expect(releaseDeployTemplatePackage?.description).toMatch(/internal artifact producer/i);
    expect(releaseContractCiArtifact?.workflowRole).toBe('release_operation');
    expect(releaseContractCiArtifact?.recommended).not.toBe(true);
    expect(releaseContractCiArtifact?.quickHuman).not.toBe(true);
    expect(releaseContractCiArtifact?.gateId).toBeUndefined();
    expect(releaseContractCiArtifact?.command).toBe(RELEASE_CONTRACT_CI_ARTIFACT_INTERNAL_COMMAND);
    expect(releaseContractCiArtifact?.description).toMatch(/internal artifact producer/i);
    expect(releaseContractCiArtifact?.description).not.toMatch(/readiness|deploy readiness/i);
    expect(releaseCampaign?.workflowRole).toBe('release_operation');
    expect(releaseCampaign?.recommended).not.toBe(true);
    expect(fullReleaseGate?.workflowRole).toBe('terminal_gate_verdict');
    expect(fullReleaseGate?.command).toBe('RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full');
    expect(fullReleaseGate?.description).toMatch(/AgentSmith product readiness campaign/i);
    expect(fullReleaseGate?.description).not.toMatch(/terminal release verdict|deployment|package|operator/i);
    expect(fullReleaseGate?.recommended).not.toBe(true);
    expect(releaseGate?.workflowRole).toBe('gate_verdict');
    expect(releaseGate?.description).toMatch(/backend-real product readiness/i);
    expect(unifiedDeployLanes.every((lane) => lane?.workflowRole === 'diagnostic_lane')).toBe(true);
    expect(unifiedDeployLanes.every((lane) => lane?.description.includes('transition-only unified deploy'))).toBe(true);
    expect(unifiedDeployLanes.every((lane) => lane?.description.includes('focused diagnostic'))).toBe(true);
    expect(unifiedDeployLanes.every((lane) => !/release evidence|evidence channel/i.test(lane?.description ?? ''))).toBe(true);
    expect(unifiedDeployHumanChecks.every((check) => check?.recommended !== true)).toBe(true);
    expect(unifiedDeployHumanChecks.every((check) => check?.quickHuman !== true)).toBe(true);
    expect(unifiedDeployHumanChecks.every((check) => check?.gateId === undefined)).toBe(true);
  });

  it('keeps internal adapters out of generated human workflow blocks', () => {
    const packageScripts = readPackageScripts();
    const generatedBlocks = [
      {
        label: 'README current workflow block',
        block: extractGeneratedBlock(
          'README.md',
          '<!-- current-workflow:readme:start -->',
          '<!-- current-workflow:readme:end -->',
        ),
      },
      {
        label: 'DEVELOPMENT current workflow block',
        block: extractGeneratedBlock(
          'DEVELOPMENT.md',
          '<!-- current-workflow:development:start -->',
          '<!-- current-workflow:development:end -->',
        ),
      },
      {
        label: 'current governance model workflow block',
        block: extractGeneratedBlock(
          'docs/current-engineering-governance-model.md',
          '<!-- current-workflow:governance-model:start -->',
          '<!-- current-workflow:governance-model:end -->',
        ),
      },
      {
        label: 'Makefile help-extended block',
        block: extractGeneratedBlock(
          'Makefile',
          '# current-workflow:help-extended:start',
          '# current-workflow:help-extended:end',
        ),
      },
      {
        label: 'Makefile quick-help block',
        block: extractGeneratedBlock(
          'Makefile',
          '# current-workflow:quick-help:start',
          '# current-workflow:quick-help:end',
        ),
      },
    ];

    expect(packageScripts.has('release:campaign:full')).toBe(true);
    expect(packageScripts.has('gate:default')).toBe(true);
    expect(packageScripts.has('lane:visual')).toBe(true);
    expect(packageScripts.has('backend-real:run')).toBe(true);
    for (const { label, block } of generatedBlocks) {
      for (const pattern of HUMAN_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS) {
        expect(block, `${label} must not expose internal adapter as a copyable human entrypoint: ${pattern}`).not.toMatch(pattern);
      }
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
      expect(commands(block), label).toEqual([...HUMAN_ENTRYPOINT_COMMANDS]);

      for (const pattern of QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS) {
        expect(block, `${label} must not expose ${pattern}`).not.toMatch(pattern);
      }

      expect(block, `${label} must describe release:status as read-only`).toMatch(/release:status[\s\S]*read-only/i);
      expect(block, `${label} must not describe release:status as a verdict producer`).not.toMatch(
        /release:status[\s\S]{0,120}(?:verdict|re-aggregat|aggregate)/i,
      );
    }
  });

  it('describes release:status as a frozen read-only projection in generated docs', () => {
    const generatedDocBlocks = [
      {
        label: 'README current workflow block',
        block: extractGeneratedBlock(
          'README.md',
          '<!-- current-workflow:readme:start -->',
          '<!-- current-workflow:readme:end -->',
        ),
      },
      {
        label: 'DEVELOPMENT current workflow block',
        block: extractGeneratedBlock(
          'DEVELOPMENT.md',
          '<!-- current-workflow:development:start -->',
          '<!-- current-workflow:development:end -->',
        ),
      },
    ];

    for (const { label, block } of generatedDocBlocks) {
      expect(block, `${label} must describe release:status as read-only`).toMatch(/release:status[\s\S]*read-only/i);
      expect(block, `${label} must describe release:status as frozen projection/snapshot output`).toMatch(
        /release:status[\s\S]*frozen[\s\S]*(?:projection|snapshot)/i,
      );
      expect(block, `${label} must not use the old latest-summary-only wording`).not.toMatch(
        /release:status[\s\S]*only reads the latest release summary/i,
      );
    }
  });

  it('renders make quick-help with public entrypoints only', () => {
    const output = execSync('make quick-help', {
      cwd: rootDir,
      encoding: 'utf8',
    });
    const commands = output
      .split('\n')
      .map((line) => line.match(/^  ((?:npm run|make) [^\s]+)$/)?.[1])
      .filter((command): command is string => Boolean(command));

    expect(commands).toEqual([...HUMAN_ENTRYPOINT_COMMANDS]);
    expect(output).not.toMatch(/\binternal adapters?\b/i);
    expect(output).not.toMatch(/\blocal-manual adapter\b/i);
    for (const pattern of QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS) {
      expect(output, `make quick-help must not expose ${pattern}`).not.toMatch(pattern);
    }
  });

  it('keeps internal workflow command references in diagnostic, maintainer, or machine-readable doc contexts', () => {
    const failures: string[] = [];

    for (const doc of WORKFLOW_SURFACE_DOCS) {
      const content = readRepoFile(doc);
      for (const match of content.matchAll(INTERNAL_WORKFLOW_REFERENCE_PATTERN)) {
        const reference = match[0];
        const index = match.index ?? 0;
        const lineNumber = lineNumberAtIndex(content, index);
        const context = internalReferenceContext(content, lineNumber);
        if (!INTERNAL_WORKFLOW_CONTEXT_PATTERN.test(context)) {
          failures.push(`${doc}:${lineNumber} ${reference}`);
        }
      }
    }

    expect(failures).toEqual([]);
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

    for (const doc of [
      'docs/testing/verification-campaigns-v1.md',
      'docs/user-guides/release-readiness-checklist.md',
      'docs/agent-task-runner-runbook.md',
    ]) {
      const content = readRepoFile(doc);
      expect(content, `${doc} must expose release:ready as the human release entrypoint`).toContain(
        'npm run release:ready',
      );
      expect(content, `${doc} must expose release:status as the read-only entrypoint`).toContain(
        'npm run release:status',
      );
      expect(content, `${doc} must describe release:campaign:full as internal when it is mentioned`).not.toMatch(
        /npm run release:campaign:full/,
      );
      for (const pattern of RELEASE_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS) {
        expect(content, `${doc} must not expose internal release/gate/lane adapters as copyable commands: ${pattern}`).not.toMatch(pattern);
      }
    }

    const governanceModel = readRepoFile('docs/current-engineering-governance-model.md');
    expect(governanceModel, 'governance model must keep gate:release:full described as internal/aggregate-only').toMatch(/gate:release:full/);

    for (const surface of ['docs/current-engineering-governance-model.md', 'Makefile']) {
      const content = readRepoFile(surface);
      expect(content, `${surface} must describe old surfaces as internal adapters`).toMatch(/internal adapter/i);
      expect(content, `${surface} must not offer bare gate:release:full as a copyable entrypoint`).not.toMatch(
        /(?:^|\n)(?:\s*@echo "\s*)?npm run gate:release:full(?:\s*(?:#|"))/m,
      );
      expect(content, `${surface} must not offer explicit gate:release:full as a generated human command`).not.toMatch(
        /(?:^|\n)(?:\s*@echo "\s*)?RELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full(?:\s*(?:#|"))/m,
      );
    }

    expect(combinedDocs).not.toMatch(/test:backend-real:full/);
    expect(combinedDocs).not.toMatch(/future .*one-shot campaign launcher|未来提供 one-shot campaign launcher/i);
    expect(combinedDocs).toMatch(/aggregate-only|聚合专用|explicit campaign|显式 campaign/);
    expect(combinedDocs).toMatch(/release:status/);
    expect(combinedDocs).toMatch(/gate:release/);
    expect(combinedDocs).toMatch(/test:unified-deploy:local-kind:images/);
    expect(combinedDocs).toMatch(/test:unified-deploy:local-kind/);
    expect(combinedDocs).toMatch(/test:unified-deploy:product-flows/);

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
      '.github/workflows/release-contract-artifact.yml',
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

    expect(makefile).toMatch(/local-real-up:[\s\S]*\$\(MAKE\) substrate-up[\s\S]*\$\(MAKE\) substrate-reseed[\s\S]*\$\(MAKE\) local-manual-up[\s\S]*LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0 \$\(MAKE\) local-manual-internal-up/);
    expect(makefile).toMatch(/local-real-status:[\s\S]*\$\(MAKE\) substrate-status[\s\S]*\$\(MAKE\) local-manual-status/);
    expect(makefile).toMatch(/local-manual-reset:[\s\S]*\$\(MAKE\) substrate-reset SUBSTRATE=local-dev[\s\S]*\$\(MAKE\) substrate-up SUBSTRATE=local-dev[\s\S]*\$\(MAKE\) substrate-reseed SUBSTRATE=local-dev[\s\S]*\$\(MAKE\) local-manual-up[\s\S]*\$\(MAKE\) local-manual-seed-agent-task/);
    expect(makefile).toMatch(/local-real-reset:[\s\S]*\$\(MAKE\) substrate-reset SUBSTRATE=local-dev[\s\S]*\$\(MAKE\) substrate-up SUBSTRATE=local-dev[\s\S]*\$\(MAKE\) substrate-reseed SUBSTRATE=local-dev[\s\S]*\$\(MAKE\) local-manual-up[\s\S]*AGENT_RUNNER_SEED_MODE=managed_agent_task[\s\S]*LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0[\s\S]*\$\(MAKE\) local-manual-seed-agent-task[\s\S]*LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0 \$\(MAKE\) local-manual-internal-up/);
    expect(runtimeManifest).not.toMatch(/id:\s*'local-real'/);
    expect(runtimeManifest).not.toMatch(/formalName:\s*'local-real'/);
  });

  it('removes Make compatibility targets for internal gate, lane, and backend-real adapters', () => {
    const makefile = readRepoFile('Makefile');
    const phonyBlock = makefile.match(/^\.PHONY:[\s\S]*?\n\n/)?.[0] ?? '';

    for (const target of REMOVED_MAKE_COMPAT_TARGETS) {
      expect(makefile, `Makefile must not define removed compatibility target: ${target}`).not.toMatch(
        new RegExp(`^${target}:`, 'm'),
      );
      expect(phonyBlock, `.PHONY must not expose removed compatibility target: ${target}`).not.toMatch(
        new RegExp(`\\b${target}\\b`),
      );
    }
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
      '.github/workflows/image-publish.yml',
      '.github/workflows/integration-e2e.yml',
      '.github/workflows/quality-gates.yml',
      '.github/workflows/release-contract-artifact.yml',
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

  it('keeps CI producer commands on npm adapters instead of removed Make compatibility targets', () => {
    const removedMakeCommandPattern = /\bmake (?:gate-(?:fast|default|release)|lane-(?:mock|visual|real-core|real-release)|backend-real-(?:reset|bootstrap|ready|run|report))\b/;

    for (const job of listCurrentCIWorkflowJobs()) {
      for (const command of job.commands) {
        expect(command, `${job.workflowPath}:${job.id} must not use removed Make compatibility targets`).not.toMatch(
          removedMakeCommandPattern,
        );
      }

      const parsedWorkflow = parseWorkflow(job.workflowPath);
      const runCommands = collectJobRunCommands(parsedWorkflow, job.id);
      expect(runCommands, `${job.workflowPath}:${job.id} must not call removed Make compatibility targets`).not.toMatch(
        removedMakeCommandPattern,
      );
    }

    const contractsJob = listCurrentCIWorkflowJobs().find(
      (job) => job.workflowPath === '.github/workflows/contracts-check.yml' && job.id === 'contracts',
    );
    expect(contractsJob?.commands).toEqual([
      'npm run contracts:check',
      'npm run contracts:check-current-workflows',
      'npm run contracts:check-current-gates',
      'npm run contracts:check-engineering-governance',
    ]);
    expect(contractsJob?.evidenceRequired).toBe(false);
    expect(contractsJob?.artifactPaths).toEqual([]);
    expect(collectJobRunCommands(parseWorkflow('.github/workflows/contracts-check.yml'), 'contracts')).not.toContain(
      'npm run gate:fast',
    );
  });

  it('passes workflow_dispatch string inputs into shell run blocks through env variables', () => {
    const failures = readTrackedWorkflowFiles().flatMap((workflowPath) => (
      collectDirectWorkflowDispatchInputRunInterpolations(workflowPath, parseWorkflow(workflowPath))
    ));
    const releaseContractWorkflow = parseWorkflow('.github/workflows/release-contract-artifact.yml');
    const rawOn = releaseContractWorkflow.on ?? releaseContractWorkflow.true;
    const releaseContractInputs = asRecord(asRecord(asRecord(rawOn).workflow_dispatch).inputs);

    expect(collectWorkflowDispatchStringInputNames(releaseContractWorkflow)).toEqual([
      'release_contract_input_artifact_name',
      'release_contract_input_run_id',
    ]);
    expect(asRecord(releaseContractInputs.release_contract_input_run_id)).toMatchObject({
      required: true,
      type: 'string',
    });
    expect(asRecord(releaseContractInputs.release_contract_input_artifact_name)).toMatchObject({
      required: true,
      type: 'string',
      default: 'agentsmith-release-contract-input',
    });
    expect(releaseContractInputs).not.toHaveProperty('release_contract_input_path');
    expect(failures).toEqual([]);
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

  it('models release contract artifact production as non-readiness CI output', () => {
    const workflow = CURRENT_CI_WORKFLOW_MANIFEST.find(
      (entry) => entry.path === '.github/workflows/release-contract-artifact.yml',
    );
    const job = workflow?.jobs.find((entry) => entry.id === 'generate-release-contract');
    const parsedWorkflow = parseWorkflow('.github/workflows/release-contract-artifact.yml');
    const workflowSource = readRepoFile('.github/workflows/release-contract-artifact.yml');
    const runCommands = collectJobRunCommands(
      parsedWorkflow,
      'generate-release-contract',
    );
    const releaseContractJob = asRecord(asRecord(parsedWorkflow.jobs)['generate-release-contract']);
    const steps = Array.isArray(releaseContractJob.steps) ? releaseContractJob.steps.map(asRecord) : [];
    const downloadStep = steps.find((step) => step.uses === 'actions/download-artifact@v7');
    const downloadWith = asRecord(downloadStep?.with);
    const receiptObjectSource = runCommands.match(/const receipt = \{[\s\S]*?\n\s*\};/)?.[0] ?? '';

    expect(workflow?.workflowName).toBe('Release Contract Artifact');
    expect(workflow?.role).toBe('release_artifact_producer');
    expect(workflow?.triggers).toEqual(['workflow_dispatch']);
    expect(workflow?.releaseBlocking).toBe(false);
    expect(job?.role).toBe('artifact_producer');
    expect(job?.requiresSecrets).toBe(false);
    expect(job?.evidenceRequired).toBe(true);
    expect(job?.evidenceFamilies).toEqual(['release_contract_artifact']);
    expect(job?.artifactPaths).toEqual([
      'artifacts/release-contract/agentsmith-release-contract.json',
      'artifacts/release-contract/release-contract-input-source.json',
    ]);
    expect(job?.commands).toEqual([
      RUNNER_CONTRACT_BUILD_COMMAND,
      'npm run release:contract:ci-artifact',
    ]);
    expect(asRecord(parsedWorkflow.permissions)).toEqual({ actions: 'read', contents: 'read' });
    expect(downloadStep).toBeDefined();
    expect(downloadWith.name).toBe('${{ inputs.release_contract_input_artifact_name }}');
    expect(downloadWith['run-id']).toBe('${{ inputs.release_contract_input_run_id }}');
    expect(downloadWith.repository).toBe('${{ github.repository }}');
    expect(downloadWith['github-token']).toBe('${{ github.token }}');
    expect(downloadWith.path).toBe('artifacts/release-contract/input');
    expect(runCommands).toContain(RUNNER_CONTRACT_BUILD_COMMAND);
    expect(runCommands).toContain('npm run release:contract:ci-artifact');
    expect(runCommands.indexOf(RUNNER_CONTRACT_BUILD_COMMAND)).toBeLessThan(
      runCommands.indexOf('npm run release:contract:ci-artifact'),
    );
    expect(runCommands).toContain('RELEASE_CONTRACT_INPUT_PATH="artifacts/release-contract/input/release-contract-input.json"');
    expect(runCommands).toContain('rm -f "${RELEASE_CONTRACT_OUTPUT_DIR}/agentsmith-release-contract.json"');
    expect(runCommands).toContain('test -f "${RELEASE_CONTRACT_INPUT_PATH}"');
    expect(runCommands).toContain('sha256sum "${RELEASE_CONTRACT_INPUT_PATH}"');
    expect(runCommands).toContain('release-contract-input-source.json');
    expect(runCommands).toContain('input_sha256');
    expect(receiptObjectSource).toContain('input_sha256');
    for (const releaseContractField of [
      'schema_version',
      'product_images',
      'deploy_image_inventory',
      'artifact_provenance',
    ]) {
      expect(receiptObjectSource).not.toMatch(new RegExp(`['"]?${releaseContractField}['"]?\\s*:`));
    }
    expect(runCommands).not.toContain('${{ inputs.release_contract_input_path }}');
    expect(runCommands).not.toContain('npm run release:ready');
    expect(runCommands).not.toContain('npm run gate:release');
    expect(workflowSource).toContain(
      'This workflow only produces a release contract artifact from a GitHub Actions handoff artifact.',
    );
    expect(workflowSource).not.toContain('release_contract_input_path');
    expect(workflowSource).not.toMatch(/deploy readiness|release readiness/i);
  });

  it('models GHCR image publishing as a product image handoff producer', () => {
    const workflow = CURRENT_CI_WORKFLOW_MANIFEST.find(
      (entry) => entry.path === '.github/workflows/image-publish.yml',
    );
    const job = workflow?.jobs.find((entry) => entry.id === 'publish-images');
    const parsedWorkflow = parseWorkflow('.github/workflows/image-publish.yml');
    const workflowSource = readRepoFile('.github/workflows/image-publish.yml');
    const runCommands = collectJobRunCommands(parsedWorkflow, 'publish-images');

    expect(workflow?.workflowName).toBe('Image Publish');
    expect(workflow?.role).toBe('release_artifact_producer');
    expect(workflow?.triggers).toEqual(['push', 'workflow_dispatch']);
    expect(workflow?.releaseBlocking).toBe(false);
    expect(job?.role).toBe('artifact_producer');
    expect(job?.requiresSecrets).toBe(false);
    expect(job?.evidenceRequired).toBe(true);
    expect(job?.evidenceFamilies).toEqual(['image_publish_handoff']);
    expect(job?.commands).toEqual([
      RUNNER_CONTRACT_BUILD_COMMAND,
      'scripts/governance/build-artifact-broker-cli.ts',
      'npm run release:deploy-template-package',
    ]);
    expect(job?.artifactPaths).toEqual([
      'artifacts/image-publish/VERSION',
      'artifacts/image-publish/build-artifact-broker-plan.json',
      'artifacts/image-publish/build-manifest.json',
      'artifacts/image-publish/image-publish-summary.json',
      'artifacts/image-publish/release-contract-input.json',
      'artifacts/image-publish/deploy-template-package.json',
      'artifacts/image-publish/agentsmith-deploy-template-package.tgz',
    ]);
    expect(asRecord(parsedWorkflow.permissions)).toEqual({ contents: 'read', packages: 'write' });
    expect(runCommands).toContain(RUNNER_CONTRACT_BUILD_COMMAND);
    expect(runCommands).toContain('docker push "${APP_RELEASE_REF}"');
    expect(runCommands).toContain('BUILD_ARTIFACT_BROKER_IMAGE_DIGEST_COMMAND');
    expect(runCommands).toContain('npm run release:deploy-template-package');
    expect(runCommands).toContain('release-contract-input.json');
    expect(runCommands).toContain("id: 'agentsmith_app'");
    expect(runCommands).toContain("parseKeyValue('infra/deploy/shared/llmup-image.lock')");
    expect(runCommands).toContain("parseKeyValue('infra/deploy/shared/afscp-image.lock')");
    expect(runCommands).toContain("parseKeyValue('infra/deploy/shared/asbcp-image.lock')");
    expect(runCommands).toContain("parseKeyValue('infra/deploy/shared/ingress-nginx-image.lock')");
    expect(runCommands).toContain("pinnedImage('afscp', afscpLock.get('afscp_source_image'))");
    expect(runCommands).toContain(
      "pinnedImage('ingress_nginx_controller', ingressNginxLock.get('ingress_nginx_controller_source_image'))",
    );
    expect(runCommands).toContain(
      "pinnedImage('ingress_nginx_certgen', ingressNginxLock.get('ingress_nginx_certgen_source_image'))",
    );
    expect(workflowSource).toContain('ghcr.io/${owner_lc}/agentsmith-app');
    expect(workflowSource).toContain('agentsmith-release-contract-input');
    expect(workflowSource).toContain('No separate backend/API image digest is fabricated');
    expect(workflowSource).not.toContain('agentsmith-api:${');
    expect(runCommands).not.toContain('site.env.example');
    expect(runCommands).not.toContain('siteEnv.get');
    expect(runCommands).not.toContain('npm run release:ready');
    expect(runCommands).not.toContain('npm run release:contract:ci-artifact');
    expect(runCommands.indexOf(RUNNER_CONTRACT_BUILD_COMMAND)).toBeLessThan(
      runCommands.indexOf('npx tsx scripts/governance/build-artifact-broker-cli.ts'),
    );
    expect(runCommands.indexOf(RUNNER_CONTRACT_BUILD_COMMAND)).toBeLessThan(
      runCommands.indexOf('npm run release:deploy-template-package'),
    );
  });

  it('publishes run-scoped mock-lane evidence from CI jobs that execute mock or visual lanes', () => {
    const jobs = listCurrentCIWorkflowJobs();
    const mockEvidenceOwners = jobs.filter((job) => job.evidenceFamilies.includes('mock_lane_run'));

    expect(mockEvidenceOwners.map((job) => `${job.workflowPath}:${job.id}`).sort()).toEqual([
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

  it('exposes a lean governance inventory from existing workflow truth', () => {
    const inventory = listCurrentGovernanceSurfaceInventory();
    const governanceModel = readRepoFile('docs/current-engineering-governance-model.md');

    expect(governanceModel.match(/Lean closure inventory/g) ?? []).toHaveLength(1);
    expect(inventory.publicHumanEntrypoints.map((entry) => entry.command)).toEqual([...HUMAN_ENTRYPOINT_COMMANDS]);
    expect(inventory.internalAdaptersAndOwnerDiagnostics.map((entry) => entry.commandOrAdapter)).toEqual(
      expect.arrayContaining([
        'gate:release',
        'gate:release:full',
        'release:contract:ci-artifact',
        'release:deploy-template-package',
        'lane:visual',
        'lane:backend-real:core',
        'lane:unified-deploy:local-kind',
        'test:unified-deploy:local-kind',
      ]),
    );

    expect(inventory.evidenceAuthorityRoots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '<campaign-root>/gate-release/backend-real-visual/ux-traces',
          authority: 'campaign',
        }),
        expect.objectContaining({
          path: 'artifacts/backend-real-visual/<run-id>/ux-traces',
          authority: 'standalone_diagnostic',
        }),
        expect.objectContaining({
          path: 'artifacts/unified-deploy/',
          authority: 'standalone_diagnostic',
        }),
      ]),
    );
    expect(inventory.evidenceAuthorityRoots.some((root) => root.authority === 'campaign')).toBe(true);
    expect(inventory.evidenceAuthorityRoots.some((root) => root.authority === 'standalone_diagnostic')).toBe(true);

    expect(inventory.runLocalStateRoots.map((root) => root.path)).toEqual(
      expect.arrayContaining([
        'artifacts/runtime/lines/local-manual/current',
        'artifacts/runtime/lines/unified-deploy-local-kind/current',
      ]),
    );

    expect(inventory.cleanupCommandsAndOwnershipProofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'npm run backend-real:reset',
          ownershipProof: 'current-resource-lock:destructive-lifecycle',
        }),
        expect.objectContaining({
          command: 'make local-real-reset',
          ownershipProof: 'current-runtime-line:local-manual',
        }),
      ]),
    );

    expect(inventory.dependencyStartupReadinessCallers).toEqual([
      {
        path: 'Makefile',
        caller: 'deps-up',
        calls: ['integration:deps:up'],
        purpose: 'dependency_startup',
        note: 'canonical Make wrapper for starting integration dependencies',
      },
      {
        path: 'Makefile',
        caller: 'deps-ready',
        calls: ['scripts/integration-deps-ready.ts'],
        purpose: 'dependency_readiness',
        note: 'readiness-only polling target; no dependency startup',
      },
      {
        path: 'Makefile',
        caller: 'deps-bootstrap',
        calls: ['deps-up', 'deps-ready'],
        purpose: 'combined_bootstrap',
        note: 'intentional combined helper; this is not duplicate waste',
      },
      {
        path: 'scripts/backend-real-bootstrap.sh',
        caller: 'backend-real bootstrap',
        calls: ['integration:deps:up'],
        purpose: 'dependency_startup',
        note: 'backend-real owner bootstrap starts integration dependencies before readiness consumers',
      },
      {
        path: 'scripts/run-internal-agent-task-real-gate.sh',
        caller: 'internal agent task real gate bootstrap',
        calls: ['make deps-bootstrap'],
        purpose: 'combined_bootstrap',
        note: 'owner diagnostic uses the canonical combined dependency bootstrap helper',
      },
      {
        path: 'scripts/run-integration-e2e-full.sh',
        caller: 'integration e2e full bootstrap',
        calls: ['make deps-bootstrap'],
        purpose: 'combined_bootstrap',
        note: 'integration e2e preflight uses the canonical combined dependency bootstrap helper',
      },
      {
        path: 'scripts/run-integration-release-user-story.sh',
        caller: 'release user story integration bootstrap',
        calls: ['make deps-bootstrap'],
        purpose: 'combined_bootstrap',
        note: 'release user story owner diagnostic uses the canonical combined dependency bootstrap helper',
      },
      {
        path: 'scripts/run-release-local-precheck.sh',
        caller: 'release local precheck bootstrap',
        calls: ['make deps-bootstrap'],
        purpose: 'combined_bootstrap',
        note: 'release precheck uses the canonical combined dependency bootstrap helper after readiness reuse fails',
      },
    ]);
    expect(inventory.dependencyStartupReadinessCallers.map((caller) => (
      dependencyCallerKey(caller.path, caller.calls)
    )).sort()).toEqual(collectDependencyCallerKeysFromSources());

    expect(inventory.intentionalDuplicateSafetyChecks.map((check) => check.id)).toEqual([
      'wrapper-and-native-result-json',
      'terminal-aggregate-revalidation',
      'rollout-image-consumability-preflight',
      'route-smoke-before-product-flows',
    ]);
    for (const check of inventory.intentionalDuplicateSafetyChecks) {
      expect(check.whyNotWaste.length).toBeGreaterThan(0);
    }
  });

  it('keeps standalone product readiness evidence roots diagnostic unless campaign-linked', () => {
    const governanceModel = readRepoFile('docs/current-engineering-governance-model.md');

    expect(governanceModel).toContain(
      'standalone `artifacts/backend-real-visual/<run-id>/ux-traces` is focused owner diagnostic evidence; only campaign-linked `<campaign-root>/gate-release/backend-real-visual/ux-traces` is product readiness authority.',
    );
    expect(governanceModel).toContain(
      'standalone `artifacts/unified-deploy/` is deploy diagnostic evidence. Unified deploy lanes remain transition-only focused diagnostics / 过渡期专项诊断 and are not required AgentSmith product-gate evidence.',
    );
    expect(governanceModel).not.toContain(
      'standalone `gate:release` / `lane:backend-real:release` runs own release-grade trace bundles',
    );
    expect(governanceModel).not.toContain(
      'Deploy evidence is produced by unified deploy checks under `artifacts/unified-deploy/`.',
    );
  });

  it('keeps unified deploy wording out of current release required evidence', () => {
    const workflowSource = readRepoFile('scripts/governance/current-workflow-manifest.ts');
    const docs = [
      'README.md',
      'DEVELOPMENT.md',
      'docs/testing/verification-campaigns-v1.md',
      'docs/contracts/unified-deploy-contract.md',
      'docs/user-guides/release-readiness-checklist.md',
      'docs/user-guides/unified-deploy-operations.md',
      'docs/current-engineering-governance-model.md',
      'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
      'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md',
    ].map(readRepoFile).join('\n');
    const unifiedDeployWorkflowCommands = listCurrentWorkflowCommands()
      .filter((command) => command.npmScript?.startsWith('lane:unified-deploy:'));

    expect(unifiedDeployWorkflowCommands).toHaveLength(4);
    for (const command of unifiedDeployWorkflowCommands) {
      expect(command.workflowRole).toBe('diagnostic_lane');
      expect(command.description).toMatch(/transition-only unified deploy[\s\S]*focused diagnostic/i);
      expect(command.description).not.toMatch(/legacy unified deploy|legacy focused diagnostic/i);
      expect(command.description).not.toMatch(/release evidence|evidence channel/i);
      expect(command.storyEvidenceRequiredFor).not.toContain('release');
    }

    expect(workflowSource).not.toMatch(/unified deploy [^\n'"]*release evidence channel/i);
    expect(workflowSource).not.toMatch(/unified deploy [^\n'"]*evidence owner/i);
    expect(workflowSource).toMatch(/transition-only focused diagnostics[\s\S]*过渡期专项诊断/i);
    expect(workflowSource).not.toMatch(/legacy\/focused diagnostics|legacy focused diagnostic|legacy unified deploy/i);
    expect(docs).toMatch(/transition-only focused diagnostics[\s\S]*过渡期专项诊断/i);
    expect(docs).toMatch(/not part of (?:the )?(?:current )?AgentSmith product gate/i);
    expect(docs).not.toMatch(/legacy\/focused diagnostics|legacy focused diagnostics|legacy deploy diagnostics|Legacy deploy diagnostics|旧部署诊断/i);
    expect(docs).not.toMatch(/current AgentSmith release readiness is transitional product readiness and local-kind evidence/i);
    expect(docs).not.toMatch(/must[\s\S]{0,80}(?:unified deploy|local-kind|product-flow)[\s\S]{0,80}(?:evidence|passed)/i);
    expect(docs).not.toMatch(/release campaign evidence uses unified deploy lanes/i);
    expect(docs).not.toMatch(/当前 release campaign 直接绑定[\s\S]{0,120}unified deploy/i);
    expect(docs).not.toMatch(/由 release campaign 编排/i);
    expect(docs).not.toMatch(/release:ready[\s\S]{0,100}local-kind evidence/i);
    expect(docs).not.toMatch(/release:ready[\s\S]{0,120}default deploy evidence line/i);
    expect(docs).not.toMatch(/orchestrate[s]?[\s\S]{0,120}unified deploy evidence lanes/i);
    expect(docs).not.toMatch(/release:ready[\s\S]{0,120}unified deploy evidence lanes/i);
    expect(docs).not.toMatch(/release kit evidence[\s\S]{0,80}映射回当前 release campaign/i);
    expect(docs).not.toMatch(/release:ready[\s\S]{0,80}(?:已消费|consume|consumes|consumed)[\s\S]{0,80}(?:new )?deploy evidence/i);
    expect(docs).not.toMatch(/future campaign[\s\S]{0,80}consume/i);
  });
});
