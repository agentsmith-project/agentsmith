import path from 'node:path';

import type { StoryDefinition } from '../../e2e/story-contract';
import {
  listVisualBaselineCatalogEntries,
  type VisualBaselineCatalogEntry,
} from '../../e2e/visual-baseline-support';
import { loadCommittedStoryDefinitionsSync } from '../story-catalog-support';

export type VerificationGoal = 'debug' | 'pr' | 'visual' | 'real' | 'release-real';
export type VerificationMode = 'dry-run' | 'run';
export type VerificationLevel = 'V0' | 'V1' | 'V2' | 'V3' | 'V4';
export type StoryCardRisk = 'required' | 'inferred';
export type StoryEvidenceStatus = 'not_evaluated' | 'missing';

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
  requiredLevels: readonly VerificationLevel[];
  evidenceStatus: StoryEvidenceStatus;
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
  finalVerdict: string;
  nextAction: string;
  reportRoot?: string;
  releaseVerdict: false;
}

export interface BuildVerificationPlanInput {
  goal?: VerificationGoal;
  goalExplicit?: boolean;
  run?: boolean;
  changedFiles?: readonly string[];
  changeDetectionFailure?: string;
  reportRoot?: string;
  generatedAt?: string;
  stories?: readonly StoryDefinition[];
  visualCatalogEntries?: readonly VisualBaselineCatalogEntry[];
}

type MutableStoryCard = Omit<VerificationStoryCard, 'requiredLevels'> & {
  requiredLevels: Set<VerificationLevel>;
};

type ImpactAccumulator = {
  levels: Set<VerificationLevel>;
  commands: Set<string>;
  surfaces: Set<string>;
  reasons: string[];
  warnings: string[];
  storyCards: Map<string, MutableStoryCard>;
  manualReviewRequired: boolean;
  broadImpact: boolean;
  nextActions: string[];
};

const LEVEL_ORDER: readonly VerificationLevel[] = ['V0', 'V1', 'V2', 'V3', 'V4'];
const COMMAND_ORDER = [
  'npm run verify:quick',
  'npm run verify:default',
  'npm run verify:visual',
  'npm run verify:real',
  'npm run verify:release-real',
] as const;

const GENERATED_STORY_SPEC_PATH = 'e2e/generated/story-specs.generated.json';

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function orderedLevels(values: Iterable<VerificationLevel>): VerificationLevel[] {
  const selected = new Set(values);
  return LEVEL_ORDER.filter((level) => selected.has(level));
}

function orderedCommands(values: Iterable<string>): string[] {
  const selected = new Set(values);
  const known = COMMAND_ORDER.filter((command) => selected.has(command));
  const unknown = [...selected]
    .filter((command) => !COMMAND_ORDER.includes(command as (typeof COMMAND_ORDER)[number]))
    .sort((left, right) => left.localeCompare(right));
  return [...known, ...unknown];
}

function normalizeRepoPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
  const relative = path.relative(process.cwd(), absolute).replace(/\\/g, '/');
  return relative.startsWith('../') ? normalized.replace(/^\.\//, '') : relative;
}

function isGeneratedStorySpec(filePath: string): boolean {
  return normalizeRepoPath(filePath) === GENERATED_STORY_SPEC_PATH;
}

function isRunnerContextOrCredentialPath(filePath: string): boolean {
  return [
    /^scripts\/run-external-runner-dev\.sh$/,
    /^scripts\/run-internal-notebook-real-gate\.sh$/,
    /^scripts\/notebook-/,
    /^scripts\/task-terminal/,
    /^scripts\/workspace-shared-context/,
    /^scripts\/.*credential/i,
    /^e2e\/integration-notebook-terminal/,
    /^src\/components\/context\//,
    /^src\/components\/credentials\//,
    /^src\/components\/notebook\//,
    /^src\/lib\/api\/endpoints\/context\.ts$/,
    /^src\/lib\/api\/endpoints\/credentials\.ts$/,
    /^src\/lib\/api\/types\/context\.ts$/,
    /^src\/lib\/api\/types\/notebook\.ts$/,
    /^src\/mocks\/handlers\/context\.ts$/,
    /^src\/mocks\/handlers\/credentials\.ts$/,
  ].some((pattern) => pattern.test(filePath));
}

function isReleaseDeployOrRehearsalPath(filePath: string): boolean {
  return [
    /^scripts\/cluster-deploy\//,
    /^scripts\/demo-deploy\//,
    /^scripts\/scenarios\//,
    /^scripts\/governance\/release/,
    /^scripts\/governance\/run-release/,
    /^scripts\/governance\/release-campaign/,
    /^scripts\/lib\/release-/,
    /^scripts\/lib\/deploy-/,
    /^scripts\/run-release-local-precheck\.sh$/,
    /^infra\/deploy\//,
    /^infra\/flows\//,
    /^e2e\/integration-release-user-story/,
    /^e2e\/release-user-story/,
    /^docs\/contracts\/.*release/i,
    /^docs\/contracts\/.*deployment/i,
    /^docs\/user-guides\/.*deploy/i,
    /^docs\/user-guides\/.*release/i,
  ].some((pattern) => pattern.test(filePath));
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
  return ['V0', 'V1', 'V3'];
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
    commands.add('npm run verify:real');
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

function levelsForStory(story: StoryDefinition): readonly VerificationLevel[] {
  if (story.lane === 'mock-lane' || story.gatePolicy.requiredEvidence.includes('visual')) {
    return ['V0', 'V1', 'V2'];
  }
  return ['V0', 'V1', 'V3'];
}

function createAccumulator(): ImpactAccumulator {
  return {
    levels: new Set<VerificationLevel>(),
    commands: new Set<string>(),
    surfaces: new Set<string>(),
    reasons: [],
    warnings: [],
    storyCards: new Map<string, MutableStoryCard>(),
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

function addStoryCard(
  accumulator: ImpactAccumulator,
  story: StoryDefinition,
  args: {
    risk: StoryCardRisk;
    levels: readonly VerificationLevel[];
    evidenceStatus: StoryEvidenceStatus;
    nextAction: string;
  },
): void {
  const existing = accumulator.storyCards.get(story.storyId);
  if (existing) {
    for (const level of args.levels) {
      existing.requiredLevels.add(level);
    }
    if (existing.risk === 'inferred' && args.risk === 'required') {
      existing.risk = 'required';
    }
    if (existing.evidenceStatus === 'not_evaluated' && args.evidenceStatus === 'missing') {
      existing.evidenceStatus = 'missing';
    }
    if (!existing.nextAction.includes(args.nextAction)) {
      existing.nextAction = `${existing.nextAction} ${args.nextAction}`;
    }
    return;
  }

  accumulator.storyCards.set(story.storyId, {
    storyId: story.storyId,
    title: story.title,
    personas: story.personas,
    family: story.family,
    lane: story.lane,
    sourceFile: story.sourceFile ?? normalizeRepoPath(story.filePath),
    risk: args.risk,
    requiredLevels: new Set(args.levels),
    evidenceStatus: args.evidenceStatus,
    nextAction: args.nextAction,
  });
}

function addBroadStoryCards(
  accumulator: ImpactAccumulator,
  stories: readonly StoryDefinition[],
  args: {
    levels: readonly VerificationLevel[];
    nextAction: string;
    evidenceStatus?: StoryEvidenceStatus;
  },
): void {
  accumulator.broadImpact = true;
  for (const story of stories) {
    addStoryCard(accumulator, story, {
      risk: 'inferred',
      levels: args.levels,
      evidenceStatus: args.evidenceStatus ?? 'missing',
      nextAction: args.nextAction,
    });
  }
}

function buildStorySourceMap(stories: readonly StoryDefinition[]): Map<string, StoryDefinition> {
  const map = new Map<string, StoryDefinition>();
  for (const story of stories) {
    map.set(normalizeRepoPath(story.sourceFile ?? story.filePath), story);
  }
  return map;
}

function findVisualMatches(
  filePath: string,
  visualCatalogEntries: readonly VisualBaselineCatalogEntry[],
): VisualBaselineCatalogEntry[] {
  return visualCatalogEntries.filter((entry) => (
    entry.codeRefs.some((codeRef) => normalizeRepoPath(codeRef) === filePath)
  ));
}

function storyCardToImmutable(card: MutableStoryCard): VerificationStoryCard {
  return {
    ...card,
    requiredLevels: orderedLevels(card.requiredLevels),
  };
}

function defaultNextAction(levels: readonly VerificationLevel[]): string {
  if (levels.includes('V4')) {
    return 'Release or deploy path changed. Use npm run release:ready as the next release operation outside this dry-run report; this report is not a release verdict.';
  }
  if (levels.includes('V3')) {
    return 'Run npm run verify:real after reviewing the fail-closed impact selection.';
  }
  if (levels.includes('V2')) {
    return 'Run npm run verify:visual after reviewing affected visual story cards.';
  }
  return 'Run the recommended verification aliases after reviewing the plan.';
}

function addGoalDefaults(accumulator: ImpactAccumulator, goal: VerificationGoal): void {
  const levels = levelsForGoal(goal);
  if (goal === 'release-real') {
    for (const level of levels) {
      accumulator.levels.add(level);
    }
    accumulator.commands.add('npm run verify:release-real');
  } else {
    addLevels(accumulator, levels);
  }
  pushUnique(accumulator.reasons, `goal:${goal} default verification levels selected`);
  pushUnique(
    accumulator.nextActions,
    goal === 'release-real'
      ? 'Run npm run verify:release-real as a release backend-real owner diagnostic; this report is not release readiness.'
      : defaultNextAction(levels),
  );
}

export function buildVerificationPlan(input: BuildVerificationPlanInput = {}): VerificationPlan {
  const goal = input.goal ?? 'pr';
  const mode: VerificationMode = input.run ? 'run' : 'dry-run';
  const stories = input.stories ?? loadCommittedStoryDefinitionsSync();
  const visualCatalogEntries = input.visualCatalogEntries ?? listVisualBaselineCatalogEntries();
  const changedFiles = uniqueSorted((input.changedFiles ?? []).map(normalizeRepoPath).filter(Boolean));
  const storyBySourceFile = buildStorySourceMap(stories);
  const accumulator = createAccumulator();

  if (input.changeDetectionFailure) {
    const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V3'];
    addLevels(accumulator, levels);
    accumulator.surfaces.add('change-detection-failed');
    accumulator.broadImpact = true;
    accumulator.warnings.push(`Changed-file detection failed: ${input.changeDetectionFailure}`);
    accumulator.reasons.push('Changed files could not be derived, so all canonical stories are treated as potentially affected.');
    const action = 'Manual impact owner triage required because changed-file detection failed; rerun with --changed-file for a narrower plan.';
    pushUnique(accumulator.nextActions, action);
    addBroadStoryCards(accumulator, stories, { levels, nextAction: action });
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
      const levels = levelsForStory(exactStory);
      const action = 'Manual story review required because canonical story markdown changed; then run the recommended verification aliases.';
      addLevels(accumulator, levels);
      accumulator.surfaces.add(`story:${exactStory.storyId}`);
      accumulator.manualReviewRequired = true;
      accumulator.reasons.push(`${changedFile} is canonical story markdown for ${exactStory.storyId}.`);
      pushUnique(accumulator.nextActions, action);
      addStoryCard(accumulator, exactStory, {
        risk: 'required',
        levels,
        evidenceStatus: 'not_evaluated',
        nextAction: action,
      });
    }

    if (isGeneratedStorySpec(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V3'];
      const action = 'Manual impact owner triage required because generated story specs are derived cache, not canonical story truth.';
      addLevels(accumulator, levels);
      accumulator.surfaces.add('derived-cache:story-specs');
      accumulator.broadImpact = true;
      accumulator.warnings.push('Generated story spec changed as derived cache drift; canonical story truth remains e2e/stories/**/*.story.md.');
      accumulator.reasons.push(`${changedFile} is derived cache and is not used as story truth.`);
      pushUnique(accumulator.nextActions, action);
      addBroadStoryCards(accumulator, stories, { levels, nextAction: action });
    }

    const visualMatches = findVisualMatches(changedFile, visualCatalogEntries);
    if (visualMatches.length > 0) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V2'];
      const action = 'Run npm run verify:visual and review affected visual story cards before accepting the UI impact.';
      addLevels(accumulator, levels);
      accumulator.reasons.push(`${changedFile} matches ${visualMatches.length} visual catalog code ref(s).`);
      pushUnique(accumulator.nextActions, action);
      for (const match of visualMatches) {
        accumulator.surfaces.add(`visual:${match.scenarioId}`);
        const story = stories.find((entry) => entry.storyId === match.storyId);
        if (story) {
          addStoryCard(accumulator, story, {
            risk: 'required',
            levels,
            evidenceStatus: 'not_evaluated',
            nextAction: action,
          });
        }
      }
    }

    if (isRunnerContextOrCredentialPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V3'];
      const action = 'Run npm run verify:real with runner, Context Store, and credential owner review.';
      addLevels(accumulator, levels);
      accumulator.surfaces.add('runner/context-store/credentials');
      accumulator.broadImpact = true;
      accumulator.reasons.push(`${changedFile} touches runner, Context Store, or credential behavior.`);
      pushUnique(accumulator.nextActions, action);
      addBroadStoryCards(accumulator, stories.filter((story) => story.lane === 'backend-real'), {
        levels,
        nextAction: action,
      });
    }

    if (isReleaseDeployOrRehearsalPath(changedFile)) {
      mapped = true;
      const levels: readonly VerificationLevel[] = ['V4'];
      const action = 'Release or deploy path changed. Use npm run release:ready as the next release operation outside this dry-run report; this report is not a release verdict.';
      addLevels(accumulator, levels);
      accumulator.surfaces.add('release/deploy/rehearsal');
      accumulator.broadImpact = true;
      accumulator.reasons.push(`${changedFile} touches release, deploy, or rehearsal operations.`);
      pushUnique(accumulator.nextActions, action);
      addBroadStoryCards(accumulator, stories, {
        levels,
        nextAction: action,
        evidenceStatus: 'missing',
      });
    }

    if (!mapped) {
      const levels: readonly VerificationLevel[] = ['V0', 'V1', 'V3'];
      const action = 'Manual impact owner triage required; treat all canonical stories as potentially affected until the source path is mapped.';
      addLevels(accumulator, levels);
      accumulator.surfaces.add('unmapped-source');
      accumulator.broadImpact = true;
      accumulator.warnings.push(`${changedFile} did not match canonical story markdown, visual code refs, runner/context/credential paths, or release paths.`);
      accumulator.reasons.push(`${changedFile} is unmapped source impact.`);
      pushUnique(accumulator.nextActions, action);
      addBroadStoryCards(accumulator, stories, { levels, nextAction: action });
    }
  }

  if (changedFiles.length > 0 && goal !== 'pr' && input.goalExplicit) {
    addGoalDefaults(accumulator, goal);
  }

  const requiredLevels = orderedLevels(accumulator.levels);
  const storyCards = [...accumulator.storyCards.values()]
    .map(storyCardToImmutable)
    .sort((left, right) => left.storyId.localeCompare(right.storyId));
  const affectedStories = storyCards.length > 0
    ? storyCards.map((card) => card.storyId)
    : ['No changed files provided or detected; default goal-based verification plan.'];
  const nextAction = accumulator.nextActions[0] ?? defaultNextAction(requiredLevels);
  const finalVerdict = mode === 'dry-run'
    ? 'not_evaluated_fail_closed'
    : 'delegated_to_executed_verification_commands';

  return {
    goal,
    mode,
    risk: 'fail-closed',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    changedFiles,
    affectedStories,
    affectedSurfaces: uniqueSorted(accumulator.surfaces),
    requiredLevels,
    requiredEvidence: evidenceForLevels(requiredLevels),
    recommendedCommands: orderedCommands(accumulator.commands),
    riskSummary: {
      posture: 'fail-closed',
      summary: accumulator.broadImpact
        ? 'Fail-closed broad impact selection; no evidence has been evaluated by this dry-run.'
        : 'Fail-closed targeted impact selection; no evidence has been evaluated by this dry-run.',
      reasons: accumulator.reasons,
      warnings: accumulator.warnings,
      manualReviewRequired: accumulator.manualReviewRequired,
      broadImpact: accumulator.broadImpact,
    },
    storyCards,
    finalVerdict,
    nextAction,
    reportRoot: input.reportRoot,
    releaseVerdict: false,
  };
}
