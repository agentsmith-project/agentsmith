import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { StoryDefinition } from '../../e2e/story-contract';
import type { VisualBaselineCatalogEntry } from '../../e2e/visual-baseline-support';
import {
  buildVerificationCatalog,
  evidenceProjectionForLevel,
  normalizeVerificationCatalogRepoPath,
  type VerificationCatalog,
  type VerificationCatalogLevel,
  type VerificationCatalogStory,
  type VerificationCatalogVisualCodeRefMapping,
} from './verification-catalog';

export type VerificationGoal = 'debug' | 'pr' | 'visual' | 'real' | 'release-real';
export type VerificationMode = 'dry-run' | 'run';
export type VerificationLevel = VerificationCatalogLevel;
export type StoryCardRisk = 'required' | 'inferred';
export type StoryEvidenceStatus = 'not_evaluated' | 'missing';
export type StoryRiskLevel = 'R0' | 'R1' | 'R2' | 'R3';
export type StoryEvaluationStatus = 'not_evaluated' | 'missing' | 'manual_review_needed';
export type ChangedFileImpactRule =
  | 'canonical_story_markdown'
  | 'generated_story_specs_derived_cache'
  | 'visual_code_ref'
  | 'trace_spec_story_binding'
  | 'env_only_configuration'
  | 'docs_only'
  | 'design_system'
  | 'runner_context_credential'
  | 'backend_real_diagnostic_tooling'
  | 'release_real_owner_diagnostic'
  | 'release_deploy_operations'
  | 'governance_tooling'
  | 'unmapped_source';

export interface StoryLevelStatus {
  level: VerificationLevel;
  status: StoryEvaluationStatus;
  reason: string;
}

export interface StoryLatestEvidence {
  state: 'not_inspected_by_verify_report';
  owner: string;
  artifactPath: string | null;
}

export interface StoryEvidenceCard {
  level: VerificationLevel;
  state: 'not_inspected_by_verify_report';
  status: StoryEvaluationStatus;
  owner: string;
  artifactPath: string | null;
  artifactPathTemplate: string | null;
  additionalArtifactPathTemplates: readonly string[];
  artifactPathTemplateReason: string | null;
  note: string;
}

export interface VerificationStoryImpactSource {
  changedFile: string;
  rule: ChangedFileImpactRule;
  surface: string;
  action: string;
  manualReviewRequired: boolean;
  broadImpact: boolean;
}

export interface VerificationChangedFileImpact {
  changedFile: string;
  matchedRules: readonly ChangedFileImpactRule[];
  affectedSurfaces: readonly string[];
  storyIds: readonly string[];
  action: string;
  manualReviewRequired: boolean;
  broadImpact: boolean;
}

export interface VerificationRiskSummary {
  posture: 'fail-closed';
  summary: string;
  reasons: readonly string[];
  warnings: readonly string[];
  manualReviewRequired: boolean;
  broadImpact: boolean;
}

export interface VerificationStoryCard {
  storyId: string;
  title: string;
  personas: readonly string[];
  family: string;
  lane: StoryDefinition['lane'];
  sourceFile: string;
  risk: StoryCardRisk;
  riskPolicyRefs: VerificationCatalogStory['riskPolicyRefs'];
  riskPolicySource: VerificationCatalogStory['riskPolicySource'];
  riskLevel: StoryRiskLevel;
  riskReason: string;
  requiredLevels: readonly VerificationLevel[];
  evidenceStatus: StoryEvidenceStatus;
  status: StoryEvaluationStatus;
  failureReason: string | null;
  manualReviewRequired: boolean;
  manualReviewReasons: readonly string[];
  levelStatuses: readonly StoryLevelStatus[];
  latestEvidence: StoryLatestEvidence;
  evidenceCards: readonly StoryEvidenceCard[];
  impactSources: readonly VerificationStoryImpactSource[];
  nextAction: string;
}

export interface VerificationPlan {
  goal: VerificationGoal;
  mode: VerificationMode;
  risk: 'fail-closed';
  generatedAt: string;
  changedFiles: readonly string[];
  affectedStories: readonly string[];
  affectedSurfaces: readonly string[];
  requiredLevels: readonly VerificationLevel[];
  requiredEvidence: readonly string[];
  recommendedCommands: readonly string[];
  riskSummary: VerificationRiskSummary;
  storyCards: readonly VerificationStoryCard[];
  changedFileImpacts: readonly VerificationChangedFileImpact[];
  finalVerdict: string;
  nextAction: string;
  nextActions: readonly string[];
  reportRoot?: string;
  releaseVerdict: false;
}

export interface BuildVerificationPlanInput {
  goal?: VerificationGoal;
  goalExplicit?: boolean;
  run?: boolean;
  changedFiles?: readonly string[];
  changeDetectionFailure?: string;
  changeDetectionWarnings?: readonly string[];
  reportRoot?: string;
  generatedAt?: string;
  catalog?: VerificationCatalog;
  stories?: readonly StoryDefinition[];
  visualCatalogEntries?: readonly VisualBaselineCatalogEntry[];
}

type MutableStoryCard = Omit<
  VerificationStoryCard,
  | 'requiredLevels'
  | 'riskLevel'
  | 'riskReason'
  | 'status'
  | 'failureReason'
  | 'manualReviewRequired'
  | 'manualReviewReasons'
  | 'levelStatuses'
  | 'latestEvidence'
  | 'evidenceCards'
  | 'impactSources'
  | 'nextAction'
> & {
  requiredLevels: Set<VerificationLevel>;
  riskPolicyRiskFloor: StoryRiskLevel;
  riskPolicyLevelFloor: Set<VerificationLevel>;
  manualReviewReasons: Set<StoryManualReviewReason>;
  impactSources: Map<string, VerificationStoryImpactSource>;
  nextActions: string[];
};

type MutableChangedFileImpact = {
  changedFile: string;
  matchedRules: Set<ChangedFileImpactRule>;
  affectedSurfaces: Set<string>;
  storyIds: Set<string>;
  actions: string[];
  manualReviewRequired: boolean;
  broadImpact: boolean;
};

type ImpactAccumulator = {
  levels: Set<VerificationLevel>;
  commands: Set<string>;
  surfaces: Set<string>;
  reasons: string[];
  warnings: string[];
  storyCards: Map<string, MutableStoryCard>;
  changedFileImpacts: Map<string, MutableChangedFileImpact>;
  manualReviewRequired: boolean;
  broadImpact: boolean;
  nextActions: string[];
};

const LEVEL_ORDER: readonly VerificationLevel[] = ['V0', 'V1', 'V2', 'V3', 'V4'];
const RISK_LEVEL_ORDER: readonly StoryRiskLevel[] = ['R0', 'R1', 'R2', 'R3'];
const IMPACT_RULE_ORDER: readonly ChangedFileImpactRule[] = [
  'canonical_story_markdown',
  'generated_story_specs_derived_cache',
  'visual_code_ref',
  'trace_spec_story_binding',
  'env_only_configuration',
  'docs_only',
  'design_system',
  'runner_context_credential',
  'backend_real_diagnostic_tooling',
  'release_real_owner_diagnostic',
  'release_deploy_operations',
  'governance_tooling',
  'unmapped_source',
];
const COMMAND_ORDER = [
  'npm run verify:quick',
  'npm run verify:default',
  'npm run verify:visual',
  'npm run verify:real',
  'npm run verify:release-real',
] as const;
const REAL_VERIFY_COMMAND = 'npm run verify:real';
const RELEASE_REAL_VERIFY_COMMAND = 'npm run verify:release-real';
const AGENT_TASK_RUNNER_FAST_COMMAND = 'npm run test:agent-task:runner:fast';
const AGENT_TASK_RUNNER_BACKEND_REAL_COMMAND = 'npm run test:agent-task:runner:backend-real';
const AGENT_TASK_INTEGRATION_COMMAND = 'npm run test:e2e:integration:agent-task';
const UNIFIED_DEPLOY_UNIT_COMMAND = 'npm run test:unified-deploy:unit';
export const PUBLIC_RELEASE_READY_COMMAND = 'npm run release:ready';
const GOVERNED_PR_VERIFY_COMMAND = 'npm run verify -- --goal=pr --run';
const GOVERNED_VISUAL_VERIFY_COMMAND = 'npm run verify -- --goal=visual --run';
const GOVERNED_REAL_VERIFY_COMMAND = 'npm run verify -- --goal=real --run';
const GOVERNED_RELEASE_REAL_VERIFY_COMMAND = 'npm run verify -- --goal=release-real --run';
const PUBLIC_GOVERNED_VERIFY_COMMAND_BY_INTERNAL_ALIAS: Record<string, string> = {
  'npm run verify:quick': GOVERNED_PR_VERIFY_COMMAND,
  'npm run verify:default': GOVERNED_PR_VERIFY_COMMAND,
  'npm run verify:visual': GOVERNED_VISUAL_VERIFY_COMMAND,
  [REAL_VERIFY_COMMAND]: GOVERNED_REAL_VERIFY_COMMAND,
  [RELEASE_REAL_VERIFY_COMMAND]: PUBLIC_RELEASE_READY_COMMAND,
};
const PUBLIC_VERIFY_TEXT_REPLACEMENTS: readonly (readonly [string, string])[] = [
  [GOVERNED_RELEASE_REAL_VERIFY_COMMAND, PUBLIC_RELEASE_READY_COMMAND],
  ['npm run verify -- --goal=debug --run', GOVERNED_PR_VERIFY_COMMAND],
  ...Object.entries(PUBLIC_GOVERNED_VERIFY_COMMAND_BY_INTERNAL_ALIAS)
    .sort(([left], [right]) => right.length - left.length)
    .map(([internalText, publicText]) => [internalText, publicText] as const),
];
const GOVERNANCE_TOOLING_DEFAULT_GATE_PROFILE = 'governance_tooling' as const;

const MANUAL_REVIEW_REASONS = {
  storyMarkdownChanged: 'story markdown changed',
  generatedSpecsDerivedCacheDrift: 'generated specs derived cache drift',
  unmappedSource: 'unmapped source',
  changeDetectionFailure: 'change detection failure',
  runnerContextCredentialOwnerReview: 'runner/context/credential owner review',
  releaseDeployOperatorReview: 'release/deploy operator review',
  visualV2NeedsReview: 'visual V2 needs review',
} as const;
type StoryManualReviewReason = (typeof MANUAL_REVIEW_REASONS)[keyof typeof MANUAL_REVIEW_REASONS];

const MANUAL_REVIEW_REASON_ORDER: readonly StoryManualReviewReason[] = [
  MANUAL_REVIEW_REASONS.storyMarkdownChanged,
  MANUAL_REVIEW_REASONS.generatedSpecsDerivedCacheDrift,
  MANUAL_REVIEW_REASONS.unmappedSource,
  MANUAL_REVIEW_REASONS.changeDetectionFailure,
  MANUAL_REVIEW_REASONS.runnerContextCredentialOwnerReview,
  MANUAL_REVIEW_REASONS.releaseDeployOperatorReview,
  MANUAL_REVIEW_REASONS.visualV2NeedsReview,
];

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function orderedLevels(values: Iterable<VerificationLevel>): VerificationLevel[] {
  const selected = new Set(values);
  return LEVEL_ORDER.filter((level) => selected.has(level));
}

function orderedImpactRules(values: Iterable<ChangedFileImpactRule>): ChangedFileImpactRule[] {
  const selected = new Set(values);
  return IMPACT_RULE_ORDER.filter((rule) => selected.has(rule));
}

function orderedCommands(values: Iterable<string>): string[] {
  const selected = new Set(values);
  const known = COMMAND_ORDER.filter((command) => selected.has(command));
  const unknown = [...selected]
    .filter((command) => !COMMAND_ORDER.includes(command as (typeof COMMAND_ORDER)[number]))
    .sort((left, right) => left.localeCompare(right));
  return [...known, ...unknown];
}

function orderedManualReviewReasons(values: Iterable<StoryManualReviewReason>): string[] {
  const selected = new Set(values);
  return MANUAL_REVIEW_REASON_ORDER.filter((reason) => selected.has(reason));
}

export function publicVerifyRunCommandForGoal(goal: VerificationGoal): string {
  if (goal === 'release-real') {
    return PUBLIC_RELEASE_READY_COMMAND;
  }
  if (goal === 'debug') {
    return GOVERNED_PR_VERIFY_COMMAND;
  }
  return `npm run verify -- --goal=${goal} --run`;
}

export function sanitizePublicVerificationText(value: string): string {
  let output = value
    .split('--goal=<debug|pr|visual|real|release-real>')
    .join('--goal=<pr|visual|real>');
  for (const [internalText, publicText] of PUBLIC_VERIFY_TEXT_REPLACEMENTS) {
    output = output.split(internalText).join(publicText);
  }
  return output
    .replace(/\b--goal=debug\b/g, '--goal=pr')
    .replace(/\b--goal=release-real\b/g, 'release:ready');
}

export function publicRecommendedVerificationCommands(commands: readonly string[]): string[] {
  const rendered: string[] = [];
  for (const command of commands) {
    const publicCommand = sanitizePublicVerificationText(command);
    if (!rendered.includes(publicCommand)) {
      rendered.push(publicCommand);
    }
  }
  return rendered;
}

export function defaultGateProfileForVerificationPlan(
  plan: VerificationPlan,
): typeof GOVERNANCE_TOOLING_DEFAULT_GATE_PROFILE | null {
  const onlyGovernanceToolingSurface = plan.affectedSurfaces.length === 1
    && plan.affectedSurfaces[0] === 'engineering-governance-tooling';
  const hasHeavyLevel = plan.requiredLevels.some((level) => level === 'V2' || level === 'V3' || level === 'V4');
  const hasStoryImpact = plan.storyCards.length > 0
    || plan.changedFileImpacts.some((impact) => impact.storyIds.length > 0);
  const hasUnmappedImpact = plan.affectedSurfaces.includes('unmapped-source')
    || plan.changedFileImpacts.some((impact) => impact.matchedRules.includes('unmapped_source'));

  if (
    plan.goal === 'pr'
    && onlyGovernanceToolingSurface
    && !hasHeavyLevel
    && !plan.riskSummary.broadImpact
    && !plan.riskSummary.manualReviewRequired
    && !hasStoryImpact
    && !hasUnmappedImpact
  ) {
    return GOVERNANCE_TOOLING_DEFAULT_GATE_PROFILE;
  }

  return null;
}

function publicGovernedVerifyCommandForInternalAlias(command: string): string {
  return sanitizePublicVerificationText(command);
}

export function verificationRunContractFailure(input: {
  goal: VerificationGoal;
  goalExplicit?: boolean;
  run?: boolean;
  recommendedCommands: readonly string[];
}): string | null {
  if (!input.run) {
    return null;
  }

  if (!input.goalExplicit) {
    return '--run requires an explicit public --goal=<pr|visual|real>; no internal verification steps were executed.';
  }

  const blockedCommands = input.recommendedCommands.filter((command) => (
    (command === REAL_VERIFY_COMMAND && input.goal !== 'real')
    || (command === RELEASE_REAL_VERIFY_COMMAND && input.goal !== 'release-real')
  ));
  if (blockedCommands.length === 0) {
    return null;
  }

  const publicGoal = input.goal === 'debug' ? 'pr' : input.goal;
  if (blockedCommands.includes(RELEASE_REAL_VERIFY_COMMAND)) {
    return `--goal=${publicGoal} --run cannot cover release-owned backend-real changes; use ${PUBLIC_RELEASE_READY_COMMAND}. This verify report is not a release verdict until ${PUBLIC_RELEASE_READY_COMMAND} runs.`;
  }

  const blockedGovernedCommands = [...new Set(blockedCommands.map(publicGovernedVerifyCommandForInternalAlias))];
  return `--goal=${publicGoal} --run cannot execute ${blockedGovernedCommands.join(', ')}; use ${GOVERNED_REAL_VERIFY_COMMAND} for backend-real verification.`;
}

function normalizeRepoPath(value: string): string {
  return normalizeVerificationCatalogRepoPath(value);
}

function isGeneratedStorySpec(filePath: string, catalog: VerificationCatalog): boolean {
  return normalizeRepoPath(filePath) === catalog.generated_story_specs.path;
}

const RUNNER_CONTEXT_CREDENTIAL_PATH_PATTERNS: readonly RegExp[] = [
  /^scripts\/skills-runtime-/,
  /^scripts\/.*agent-task.*runner/i,
  /^scripts\/notebook-/,
  /^scripts\/task-terminal/,
  /^scripts\/workspace-shared-context/,
  /^scripts\/.*credential/i,
  /^e2e\/integration-agent-task-terminal/,
  /^packages\/agent-runner\/src\//,
  /^packages\/agent-task-runner\/src\//,
  /^packages\/api-entry-node\/src\/(notebook-execution-orchestrator|context-store|context-route-handler|managed-credential-resolver|agent-execution-service|agent-runner-profile)\.[^/]+$/,
  /^src\/components\/context\//,
  /^src\/components\/credentials\//,
  /^src\/components\/notebook\//,
  /^src\/lib\/api\/endpoints\/context\.ts$/,
  /^src\/lib\/api\/endpoints\/credentials\.ts$/,
  /^src\/lib\/api\/types\/context\.ts$/,
  /^src\/lib\/api\/types\/notebook\.ts$/,
  /^src\/mocks\/handlers\/context\.ts$/,
  /^src\/mocks\/handlers\/credentials\.ts$/,
  /^infra\/runtime\/backend-real\.env$/,
];

function isRunnerContextOrCredentialPath(filePath: string): boolean {
  return RUNNER_CONTEXT_CREDENTIAL_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isReleaseRealOwnerDiagnosticPath(filePath: string): boolean {
  return [
    /^scripts\/backend-real-full-gate\.sh$/,
  ].some((pattern) => pattern.test(filePath));
}

function isReleaseRealDiagnosticStory(story: VerificationCatalogStory): boolean {
  return story.storyId === 'release-user-story-end-to-end';
}

function isReleaseDeployPath(filePath: string): boolean {
  return [
    /^scripts\/release-full-campaign\.sh$/,
    /^scripts\/release-full-aggregate-gate\.sh$/,
    /^scripts\/run-integration-release-user-story(?:\.test)?\.(?:sh|ts)$/,
    /^scripts\/release-local-precheck-afscp\.test\.ts$/,
    /^scripts\/governance\/release/,
    /^scripts\/governance\/run-release/,
    /^scripts\/governance\/release-campaign/,
    /^scripts\/lib\/release-/,
    /^scripts\/lib\/deploy-/,
    /^scripts\/unified-deploy\//,
    /^scripts\/run-release-local-precheck\.sh$/,
    /^infra\/deploy\//,
    /^e2e\/integration-release-user-story/,
    /^e2e\/release-user-story/,
    /^docs\/contracts\/.*release/i,
    /^docs\/contracts\/.*deployment/i,
    /^docs\/user-guides\/.*deploy/i,
    /^docs\/user-guides\/.*release/i,
  ].some((pattern) => pattern.test(filePath));
}

function isUnifiedDeployPath(filePath: string): boolean {
  return [
    /^scripts\/unified-deploy\//,
    /^infra\/deploy\/unified\//,
    /^docs\/contracts\/unified-deploy-contract\.md$/,
    /^docs\/user-guides\/unified-deploy-operations\.md$/,
  ].some((pattern) => pattern.test(filePath));
}

function isGovernanceToolingPath(filePath: string): boolean {
  if (isReleaseDeployPath(filePath)) {
    return false;
  }
  return [
    /^scripts\/governance\/.*\.ts$/,
    /^scripts\/default-gate(?:\.test)?\.(?:sh|ts)$/,
    /^scripts\/governance-default-gate(?:\.test)?\.(?:sh|ts)$/,
    /^scripts\/run-mock-lane-playwright\.test\.ts$/,
    /^scripts\/contracts\/check-current-[^/]+(?:\.test)?\.ts$/,
    /^scripts\/contracts\/check-engineering-governance(?:\.test)?\.ts$/,
  ].some((pattern) => pattern.test(filePath));
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function changedJsonKeys(left: JsonObject, right: JsonObject): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .filter((key) => stableJson(left[key]) !== stableJson(right[key]))
    .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));
}

function readGitText(args: readonly string[]): string | null {
  const result = spawnSync('git', [...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return null;
  }
  return result.stdout;
}

function packageJsonHasDiffAgainstHead(): boolean {
  const diff = readGitText(['diff', '--name-only', 'HEAD', '--', 'package.json']);
  if (diff === null) {
    return false;
  }
  return diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes('package.json');
}

function packageJsonHasUnstagedDiff(): boolean {
  const diff = readGitText(['diff', '--name-only', '--', 'package.json']);
  if (diff === null) {
    return false;
  }
  return diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes('package.json');
}

function packageJsonHasCachedDiff(): boolean {
  const diff = readGitText(['diff', '--name-only', '--cached', '--', 'package.json']);
  if (diff === null) {
    return false;
  }
  return diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes('package.json');
}

function readPackageJsonFromHead(): JsonObject | null {
  const content = readGitText(['show', 'HEAD:package.json']);
  return content === null ? null : parseJsonObject(content);
}

function readPackageJsonFromIndex(): JsonObject | null {
  const content = readGitText(['show', ':package.json']);
  return content === null ? null : parseJsonObject(content);
}

function readPackageJsonFromWorktree(): JsonObject | null {
  try {
    return parseJsonObject(readFileSync('package.json', 'utf8'));
  } catch {
    return null;
  }
}

function isSafeGovernanceToolingTestPath(value: string): boolean {
  return /^scripts\/(?:default-gate|governance-default-gate|run-mock-lane-playwright)\.test\.ts$/.test(value)
    || /^scripts\/contracts\/check-current-[^/]+\.test\.ts$/.test(value)
    || /^scripts\/contracts\/check-engineering-governance\.test\.ts$/.test(value)
    || /^scripts\/governance\/__tests__\/[^/]+\.test\.ts$/.test(value);
}

function isSafeGovernanceToolingTestCommand(command: string): boolean {
  const prefix = 'npm run test:run -- ';
  if (!command.startsWith(prefix) || /[;&|`$<>]/.test(command)) {
    return false;
  }
  const testPaths = command.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  return testPaths.length > 0 && testPaths.every(isSafeGovernanceToolingTestPath);
}

function isSafeMockLaneDiagnosticCommand(command: string): boolean {
  if (/[;|`$<>]/.test(command) || /\b(?:visual|with-visual|release|deploy|backend-real)\b/i.test(command)) {
    return false;
  }

  const segments = command.split(/\s+&&\s+/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  return segments.every((segment) => {
    if (/^bash scripts\/run-mock-lane-session\.sh\b/.test(segment)) {
      return /\s--(?:preset=default|shards=chromium,chromium-serial)\b/.test(segment);
    }
    if (/^bash scripts\/run-mock-lane-playwright\.sh\b/.test(segment)) {
      return /\s--project=(?:smoke|chromium|chromium-serial)\b/.test(segment);
    }
    return false;
  });
}

function isSafeGovernanceOrMockLanePackageScript(scriptName: string, command: string): boolean {
  if (scriptName === 'test:governance') {
    return command === 'bash scripts/governance-default-gate.sh';
  }
  if (scriptName === 'test:governance-tooling') {
    return isSafeGovernanceToolingTestCommand(command);
  }
  if (/^test:e2e:lane:mock:(?:smoke|chromium)$/.test(scriptName)) {
    return isSafeMockLaneDiagnosticCommand(command);
  }
  return false;
}

function isPackageJsonSafeGovernanceToolingChange(filePath: string): boolean {
  if (filePath !== 'package.json' || !packageJsonHasDiffAgainstHead()) {
    return false;
  }

  const hasCachedDiff = packageJsonHasCachedDiff();
  const hasUnstagedDiff = packageJsonHasUnstagedDiff();
  if (hasCachedDiff && hasUnstagedDiff) {
    return false;
  }

  const basePackageJson = readPackageJsonFromHead();
  const currentPackageJson = hasCachedDiff ? readPackageJsonFromIndex() : readPackageJsonFromWorktree();
  if (!basePackageJson || !currentPackageJson) {
    return false;
  }

  const packageChangedKeys = changedJsonKeys(basePackageJson, currentPackageJson);
  if (packageChangedKeys.length !== 1 || packageChangedKeys[0] !== 'scripts') {
    return false;
  }

  const baseScripts = basePackageJson.scripts;
  const currentScripts = currentPackageJson.scripts;
  if (!isJsonObject(baseScripts) || !isJsonObject(currentScripts)) {
    return false;
  }

  const changedScriptNames = changedJsonKeys(baseScripts, currentScripts);
  if (changedScriptNames.length === 0) {
    return false;
  }

  return changedScriptNames.every((scriptName) => {
    const currentCommand = currentScripts[scriptName];
    const previousCommand = baseScripts[scriptName];
    if (
      typeof currentCommand !== 'string'
      || !isSafeGovernanceOrMockLanePackageScript(scriptName, currentCommand)
    ) {
      return false;
    }
    if (previousCommand === undefined) {
      return true;
    }
    return typeof previousCommand === 'string'
      && isSafeGovernanceOrMockLanePackageScript(scriptName, previousCommand);
  });
}

function isBackendRealDiagnosticToolingPath(filePath: string): boolean {
  return [
    /^scripts\/backend-real-bootstrap\.sh$/,
    /^scripts\/backend-real-run(?:\.test)?\.(?:sh|ts)$/,
    /^scripts\/agent-task-real-smoke-gate\.sh$/,
    /^scripts\/run-internal-agent-task-real-gate\.sh$/,
    /^scripts\/internal-backend-real-gate-runtime\.test\.ts$/,
  ].some((pattern) => pattern.test(filePath));
}

function isEnvLikePath(filePath: string): boolean {
  const basename = filePath.split('/').at(-1) ?? filePath;
  return /^\.env(?:[.-].*)?$/.test(basename)
    || /\.env(?:\..*)?$/.test(basename);
}

function isRuntimeCriticalEnvPath(filePath: string): boolean {
  if (!isEnvLikePath(filePath)) {
    return false;
  }

  return [
    /^infra\/runtime\/[^/]+\.env$/,
    /^infra\/substrate\/[^/]+\.env$/,
    /(^|\/)(backend-real|runner|credential|credentials|context-store|managed-credential|oauth|release|deploy|substrate)[^/]*\.env(?:\.|$)/i,
  ].some((pattern) => pattern.test(filePath));
}

function isEnvOnlyConfigurationPath(filePath: string): boolean {
  if (
    isRunnerContextOrCredentialPath(filePath)
    || isReleaseRealOwnerDiagnosticPath(filePath)
    || isReleaseDeployPath(filePath)
    || isRuntimeCriticalEnvPath(filePath)
  ) {
    return false;
  }

  const basename = filePath.split('/').at(-1) ?? filePath;
  const rootLocalFrontendEnv = !filePath.includes('/')
    && /^\.env\.(?:local|development|test|development\.local|test\.local)$/.test(basename);
  const envExampleOrTemplate = /^\.env(?:[.-].*)?\.(?:example|sample|template)$/.test(basename)
    || /\.env\.(?:example|sample|template)$/.test(basename);

  return rootLocalFrontendEnv || envExampleOrTemplate;
}

function isDesignSystemPath(filePath: string): boolean {
  return filePath === 'DESIGN.md'
    || filePath.startsWith('docs/UXUI/')
    || filePath === 'src/app/globals.css'
    || filePath.startsWith('src/components/ui/')
    || /^tailwind\.config\.[cm]?[jt]s$/.test(filePath)
    || /^postcss\.config\.[cm]?[jt]s$/.test(filePath)
    || filePath === 'components.json';
}

function isDocsOnlyPath(filePath: string): boolean {
  if (
    isDesignSystemPath(filePath)
    || isReleaseDeployPath(filePath)
    || isUnifiedDeployPath(filePath)
  ) {
    return false;
  }

  return filePath === 'README.md'
    || filePath === 'DEVELOPMENT.md'
    || /^marketing\/.*\.md$/u.test(filePath)
    || /^docs\/(?:user-guides|testing|engineering)\/.*\.md$/u.test(filePath)
    || filePath === 'docs/current-engineering-governance-model.md'
    || filePath === 'docs/项目宪法.md';
}

function levelsForGoal(goal: VerificationGoal): readonly VerificationLevel[] {
  if (goal === 'debug') {
    return ['V0'];
  }
  if (goal === 'visual') {
    return ['V0', 'V1', 'V2'];
  }
  if (goal === 'release-real') {
    return ['V3'];
  }
  if (goal === 'real') {
    return ['V0', 'V1', 'V3'];
  }
  return ['V0', 'V1'];
}

function commandsForLevels(levels: Iterable<VerificationLevel>): readonly string[] {
  const selected = new Set(levels);
  const commands = new Set<string>();
  if (selected.has('V0')) {
    commands.add('npm run verify:quick');
  }
  if (selected.has('V1')) {
    commands.add('npm run verify:default');
  }
  if (selected.has('V2')) {
    commands.add('npm run verify:visual');
  }
  if (selected.has('V3')) {
    commands.add(REAL_VERIFY_COMMAND);
  }
  return orderedCommands(commands);
}

function evidenceForLevels(levels: Iterable<VerificationLevel>): string[] {
  const selected = new Set(levels);
  const evidence: string[] = [];
  if (selected.has('V0')) {
    evidence.push('fast gate result');
  }
  if (selected.has('V1')) {
    evidence.push('default gate result');
  }
  if (selected.has('V2')) {
    evidence.push('visual full catalog evidence');
  }
  if (selected.has('V3')) {
    evidence.push('backend-real ux_trace_bundle evidence');
  }
  if (selected.has('V4')) {
    evidence.push('release-ready owner review evidence (not evaluated by this report)');
  }
  return evidence;
}

function levelsForStory(story: VerificationCatalogStory): readonly VerificationLevel[] {
  return story.requiredLevels;
}

function levelsWithStoryPolicyFloor(
  levels: readonly VerificationLevel[],
  story: VerificationCatalogStory,
): readonly VerificationLevel[] {
  if (levels.includes('V4')) {
    // V4 release/deploy operator review already dominates lower story policy floors.
    return levels;
  }
  return orderedLevels([...levels, ...story.riskPolicyLevelFloor]);
}

function createAccumulator(): ImpactAccumulator {
  return {
    levels: new Set<VerificationLevel>(),
    commands: new Set<string>(),
    surfaces: new Set<string>(),
    reasons: [],
    warnings: [],
    storyCards: new Map<string, MutableStoryCard>(),
    changedFileImpacts: new Map<string, MutableChangedFileImpact>(),
    manualReviewRequired: false,
    broadImpact: false,
    nextActions: [],
  };
}

function addLevels(accumulator: ImpactAccumulator, levels: readonly VerificationLevel[]): void {
  for (const level of levels) {
    accumulator.levels.add(level);
  }
  for (const command of commandsForLevels(levels)) {
    accumulator.commands.add(command);
  }
}

function pushUnique(values: string[], value: string): void {
  if (values.includes(value)) {
    return;
  }
  values.push(value);
}

function nextActionPriority(action: string): number {
  if (action.includes('changed-file detection failed')) {
    return 0;
  }
  if (action.includes('npm run release:ready') || action.includes('Release or deploy path changed')) {
    return 1;
  }
  if (action.includes('Manual impact owner triage')) {
    return 2;
  }
  if (action.includes('runner, Context Store, and credential owner review')) {
    return 3;
  }
  if (
    action.includes(GOVERNED_RELEASE_REAL_VERIFY_COMMAND)
    || action.includes('npm run verify:release-real')
  ) {
    return 4;
  }
  if (action.includes('Manual story review')) {
    return 5;
  }
  if (
    action.includes(GOVERNED_REAL_VERIFY_COMMAND)
    || action.includes('npm run verify:real')
  ) {
    return 6;
  }
  if (action.includes('npm run verify:visual')) {
    return 7;
  }
  return 8;
}

function orderedNextActions(values: readonly string[]): string[] {
  return values
    .map((action, index) => ({ action, index, priority: nextActionPriority(action) }))
    .sort((left, right) => (
      left.priority - right.priority
      || left.index - right.index
      || left.action.localeCompare(right.action)
    ))
    .map((entry) => entry.action);
}

function storyImpactSourceKey(source: VerificationStoryImpactSource): string {
  return [
    source.changedFile,
    source.rule,
    source.surface,
    source.action,
    source.manualReviewRequired ? 'manual' : 'automatic',
    source.broadImpact ? 'broad' : 'targeted',
  ].join('\0');
}

function addStoryImpactSource(
  card: MutableStoryCard,
  source: VerificationStoryImpactSource | undefined,
): void {
  if (!source) {
    return;
  }
  card.impactSources.set(storyImpactSourceKey(source), source);
}

function orderedStoryImpactSources(
  sources: Iterable<VerificationStoryImpactSource>,
): VerificationStoryImpactSource[] {
  return [...sources].sort((left, right) => (
    left.changedFile.localeCompare(right.changedFile)
    || IMPACT_RULE_ORDER.indexOf(left.rule) - IMPACT_RULE_ORDER.indexOf(right.rule)
    || left.surface.localeCompare(right.surface)
    || left.action.localeCompare(right.action)
  ));
}

function recordChangedFileImpact(
  accumulator: ImpactAccumulator,
  args: {
    changedFile: string;
    rule: ChangedFileImpactRule;
    surfaces: readonly string[];
    storyIds: readonly string[];
    action: string;
    manualReviewRequired: boolean;
    broadImpact: boolean;
  },
): void {
  const existing = accumulator.changedFileImpacts.get(args.changedFile) ?? {
    changedFile: args.changedFile,
    matchedRules: new Set<ChangedFileImpactRule>(),
    affectedSurfaces: new Set<string>(),
    storyIds: new Set<string>(),
    actions: [],
    manualReviewRequired: false,
    broadImpact: false,
  };

  existing.matchedRules.add(args.rule);
  for (const surface of args.surfaces) {
    existing.affectedSurfaces.add(surface);
  }
  for (const storyId of args.storyIds) {
    existing.storyIds.add(storyId);
  }
  pushUnique(existing.actions, args.action);
  existing.manualReviewRequired = existing.manualReviewRequired || args.manualReviewRequired;
  existing.broadImpact = existing.broadImpact || args.broadImpact;
  accumulator.changedFileImpacts.set(args.changedFile, existing);
}

function changedFileImpactToImmutable(impact: MutableChangedFileImpact): VerificationChangedFileImpact {
  return {
    changedFile: impact.changedFile,
    matchedRules: orderedImpactRules(impact.matchedRules),
    affectedSurfaces: uniqueSorted(impact.affectedSurfaces),
    storyIds: uniqueSorted(impact.storyIds),
    action: orderedNextActions(impact.actions)[0] ?? 'Review changed-file impact selection with the verification owner.',
    manualReviewRequired: impact.manualReviewRequired,
    broadImpact: impact.broadImpact,
  };
}

function addStoryCard(
  accumulator: ImpactAccumulator,
  story: VerificationCatalogStory,
  args: {
    risk: StoryCardRisk;
    levels: readonly VerificationLevel[];
    evidenceStatus: StoryEvidenceStatus;
    manualReviewReasons?: readonly StoryManualReviewReason[];
    nextAction: string;
    impactSource?: VerificationStoryImpactSource;
    applyPolicyLevelFloor?: boolean;
  },
): void {
  const levels = args.applyPolicyLevelFloor === false
    ? args.levels
    : levelsWithStoryPolicyFloor(args.levels, story);
  if (args.manualReviewReasons && args.manualReviewReasons.length > 0) {
    accumulator.manualReviewRequired = true;
  }

  const existing = accumulator.storyCards.get(story.storyId);
  if (existing) {
    for (const level of levels) {
      existing.requiredLevels.add(level);
    }
    for (const level of story.riskPolicyLevelFloor) {
      existing.riskPolicyLevelFloor.add(level);
    }
    for (const reason of args.manualReviewReasons ?? []) {
      existing.manualReviewReasons.add(reason);
    }
    if (existing.risk === 'inferred' && args.risk === 'required') {
      existing.risk = 'required';
    }
    if (existing.evidenceStatus === 'not_evaluated' && args.evidenceStatus === 'missing') {
      existing.evidenceStatus = 'missing';
    }
    pushUnique(existing.nextActions, args.nextAction);
    addStoryImpactSource(existing, args.impactSource);
    return;
  }

  accumulator.storyCards.set(story.storyId, {
    storyId: story.storyId,
    title: story.title,
    personas: story.personas,
    family: story.family,
    lane: story.lane,
    sourceFile: story.sourceFile,
    risk: args.risk,
    riskPolicyRefs: story.riskPolicyRefs,
    riskPolicySource: story.riskPolicySource,
    riskPolicyRiskFloor: story.riskPolicyRiskFloor,
    riskPolicyLevelFloor: new Set(story.riskPolicyLevelFloor),
    requiredLevels: new Set(levels),
    evidenceStatus: args.evidenceStatus,
    manualReviewReasons: new Set(args.manualReviewReasons ?? []),
    impactSources: new Map<string, VerificationStoryImpactSource>(
      args.impactSource ? [[storyImpactSourceKey(args.impactSource), args.impactSource]] : [],
    ),
    nextActions: [args.nextAction],
  });
}

function addBroadStoryCards(
  accumulator: ImpactAccumulator,
  stories: readonly VerificationCatalogStory[],
  args: {
    levels?: readonly VerificationLevel[];
    nextAction: string;
    evidenceStatus?: StoryEvidenceStatus;
    manualReviewReasons?: readonly StoryManualReviewReason[];
    impactSource?: VerificationStoryImpactSource;
  },
): void {
  accumulator.broadImpact = true;
  for (const story of stories) {
    const levels = args.levels
      ? levelsWithStoryPolicyFloor(args.levels, story)
      : levelsForStory(story);
    addLevels(accumulator, levels);
    addStoryCard(accumulator, story, {
      risk: 'inferred',
      levels,
      evidenceStatus: args.evidenceStatus ?? 'missing',
      manualReviewReasons: args.manualReviewReasons,
      nextAction: args.nextAction,
      impactSource: args.impactSource,
    });
  }
}

function buildStorySourceMap(catalog: VerificationCatalog): Map<string, VerificationCatalogStory> {
  const map = new Map<string, VerificationCatalogStory>();
  for (const [sourceFile, storyId] of Object.entries(catalog.story_source_file_map)) {
    const story = catalog.story_by_id[storyId];
    if (story) {
      map.set(normalizeRepoPath(sourceFile), story);
    }
  }
  return map;
}

function findVisualMatches(
  filePath: string,
  catalog: VerificationCatalog,
): readonly VerificationCatalogVisualCodeRefMapping[] {
  return catalog.visual_code_ref_map[filePath] ?? [];
}

function findTraceSpecMatches(
  filePath: string,
  catalog: VerificationCatalog,
): readonly VerificationCatalog['trace_spec_story_map']['entries'][number][] {
  return catalog.trace_spec_story_map.entries.filter((entry) => entry.specFile === filePath);
}

function moreSevereRiskLevel(left: StoryRiskLevel, right: StoryRiskLevel): StoryRiskLevel {
  return RISK_LEVEL_ORDER.indexOf(left) <= RISK_LEVEL_ORDER.indexOf(right) ? left : right;
}

function deriveRiskLevel(card: MutableStoryCard, requiredLevels: readonly VerificationLevel[]): StoryRiskLevel {
  let inferredRiskLevel: StoryRiskLevel = 'R3';
  if (requiredLevels.includes('V4')) {
    inferredRiskLevel = 'R0';
  } else if (card.lane === 'backend-real' && requiredLevels.includes('V3')) {
    inferredRiskLevel = 'R1';
  } else if (requiredLevels.includes('V2')) {
    inferredRiskLevel = 'R2';
  }
  return moreSevereRiskLevel(card.riskPolicyRiskFloor, inferredRiskLevel);
}

function riskPolicyReasonForCard(card: MutableStoryCard): string {
  return `risk policy sidecar ${card.riskPolicySource} refs ${card.riskPolicyRefs.join(', ')} set ${card.riskPolicyRiskFloor}/${orderedLevels(card.riskPolicyLevelFloor).join(', ')} floor.`;
}

function riskReasonForCard(
  card: MutableStoryCard,
  riskLevel: StoryRiskLevel,
  requiredLevels: readonly VerificationLevel[],
  context: EvidenceCardBuildContext,
): string {
  const prefix = card.risk === 'inferred'
    ? 'Risk inferred fail-closed from required levels'
    : 'Risk required by mapped story impact';
  const policyReason = riskPolicyReasonForCard(card);

  if (riskLevel === 'R0') {
    if (requiredLevels.includes('V4')) {
      return `${prefix}: V4 release/deploy story card requires operator review; verify report is not release readiness. ${policyReason}`;
    }
    if (
      releaseRealDiagnosticSelected(context)
      && requiredLevels.length === 1
      && requiredLevels[0] === 'V3'
    ) {
      return `${prefix}: release-real owner diagnostic stays V3-only; policy floor is retained as a risk note and this report is not release readiness. ${policyReason}`;
    }
    return `${prefix}: R0 governance policy floor requires full V0/V1/V2/V3 evidence selection; verify report did not inspect evidence. ${policyReason}`;
  }
  if (riskLevel === 'R1') {
    return `${prefix}: backend-real story requires V3 verification; verify report did not inspect evidence. ${policyReason}`;
  }
  if (riskLevel === 'R2') {
    return `${prefix}: mock-lane/visual story requires V2 visual review; verify report did not inspect evidence. ${policyReason}`;
  }
  return `${prefix}: debug/V0-only impact requires basic verification; verify report did not inspect evidence. ${policyReason}`;
}

function manualReviewReasonForLevel(
  level: VerificationLevel,
  manualReviewReasons: ReadonlySet<StoryManualReviewReason>,
): string | undefined {
  if (level === 'V2' && manualReviewReasons.has(MANUAL_REVIEW_REASONS.visualV2NeedsReview)) {
    return 'Visual V2 needs review; verify report did not inspect visual evidence.';
  }
  if (manualReviewReasons.has(MANUAL_REVIEW_REASONS.releaseDeployOperatorReview)) {
    return 'Release/deploy operator review required; verify report did not inspect release evidence.';
  }
  if (manualReviewReasons.has(MANUAL_REVIEW_REASONS.runnerContextCredentialOwnerReview)) {
    return 'Runner, Context Store, or credential owner review required; verify report did not inspect backend-real evidence.';
  }
  if (manualReviewReasons.has(MANUAL_REVIEW_REASONS.generatedSpecsDerivedCacheDrift)) {
    return 'Generated story specs are derived cache drift; verify report selected story impact fail-closed.';
  }
  if (manualReviewReasons.has(MANUAL_REVIEW_REASONS.unmappedSource)) {
    return 'Unmapped source impact selected fail-closed; verify report did not inspect evidence.';
  }
  if (manualReviewReasons.has(MANUAL_REVIEW_REASONS.changeDetectionFailure)) {
    return 'Change detection failure selected story impact fail-closed; verify report did not inspect evidence.';
  }
  if (manualReviewReasons.has(MANUAL_REVIEW_REASONS.storyMarkdownChanged)) {
    return 'Canonical story markdown changed; manual story review is required before evidence acceptance.';
  }
  return undefined;
}

function levelStatusForCard(
  card: MutableStoryCard,
  requiredLevels: readonly VerificationLevel[],
): readonly StoryLevelStatus[] {
  return requiredLevels.map((level) => {
    const manualReviewReason = manualReviewReasonForLevel(level, card.manualReviewReasons);
    if (manualReviewReason) {
      return {
        level,
        status: 'manual_review_needed',
        reason: manualReviewReason,
      };
    }
    if (card.evidenceStatus === 'missing') {
      return {
        level,
        status: 'missing',
        reason: `Required ${level} evidence was not inspected by verify report; artifact path is unavailable.`,
      };
    }
    return {
      level,
      status: 'not_evaluated',
      reason: `Required ${level} evidence was not inspected by verify report.`,
    };
  });
}

function latestEvidenceForCard(
  card: MutableStoryCard,
  requiredLevels: readonly VerificationLevel[],
): StoryLatestEvidence {
  let owner = 'verification owner';
  if (requiredLevels.includes('V4')) {
    owner = 'release/deploy operator';
  } else if (card.lane === 'backend-real' && requiredLevels.includes('V3')) {
    owner = 'backend-real owner';
  } else if (requiredLevels.includes('V2')) {
    owner = 'visual review owner';
  }

  return {
    state: 'not_inspected_by_verify_report',
    owner,
    artifactPath: null,
  };
}

type EvidenceCardBuildContext = {
  goal: VerificationGoal;
  recommendedCommands: readonly string[];
  catalog: VerificationCatalog;
};

type EvidenceTemplateResolution = {
  artifactPathTemplate: string | null;
  additionalArtifactPathTemplates: readonly string[];
  artifactPathTemplateReason: string | null;
};

function releaseRealDiagnosticSelected(context: EvidenceCardBuildContext): boolean {
  return context.goal === 'release-real'
    && context.recommendedCommands.includes('npm run verify:release-real');
}

function evidenceTemplateForLevel(
  level: VerificationLevel,
  context: EvidenceCardBuildContext,
): EvidenceTemplateResolution {
  const projection = evidenceProjectionForLevel({
    catalog: context.catalog,
    level,
    releaseRealDiagnostic: releaseRealDiagnosticSelected(context),
  });
  return {
    artifactPathTemplate: projection.artifactPathTemplate,
    additionalArtifactPathTemplates: projection.additionalArtifactPathTemplates,
    artifactPathTemplateReason: projection.artifactPathTemplateReason,
  };
}

function evidenceOwnerForLevel(level: VerificationLevel, context: EvidenceCardBuildContext): string {
  const owner = evidenceProjectionForLevel({
    catalog: context.catalog,
    level,
    releaseRealDiagnostic: releaseRealDiagnosticSelected(context),
  }).owner;
  return publicGovernedVerifyCommandForInternalAlias(owner);
}

function evidenceNoteForLevel(level: VerificationLevel): string {
  if (level === 'V4') {
    return 'Report-only pointer to release:ready campaign evidence; this report is not a release verdict.';
  }
  return 'Report-only pointer to producer-owned evidence; verify report did not inspect this artifact.';
}

function evidenceCardsForCard(
  levelStatuses: readonly StoryLevelStatus[],
  context: EvidenceCardBuildContext,
): readonly StoryEvidenceCard[] {
  return levelStatuses.map((levelStatus) => {
    const template = evidenceTemplateForLevel(levelStatus.level, context);
    return {
      level: levelStatus.level,
      state: 'not_inspected_by_verify_report',
      status: levelStatus.status,
      owner: evidenceOwnerForLevel(levelStatus.level, context),
      artifactPath: null,
      artifactPathTemplate: template.artifactPathTemplate,
      additionalArtifactPathTemplates: template.additionalArtifactPathTemplates,
      artifactPathTemplateReason: template.artifactPathTemplateReason,
      note: evidenceNoteForLevel(levelStatus.level),
    };
  });
}

function storyCardToImmutable(card: MutableStoryCard, context: EvidenceCardBuildContext): VerificationStoryCard {
  const requiredLevels = orderedLevels(card.requiredLevels);
  const riskLevel = deriveRiskLevel(card, requiredLevels);
  const manualReviewReasons = orderedManualReviewReasons(card.manualReviewReasons);
  const manualReviewRequired = manualReviewReasons.length > 0;
  const status: StoryEvaluationStatus = manualReviewRequired ? 'manual_review_needed' : card.evidenceStatus;
  const levelStatuses = levelStatusForCard(card, requiredLevels);
  const nextAction = orderedNextActions(card.nextActions).join(' ');
  const {
    requiredLevels: _requiredLevels,
    riskPolicyRiskFloor: _riskPolicyRiskFloor,
    riskPolicyLevelFloor: _riskPolicyLevelFloor,
    manualReviewReasons: _manualReviewReasons,
    impactSources: _impactSources,
    nextActions: _nextActions,
    ...cardFields
  } = card;
  void _requiredLevels;
  void _riskPolicyRiskFloor;
  void _riskPolicyLevelFloor;
  void _manualReviewReasons;
  void _impactSources;
  void _nextActions;

  return {
    ...cardFields,
    riskLevel,
    riskReason: riskReasonForCard(card, riskLevel, requiredLevels, context),
    requiredLevels,
    status,
    failureReason: null,
    manualReviewRequired,
    manualReviewReasons,
    levelStatuses,
    latestEvidence: latestEvidenceForCard(card, requiredLevels),
    evidenceCards: evidenceCardsForCard(levelStatuses, context),
    impactSources: orderedStoryImpactSources(card.impactSources.values()),
    nextAction,
  };
}

function defaultNextAction(levels: readonly VerificationLevel[]): string {
  if (levels.includes('V4')) {
    return 'Release or deploy path changed. Use npm run release:ready as the next release operation outside this verification report; this report is not a release verdict.';
  }
  if (levels.includes('V3')) {
    return `Run ${GOVERNED_REAL_VERIFY_COMMAND} after reviewing the fail-closed impact selection.`;
  }
  if (levels.includes('V2')) {
    return 'Run npm run verify:visual after reviewing affected visual story cards.';
  }
  return 'Run the governed verification entrypoint after reviewing the plan.';
}

function addGoalDefaults(accumulator: ImpactAccumulator, goal: VerificationGoal): void {
  const levels = levelsForGoal(goal);
  if (goal === 'release-real') {
    for (const level of levels) {
      accumulator.levels.add(level);
    }
    accumulator.commands.add(RELEASE_REAL_VERIFY_COMMAND);
  } else {
    addLevels(accumulator, levels);
  }
  pushUnique(accumulator.reasons, `goal:${goal} default verification levels selected`);
  pushUnique(
    accumulator.nextActions,
    goal === 'release-real'
      ? `Run ${PUBLIC_RELEASE_READY_COMMAND} for release backend-real owner coverage; this report is not a release verdict until ${PUBLIC_RELEASE_READY_COMMAND} runs.`
      : defaultNextAction(levels),
  );
}

export function buildVerificationPlan(input: BuildVerificationPlanInput = {}): VerificationPlan {
  const goal = input.goal ?? 'pr';
  const mode: VerificationMode = input.run ? 'run' : 'dry-run';
  const catalog = input.catalog ?? buildVerificationCatalog({
    generatedAt: input.generatedAt,
    stories: input.stories,
    visualCatalogEntries: input.visualCatalogEntries,
  });
  const generatedAt = input.generatedAt ?? catalog.provenance.generated_at;
  const stories = catalog.stories;
  const changedFiles = uniqueSorted((input.changedFiles ?? []).map(normalizeRepoPath).filter(Boolean));
  const storyBySourceFile = buildStorySourceMap(catalog);
  const accumulator = createAccumulator();
  const releaseRealDiagnosticGoal = goal === 'release-real' && input.goalExplicit;
  for (const warning of input.changeDetectionWarnings ?? []) {
    pushUnique(accumulator.warnings, warning);
  }

  if (input.changeDetectionFailure) {
    accumulator.surfaces.add('change-detection-failed');
    accumulator.broadImpact = true;
    accumulator.manualReviewRequired = true;
    accumulator.warnings.push(`Changed-file detection failed: ${input.changeDetectionFailure}`);
    accumulator.reasons.push('Changed files could not be derived, so all canonical stories are treated as potentially affected.');
    const action = 'Manual impact owner triage required because changed-file detection failed; rerun with --changed-file for a narrower plan.';
    pushUnique(accumulator.nextActions, action);
    addBroadStoryCards(accumulator, stories, {
      nextAction: action,
      manualReviewReasons: [MANUAL_REVIEW_REASONS.changeDetectionFailure],
    });
  }

  if (changedFiles.length === 0 && !input.changeDetectionFailure) {
    addGoalDefaults(accumulator, goal);
    accumulator.surfaces.add('goal-default');
    accumulator.reasons.push('No changed files were provided or detected; using the goal-level default verification plan.');
  }

  for (const changedFile of changedFiles) {
    let mapped = false;

    const exactStory = storyBySourceFile.get(changedFile);
    if (exactStory) {
      mapped = true;
      const releaseRealDiagnosticStoryImpact = releaseRealDiagnosticGoal && isReleaseRealDiagnosticStory(exactStory);
      const levels: readonly VerificationLevel[] = releaseRealDiagnosticStoryImpact ? ['V3'] : levelsForStory(exactStory);
      const action = releaseRealDiagnosticStoryImpact
        ? `Manual story review required because canonical story markdown changed; then run ${PUBLIC_RELEASE_READY_COMMAND} for release backend-real owner coverage; this report is not a release verdict until ${PUBLIC_RELEASE_READY_COMMAND} runs.`
        : 'Manual story review required because canonical story markdown changed; then run the governed verification entrypoint.';
      const surface = `story:${exactStory.storyId}`;
      const impactSource: VerificationStoryImpactSource = {
        changedFile,
        rule: 'canonical_story_markdown',
        surface,
        action,
        manualReviewRequired: true,
        broadImpact: false,
      };
      if (releaseRealDiagnosticStoryImpact) {
        accumulator.levels.add('V3');
      } else {
        addLevels(accumulator, levels);
      }
      accumulator.surfaces.add(surface);
      accumulator.manualReviewRequired = true;
      accumulator.reasons.push(`${changedFile} is canonical story markdown for ${exactStory.storyId}.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'canonical_story_markdown',
        surfaces: [surface],
        storyIds: [exactStory.storyId],
        action,
        manualReviewRequired: true,
        broadImpact: false,
      });
      addStoryCard(accumulator, exactStory, {
        risk: 'required',
        levels,
        evidenceStatus: 'not_evaluated',
        manualReviewReasons: [MANUAL_REVIEW_REASONS.storyMarkdownChanged],
        nextAction: action,
        impactSource,
        applyPolicyLevelFloor: !releaseRealDiagnosticStoryImpact,
      });
    }

    if (isGeneratedStorySpec(changedFile, catalog)) {
      mapped = true;
      const action = 'Manual impact owner triage required because generated story specs are derived cache, not canonical story truth.';
      const surface = 'derived-cache:story-specs';
      const storyIds = stories.map((story) => story.storyId);
      const impactSource: VerificationStoryImpactSource = {
        changedFile,
        rule: 'generated_story_specs_derived_cache',
        surface,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      };
      accumulator.surfaces.add(surface);
      accumulator.broadImpact = true;
      accumulator.manualReviewRequired = true;
      accumulator.warnings.push('Generated story spec changed as derived cache drift; canonical story truth remains e2e/stories/**/*.story.md.');
      accumulator.reasons.push(`${changedFile} is derived cache and is not used as story truth.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'generated_story_specs_derived_cache',
        surfaces: [surface],
        storyIds,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      });
      addBroadStoryCards(accumulator, stories, {
        nextAction: action,
        manualReviewReasons: [MANUAL_REVIEW_REASONS.generatedSpecsDerivedCacheDrift],
        impactSource,
      });
    }

    if (isPackageJsonSafeGovernanceToolingChange(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1'];
      const action = 'Run npm run verify -- --goal=pr --run for the package.json governance or mock-lane npm script change; heavy visual/backend-real evidence is not selected by this impact report.';
      const surface = 'engineering-governance-tooling';
      addLevels(accumulator, levels);
      accumulator.surfaces.add(surface);
      accumulator.reasons.push(`${changedFile} only changes safe governance or mock-lane npm scripts.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'governance_tooling',
        surfaces: [surface],
        storyIds: [],
        action,
        manualReviewRequired: false,
        broadImpact: false,
      });
    }

    if (isEnvOnlyConfigurationPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1'];
      const action = 'Run npm run verify -- --goal=pr --run for the env-only configuration change.';
      const surface = 'env-only-configuration';
      addLevels(accumulator, levels);
      accumulator.surfaces.add(surface);
      accumulator.reasons.push(`${changedFile} is env-only configuration; V0/V1 verification is selected without visual or backend-real expansion.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'env_only_configuration',
        surfaces: [surface],
        storyIds: [],
        action,
        manualReviewRequired: false,
        broadImpact: false,
      });
    }

    if (isDesignSystemPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V2'];
      const action = 'Run npm run verify:visual and review the full mock-lane visual catalog before accepting the design-system impact.';
      const surface = 'design-system';
      const impactedStories = stories.filter((story) => (
        story.lane === 'mock-lane' && story.visualScenarioIds.length > 0
      ));
      const storyIds = impactedStories.map((story) => story.storyId);
      const impactSource: VerificationStoryImpactSource = {
        changedFile,
        rule: 'design_system',
        surface,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      };
      addLevels(accumulator, levels);
      accumulator.surfaces.add(surface);
      accumulator.broadImpact = true;
      accumulator.manualReviewRequired = true;
      accumulator.reasons.push(`${changedFile} touches design-system truth; full mock-lane visual verification is selected with story policy floors retained.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'design_system',
        surfaces: [surface],
        storyIds,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      });
      for (const story of impactedStories) {
        const storyLevels = levelsWithStoryPolicyFloor(levels, story);
        addLevels(accumulator, storyLevels);
        addStoryCard(accumulator, story, {
          risk: 'inferred',
          levels: storyLevels,
          evidenceStatus: 'not_evaluated',
          manualReviewReasons: [MANUAL_REVIEW_REASONS.visualV2NeedsReview],
          nextAction: action,
          impactSource,
        });
      }
    }

    const visualMatches = findVisualMatches(changedFile, catalog);
    if (visualMatches.length > 0) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V2'];
      const action = 'Run npm run verify:visual and review affected visual story cards before accepting the UI impact.';
      addLevels(accumulator, levels);
      accumulator.manualReviewRequired = true;
      accumulator.reasons.push(`${changedFile} matches ${visualMatches.length} visual catalog code ref(s).`);
      pushUnique(accumulator.nextActions, action);
      for (const match of visualMatches) {
        accumulator.surfaces.add(match.surface);
        const story = catalog.story_by_id[match.storyId];
        recordChangedFileImpact(accumulator, {
          changedFile,
          rule: 'visual_code_ref',
          surfaces: [match.surface],
          storyIds: [match.storyId],
          action,
          manualReviewRequired: true,
          broadImpact: false,
        });
        if (story) {
          const storyLevels = levelsWithStoryPolicyFloor(levels, story);
          addLevels(accumulator, storyLevels);
          addStoryCard(accumulator, story, {
            risk: 'required',
            levels: storyLevels,
            evidenceStatus: 'not_evaluated',
            manualReviewReasons: [MANUAL_REVIEW_REASONS.visualV2NeedsReview],
            nextAction: action,
            impactSource: {
              changedFile,
              rule: 'visual_code_ref',
              surface: match.surface,
              action,
              manualReviewRequired: true,
              broadImpact: false,
            },
          });
        }
      }
    }

    const traceSpecMatches = findTraceSpecMatches(changedFile, catalog);
    if (traceSpecMatches.length > 0) {
      mapped = true;
      const action = 'Run the mapped story verification levels for this trace-bound integration spec before accepting the spec impact.';
      const surface = `trace-spec:${changedFile}`;
      accumulator.surfaces.add(surface);
      accumulator.reasons.push(`${changedFile} has ${traceSpecMatches.length} trace spec story binding(s).`);
      pushUnique(accumulator.nextActions, action);
      for (const match of traceSpecMatches) {
        const story = catalog.story_by_id[match.storyId];
        if (!story) {
          continue;
        }
        const levels = levelsForStory(story);
        addLevels(accumulator, levels);
        recordChangedFileImpact(accumulator, {
          changedFile,
          rule: 'trace_spec_story_binding',
          surfaces: [surface],
          storyIds: [story.storyId],
          action,
          manualReviewRequired: false,
          broadImpact: false,
        });
        addStoryCard(accumulator, story, {
          risk: 'required',
          levels,
          evidenceStatus: 'not_evaluated',
          nextAction: action,
          impactSource: {
            changedFile,
            rule: 'trace_spec_story_binding',
            surface,
            action,
            manualReviewRequired: false,
            broadImpact: false,
          },
        });
      }
    }

    if (isRunnerContextOrCredentialPath(changedFile)) {
      mapped = true;
      const action = `Run ${AGENT_TASK_RUNNER_FAST_COMMAND}, ${AGENT_TASK_RUNNER_BACKEND_REAL_COMMAND}, ${AGENT_TASK_INTEGRATION_COMMAND}, then ${GOVERNED_REAL_VERIFY_COMMAND} with runner, Context Store, and credential owner review (runner_context_credential).`;
      const surface = 'runner/context-store/credentials';
      const impactedStories = stories.filter((story) => story.lane === 'backend-real');
      const impactSource: VerificationStoryImpactSource = {
        changedFile,
        rule: 'runner_context_credential',
        surface,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      };
      accumulator.surfaces.add(surface);
      accumulator.broadImpact = true;
      accumulator.manualReviewRequired = true;
      accumulator.commands.add(AGENT_TASK_RUNNER_FAST_COMMAND);
      accumulator.commands.add(AGENT_TASK_RUNNER_BACKEND_REAL_COMMAND);
      accumulator.commands.add(AGENT_TASK_INTEGRATION_COMMAND);
      accumulator.reasons.push(`${changedFile} touches runner, Context Store, or credential behavior.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'runner_context_credential',
        surfaces: [surface],
        storyIds: impactedStories.map((story) => story.storyId),
        action,
        manualReviewRequired: true,
        broadImpact: true,
      });
      addBroadStoryCards(accumulator, impactedStories, {
        nextAction: action,
        manualReviewReasons: [MANUAL_REVIEW_REASONS.runnerContextCredentialOwnerReview],
        impactSource,
      });
    }

    if (isBackendRealDiagnosticToolingPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V3'];
      const action = `Run ${GOVERNED_REAL_VERIFY_COMMAND} with backend-real gate owner review (backend_real_diagnostic_tooling).`;
      const surface = 'backend-real-diagnostic-tooling';
      addLevels(accumulator, levels);
      accumulator.surfaces.add(surface);
      accumulator.broadImpact = true;
      accumulator.manualReviewRequired = true;
      accumulator.reasons.push(`${changedFile} touches backend-real gate or diagnostic tooling.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'backend_real_diagnostic_tooling',
        surfaces: [surface],
        storyIds: [],
        action,
        manualReviewRequired: true,
        broadImpact: true,
      });
    }

    if (isReleaseRealOwnerDiagnosticPath(changedFile)) {
      mapped = true;
      const action = `Run ${PUBLIC_RELEASE_READY_COMMAND} for release backend-real owner coverage; this report is not a release verdict until ${PUBLIC_RELEASE_READY_COMMAND} runs.`;
      const surface = 'release-real-owner';
      accumulator.levels.add('V3');
      accumulator.commands.add(RELEASE_REAL_VERIFY_COMMAND);
      accumulator.surfaces.add(surface);
      accumulator.reasons.push(`${changedFile} owns the backend-real release diagnostic gate.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'release_real_owner_diagnostic',
        surfaces: [surface],
        storyIds: [],
        action,
        manualReviewRequired: false,
        broadImpact: false,
      });
    }

    if (isReleaseDeployPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V4'];
      const action = 'Release or deploy path changed. Use npm run release:ready as the next release operation outside this verification report; this report is not a release verdict.';
      const surface = 'release/deploy';
      const storyIds = stories.map((story) => story.storyId);
      const impactSource: VerificationStoryImpactSource = {
        changedFile,
        rule: 'release_deploy_operations',
        surface,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      };
      addLevels(accumulator, levels);
      if (isUnifiedDeployPath(changedFile)) {
        accumulator.commands.add(UNIFIED_DEPLOY_UNIT_COMMAND);
      }
      accumulator.surfaces.add(surface);
      accumulator.broadImpact = true;
      accumulator.manualReviewRequired = true;
      accumulator.reasons.push(`${changedFile} touches release or deploy operations.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'release_deploy_operations',
        surfaces: [surface],
        storyIds,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      });
      addBroadStoryCards(accumulator, stories, {
        levels,
        nextAction: action,
        evidenceStatus: 'missing',
        manualReviewReasons: [MANUAL_REVIEW_REASONS.releaseDeployOperatorReview],
        impactSource,
      });
    }

    if (isGovernanceToolingPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1'];
      const action = 'Run npm run verify -- --goal=pr --run for the governance tooling change; heavy visual/backend-real evidence is not selected by this impact report.';
      const surface = 'engineering-governance-tooling';
      addLevels(accumulator, levels);
      accumulator.surfaces.add(surface);
      accumulator.reasons.push(`${changedFile} touches governance verification tooling.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'governance_tooling',
        surfaces: [surface],
        storyIds: [],
        action,
        manualReviewRequired: false,
        broadImpact: false,
      });
    }

    if (isDocsOnlyPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1'];
      const action = 'Run npm run verify -- --goal=pr --run for the docs-only change; heavy visual/backend-real evidence is not selected by this impact report.';
      const surface = 'docs-only';
      addLevels(accumulator, levels);
      accumulator.surfaces.add(surface);
      accumulator.reasons.push(`${changedFile} is docs-only; V0/V1 verification is selected without visual or backend-real expansion.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'docs_only',
        surfaces: [surface],
        storyIds: [],
        action,
        manualReviewRequired: false,
        broadImpact: false,
      });
    }

    if (!mapped) {
      const action = 'Manual impact owner triage required; treat all canonical stories as potentially affected until the source path is mapped.';
      const surface = 'unmapped-source';
      const storyIds = stories.map((story) => story.storyId);
      const impactSource: VerificationStoryImpactSource = {
        changedFile,
        rule: 'unmapped_source',
        surface,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      };
      accumulator.surfaces.add(surface);
      accumulator.broadImpact = true;
      accumulator.manualReviewRequired = true;
      accumulator.warnings.push(`${changedFile} did not match canonical story markdown, visual code refs, runner/context/credential paths, release paths, or governance tooling paths.`);
      accumulator.reasons.push(`${changedFile} is unmapped source impact.`);
      pushUnique(accumulator.nextActions, action);
      recordChangedFileImpact(accumulator, {
        changedFile,
        rule: 'unmapped_source',
        surfaces: [surface],
        storyIds,
        action,
        manualReviewRequired: true,
        broadImpact: true,
      });
      addBroadStoryCards(accumulator, stories, {
        nextAction: action,
        manualReviewReasons: [MANUAL_REVIEW_REASONS.unmappedSource],
        impactSource,
      });
    }
  }

  if (changedFiles.length > 0 && goal !== 'pr' && input.goalExplicit) {
    if (goal === 'release-real' && accumulator.levels.has('V4')) {
      accumulator.reasons.push('Explicit release-real diagnostic goal was suppressed because V4 release/deploy impact requires release:ready operator review.');
    } else if (goal === 'real' && accumulator.levels.has('V4')) {
      accumulator.reasons.push('Explicit real goal defaults were suppressed because V4 release/deploy impact requires release:ready operator review.');
    } else {
      addGoalDefaults(accumulator, goal);
    }
  }

  const requiredLevels = orderedLevels(accumulator.levels);
  const recommendedCommands = orderedCommands(accumulator.commands);
  const runContractFailure = verificationRunContractFailure({
    goal,
    goalExplicit: input.goalExplicit,
    run: input.run,
    recommendedCommands,
  });
  if (runContractFailure) {
    pushUnique(accumulator.warnings, `Run contract blocked execution: ${runContractFailure}`);
  }
  const affectedSurfaces = uniqueSorted(accumulator.surfaces);
  const storyCards = [...accumulator.storyCards.values()]
    .map((card) => storyCardToImmutable(card, {
      goal,
      recommendedCommands,
      catalog,
    }))
    .sort((left, right) => left.storyId.localeCompare(right.storyId));
  const affectedStories = storyCards.length > 0
    ? storyCards.map((card) => card.storyId)
    : changedFiles.length === 0 && !input.changeDetectionFailure
      ? ['No changed files provided or detected; default goal-based verification plan.']
      : [`No story cards selected; mapped operational impact: ${affectedSurfaces.join(', ') || '<none>'}.`];
  const nextActions = orderedNextActions(
    accumulator.nextActions.length > 0 ? accumulator.nextActions : [defaultNextAction(requiredLevels)],
  );
  const nextAction = nextActions[0] ?? defaultNextAction(requiredLevels);
  const changedFileImpacts = [...accumulator.changedFileImpacts.values()]
    .map(changedFileImpactToImmutable)
    .sort((left, right) => left.changedFile.localeCompare(right.changedFile));
  const finalVerdict = mode === 'dry-run' || runContractFailure
    ? 'not_evaluated_fail_closed'
    : recommendedCommands.length > 0
      ? 'delegated_to_executed_verification_commands'
      : 'not_evaluated_next_action_required';

  return {
    goal,
    mode,
    risk: 'fail-closed',
    generatedAt,
    changedFiles,
    affectedStories,
    affectedSurfaces,
    requiredLevels,
    requiredEvidence: evidenceForLevels(requiredLevels),
    recommendedCommands,
    riskSummary: {
      posture: 'fail-closed',
      summary: accumulator.broadImpact
        ? 'Fail-closed broad impact selection; no evidence has been evaluated by this report.'
        : 'Fail-closed targeted impact selection; no evidence has been evaluated by this report.',
      reasons: accumulator.reasons,
      warnings: accumulator.warnings,
      manualReviewRequired: accumulator.manualReviewRequired,
      broadImpact: accumulator.broadImpact,
    },
    storyCards,
    changedFileImpacts,
    finalVerdict,
    nextAction,
    nextActions,
    reportRoot: input.reportRoot,
    releaseVerdict: false,
  };
}
