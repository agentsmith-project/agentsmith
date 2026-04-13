import fs from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  STORY_FILE_SUFFIX,
  type StoryAuthLane,
  type StoryDefinition,
  type StoryEvidence,
  type StoryExternalDependency,
  STORY_EXTERNAL_DEPENDENCY_KIND_VALUES,
  STORY_EVIDENCE_VALUES,
  STORY_GATE_TIER_VALUES,
  STORY_KIND_VALUES,
  STORY_LANE_VALUES,
  type StoryGatePolicy,
  type StoryKind,
  type StoryLane,
  type StoryRuntimeData,
  type StoryRecipeFamily,
  type StoryStepDefinition,
  type StoryTargetMatch,
  validateStoryDefinition,
} from './story-contract';

export type StoryLoaderOptions = {
  rootDir?: string;
  injectedStories?: readonly StoryDefinition[];
};

export type LoadStoryDefinitionOptions = {
  rootDir?: string;
};

const STORY_LANE_DIRECTORY_NAMES = STORY_LANE_VALUES;

export function resolveCommittedStoryRoot(rootDir?: string): string {
  return path.resolve(rootDir ?? 'e2e/stories');
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function relativeStorySource(filePath: string): string {
  return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, '/');
}

function validateStoryFilename(filePath: string, storyId: string) {
  const expected = `${storyId}${STORY_FILE_SUFFIX}`;
  if (path.basename(filePath) !== expected) {
    throw new Error(`story filename drift: expected ${expected}, received ${path.basename(filePath)}`);
  }
}

type FrontmatterRecord = Record<string, unknown>;

function parseJsonFrontmatterBlock(block: string): FrontmatterRecord {
  const parsed = JSON.parse(block);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('json frontmatter must be an object');
  }
  return parsed as FrontmatterRecord;
}

function requireString(frontmatter: FrontmatterRecord, key: string): string {
  const value = frontmatter[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`missing frontmatter key: ${key}`);
  }
  return value.trim();
}

function optionalStringList(frontmatter: FrontmatterRecord, key: string): string[] | undefined {
  const value = frontmatter[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`frontmatter key ${key} must be a list`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`frontmatter key ${key} must be a list of strings`);
    }
    return entry.trim();
  });
}

function optionalObjectList(
  frontmatter: FrontmatterRecord,
  key: string,
): Array<Record<string, unknown>> | undefined {
  const value = frontmatter[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`frontmatter key ${key} must be a list`);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`frontmatter key ${key} must contain objects`);
    }
    return entry as Record<string, unknown>;
  });
}

function requireStringList(frontmatter: FrontmatterRecord, key: string): string[] {
  const value = optionalStringList(frontmatter, key);
  if (value === undefined) {
    throw new Error(`missing frontmatter key: ${key}`);
  }
  return value;
}

function optionalObject(frontmatter: FrontmatterRecord, key: string): Record<string, unknown> | undefined {
  const value = frontmatter[key];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`frontmatter key ${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStoryKind(raw: unknown, storyId: string): StoryKind {
  if (typeof raw !== 'string' || !STORY_KIND_VALUES.includes(raw as StoryKind)) {
    throw new Error(`frontmatter key kind in ${storyId} must be one of: ${STORY_KIND_VALUES.join(', ')}`);
  }
  return raw as StoryKind;
}

function parseStoryLane(raw: unknown, storyId: string): StoryLane {
  if (typeof raw !== 'string' || !STORY_LANE_VALUES.includes(raw as StoryLane)) {
    throw new Error(`frontmatter key lane in ${storyId} must be one of: ${STORY_LANE_VALUES.join(', ')}`);
  }
  return raw as StoryLane;
}

function normalizeGatePolicy(
  raw: Record<string, unknown> | undefined,
  storyId: string,
): StoryGatePolicy {
  if (!raw) {
    throw new Error(`missing frontmatter key: gatePolicy`);
  }
  const tier = raw.tier;
  if (typeof tier !== 'string' || !STORY_GATE_TIER_VALUES.includes(tier as (typeof STORY_GATE_TIER_VALUES)[number])) {
    throw new Error(`frontmatter key gatePolicy.tier in ${storyId} must be one of: ${STORY_GATE_TIER_VALUES.join(', ')}`);
  }
  const requiredEvidence = raw.requiredEvidence;
  if (!Array.isArray(requiredEvidence) || requiredEvidence.length === 0) {
    throw new Error(`frontmatter key gatePolicy.requiredEvidence in ${storyId} must be a non-empty list`);
  }

  return {
    tier: tier as StoryGatePolicy['tier'],
    requiredEvidence: requiredEvidence.map((entry) => {
      if (typeof entry !== 'string' || !STORY_EVIDENCE_VALUES.includes(entry as StoryEvidence)) {
        throw new Error(
          `frontmatter key gatePolicy.requiredEvidence in ${storyId} must only contain: ${STORY_EVIDENCE_VALUES.join(', ')}`,
        );
      }
      return entry.trim() as StoryEvidence;
    }),
  };
}

function normalizeExternalDependencies(
  raw: Array<Record<string, unknown>> | undefined,
  storyId: string,
): StoryExternalDependency[] {
  if (!raw) {
    throw new Error(`missing frontmatter key: externalDependencies`);
  }

  return raw.map((entry) => {
    const dependencyId = requireFieldString(entry, ['dependencyId'], `external dependency id in ${storyId}`);
    const kind = entry.kind;
    if (
      typeof kind !== 'string' ||
      !STORY_EXTERNAL_DEPENDENCY_KIND_VALUES.includes(kind as (typeof STORY_EXTERNAL_DEPENDENCY_KIND_VALUES)[number])
    ) {
      throw new Error(
        `frontmatter key externalDependencies.kind in ${storyId} must be one of: ${STORY_EXTERNAL_DEPENDENCY_KIND_VALUES.join(', ')}`,
      );
    }
    const required = typeof entry.required === 'boolean' ? entry.required : false;
    const note =
      typeof entry.note === 'string' && entry.note.trim().length > 0
        ? entry.note.trim()
        : undefined;

    return {
      dependencyId,
      kind: kind as StoryExternalDependency['kind'],
      required,
      note,
    };
  });
}

function requireFieldString(frontmatter: FrontmatterRecord, keys: readonly string[], fieldName: string): string {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  throw new Error(`missing frontmatter key: ${fieldName}`);
}

function optionalFieldStringList(
  frontmatter: FrontmatterRecord,
  keys: readonly string[],
  fieldName: string,
): string[] | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      throw new Error(`frontmatter key ${fieldName} must be a list`);
    }
    return value.map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error(`frontmatter key ${fieldName} must be a list of strings`);
      }
      return entry.trim();
    });
  }
  return undefined;
}

function normalizeScene(raw: Record<string, unknown>, storyId: string) {
  return {
    sceneId: requireFieldString(raw, ['sceneId'], `scene id in ${storyId}`),
    route: requireFieldString(raw, ['route'], `scene route in ${storyId}`),
    recipeFamily: raw.recipeFamily as StoryRecipeFamily | undefined,
    authLane: raw.authLane as StoryAuthLane | undefined,
    stableMarkers:
      optionalFieldStringList(raw, ['stableMarkers'], `scene stable markers in ${storyId}`) ?? [],
  };
}

function normalizeStep(raw: Record<string, unknown>, storyId: string): StoryStepDefinition {
  const evidence = optionalFieldStringList(raw, ['evidence'], `step evidence in ${storyId}`);
  if (!evidence) {
    throw new Error(`frontmatter key step evidence in ${storyId} must be a list`);
  }
  return {
    stepId: requireFieldString(raw, ['stepId'], `step id in ${storyId}`),
    sceneId:
      typeof raw.sceneId === 'string' && raw.sceneId.trim().length > 0
        ? raw.sceneId.trim()
        : undefined,
    intent: requireFieldString(raw, ['intent'], `step intent in ${storyId}`),
    action: requireFieldString(raw, ['action'], `step action in ${storyId}`),
    target:
      typeof raw.target === 'string' && raw.target.trim().length > 0
        ? raw.target.trim()
        : undefined,
    targetMatch:
      typeof raw.targetMatch === 'string' && raw.targetMatch.trim().length > 0
        ? (raw.targetMatch.trim() as StoryTargetMatch)
        : undefined,
    expectedFeedback: requireFieldString(raw, ['expectedFeedback'], `step expected feedback in ${storyId}`),
    evidence: evidence as StoryEvidence[],
    optional: typeof raw.optional === 'boolean' ? raw.optional : false,
    note:
      typeof raw.note === 'string' && raw.note.trim().length > 0
        ? raw.note.trim()
        : undefined,
  };
}

function buildStoryDefinition(markdown: string, sourceFile: string): StoryDefinition {
  const normalized = normalizeNewlines(markdown).trimStart();
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch?.[1]) {
    throw new Error('missing frontmatter');
  }

  const frontmatterText = frontmatterMatch[1].trim();
  if (!frontmatterText.startsWith('{')) {
    throw new Error('story files must use JSON frontmatter');
  }

  const frontmatter = parseJsonFrontmatterBlock(frontmatterText);
  const storyId = requireFieldString(frontmatter, ['storyId'], 'story id');
  if (sourceFile !== 'inline.story.md') {
    validateStoryFilename(sourceFile, storyId);
  }

  const scenes = optionalObjectList(frontmatter, 'scenes') ?? [];
  const steps = optionalObjectList(frontmatter, 'steps') ?? [];
  const actor = requireString(frontmatter, 'actor');
  const lane = parseStoryLane(frontmatter.lane, storyId);
  const normalizedSteps = steps.map((step) => normalizeStep(step, storyId));
  const personas = requireStringList(frontmatter, 'personas');
  const family = requireString(frontmatter, 'family');
  const kind = parseStoryKind(frontmatter.kind, storyId);

  const story: StoryDefinition = {
    filePath: path.resolve(sourceFile),
    sourceFile: sourceFile === 'inline.story.md' ? sourceFile : relativeStorySource(sourceFile),
    storyId,
    title: requireString(frontmatter, 'title'),
    actor,
    family,
    personas,
    kind,
    gatePolicy: normalizeGatePolicy(optionalObject(frontmatter, 'gatePolicy'), storyId),
    externalDependencies: normalizeExternalDependencies(optionalObjectList(frontmatter, 'externalDependencies'), storyId),
    lane,
    entryRoute: requireString(frontmatter, 'entryRoute'),
    goal: requireString(frontmatter, 'goal'),
    preconditions: optionalStringList(frontmatter, 'preconditions'),
    seedData: optionalStringList(frontmatter, 'seedData'),
    narrative: requireString(frontmatter, 'narrative'),
    runtimeData: optionalObject(frontmatter, 'runtimeData') as StoryRuntimeData | undefined,
    scenes: scenes.map((scene) => normalizeScene(scene, storyId)),
    steps: normalizedSteps,
  };

  validateStoryDefinition(story);
  return story;
}

export function parseStoryDefinition(markdown: string, sourceFile = 'inline.story.md'): StoryDefinition {
  return buildStoryDefinition(markdown, sourceFile);
}

export function readStoryDefinitionFromMarkdown(
  markdown: string,
  sourceFile = 'inline.story.md',
): StoryDefinition {
  return buildStoryDefinition(markdown, sourceFile);
}

export async function readStoryDefinitionFromMarkdownFile(filePath: string): Promise<StoryDefinition> {
  const source = await readFile(path.resolve(filePath), 'utf-8');
  return readStoryDefinitionFromMarkdown(source, path.resolve(filePath));
}

export function readStoryDefinitionFromMarkdownFileSync(filePath: string): StoryDefinition {
  const source = fs.readFileSync(path.resolve(filePath), 'utf-8');
  return readStoryDefinitionFromMarkdown(source, path.resolve(filePath));
}

async function listStoryFilesInDirectory(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listStoryFilesInDirectory(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(STORY_FILE_SUFFIX)) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function listStoryFilesInDirectorySync(rootDir: string): string[] {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listStoryFilesInDirectorySync(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(STORY_FILE_SUFFIX)) {
        return [entryPath];
      }
      return [];
    })
    .sort((left, right) => left.localeCompare(right));
}

async function listStoryFiles(rootDir: string): Promise<string[]> {
  const files = await Promise.all(
    STORY_LANE_DIRECTORY_NAMES.map(async (laneDir) => {
      const laneRoot = path.join(rootDir, laneDir);
      if (!fs.existsSync(laneRoot) || !fs.statSync(laneRoot).isDirectory()) {
        return [];
      }
      return listStoryFilesInDirectory(laneRoot);
    }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
}

function listStoryFilesSync(rootDir: string): string[] {
  return STORY_LANE_DIRECTORY_NAMES.flatMap((laneDir) => {
    const laneRoot = path.join(rootDir, laneDir);
    if (!fs.existsSync(laneRoot) || !fs.statSync(laneRoot).isDirectory()) {
      return [];
    }
    return listStoryFilesInDirectorySync(laneRoot);
  }).sort((left, right) => left.localeCompare(right));
}

function validateStoryLaneDirectory(story: StoryDefinition, filePath: string, rootDir: string) {
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const laneDirectory = relativePath.split('/', 1)[0];
  if (!STORY_LANE_DIRECTORY_NAMES.includes(laneDirectory as (typeof STORY_LANE_DIRECTORY_NAMES)[number])) {
    throw new Error(`story ${story.storyId} must live under a canonical lane directory`);
  }
  if (laneDirectory !== story.lane) {
    throw new Error(
      `story ${story.storyId} lane directory drift: expected ${story.lane}, received ${laneDirectory}`,
    );
  }
}

function validateNoDuplicateStoryIds(stories: readonly StoryDefinition[]) {
  const seen = new Map<string, string>();
  for (const story of stories) {
    const existing = seen.get(story.storyId);
    if (existing) {
      throw new Error(`duplicate story id: ${story.storyId} (${existing}, ${story.sourceFile ?? story.filePath})`);
    }
    seen.set(story.storyId, story.sourceFile ?? story.filePath);
  }
}

export async function loadAllStoryDefinitions(options?: StoryLoaderOptions): Promise<StoryDefinition[]> {
  const rootDir = resolveCommittedStoryRoot(options?.rootDir);
  const stories = [...(options?.injectedStories ?? [])];
  const files = await listStoryFiles(rootDir);
  for (const filePath of files) {
    const story = await readStoryDefinitionFromMarkdownFile(filePath);
    validateStoryLaneDirectory(story, filePath, rootDir);
    stories.push(story);
  }
  validateNoDuplicateStoryIds(stories);
  return stories.sort((left, right) => left.storyId.localeCompare(right.storyId));
}

export function loadAllStoryDefinitionsSync(options?: StoryLoaderOptions): StoryDefinition[] {
  const rootDir = resolveCommittedStoryRoot(options?.rootDir);
  const stories = [...(options?.injectedStories ?? [])];
  const files = listStoryFilesSync(rootDir);
  for (const filePath of files) {
    const story = readStoryDefinitionFromMarkdownFileSync(filePath);
    validateStoryLaneDirectory(story, filePath, rootDir);
    stories.push(story);
  }
  validateNoDuplicateStoryIds(stories);
  return stories.sort((left, right) => left.storyId.localeCompare(right.storyId));
}

export async function loadStoryDefinition(
  storyIdOrFilePath: string,
  options?: LoadStoryDefinitionOptions,
): Promise<StoryDefinition> {
  if (storyIdOrFilePath.endsWith(STORY_FILE_SUFFIX)) {
    return readStoryDefinitionFromMarkdownFile(storyIdOrFilePath);
  }
  const stories = await loadAllStoryDefinitions({ rootDir: options?.rootDir });
  const story = stories.find((entry) => entry.storyId === storyIdOrFilePath);
  if (!story) {
    throw new Error(`story not found: ${storyIdOrFilePath}`);
  }
  return story;
}

export function loadStoryDefinitionSync(
  storyIdOrFilePath: string,
  options?: LoadStoryDefinitionOptions,
): StoryDefinition {
  if (storyIdOrFilePath.endsWith(STORY_FILE_SUFFIX)) {
    return readStoryDefinitionFromMarkdownFileSync(storyIdOrFilePath);
  }
  const stories = loadAllStoryDefinitionsSync({ rootDir: options?.rootDir });
  const story = stories.find((entry) => entry.storyId === storyIdOrFilePath);
  if (!story) {
    throw new Error(`story not found: ${storyIdOrFilePath}`);
  }
  return story;
}
