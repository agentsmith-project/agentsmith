import fs from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  STORY_FILE_SUFFIX,
  type StoryAuthLane,
  type StoryDefinition,
  type StoryEvidence,
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

  const story: StoryDefinition = {
    filePath: path.resolve(sourceFile),
    sourceFile: sourceFile === 'inline.story.md' ? sourceFile : relativeStorySource(sourceFile),
    storyId,
    title: requireString(frontmatter, 'title'),
    actor: requireString(frontmatter, 'actor'),
    lane: requireString(frontmatter, 'lane') as StoryLane,
    entryRoute: requireString(frontmatter, 'entryRoute'),
    goal: requireString(frontmatter, 'goal'),
    preconditions: optionalStringList(frontmatter, 'preconditions'),
    seedData: optionalStringList(frontmatter, 'seedData'),
    narrative: requireString(frontmatter, 'narrative'),
    runtimeData: optionalObject(frontmatter, 'runtimeData') as StoryRuntimeData | undefined,
    scenes: scenes.map((scene) => normalizeScene(scene, storyId)),
    steps: steps.map((step) => normalizeStep(step, storyId)),
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

async function listStoryFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listStoryFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(STORY_FILE_SUFFIX)) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function listStoryFilesSync(rootDir: string): string[] {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listStoryFilesSync(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(STORY_FILE_SUFFIX)) {
        return [entryPath];
      }
      return [];
    })
    .sort((left, right) => left.localeCompare(right));
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
    stories.push(await readStoryDefinitionFromMarkdownFile(filePath));
  }
  validateNoDuplicateStoryIds(stories);
  return stories.sort((left, right) => left.storyId.localeCompare(right.storyId));
}

export function loadAllStoryDefinitionsSync(options?: StoryLoaderOptions): StoryDefinition[] {
  const rootDir = resolveCommittedStoryRoot(options?.rootDir);
  const stories = [...(options?.injectedStories ?? [])];
  const files = listStoryFilesSync(rootDir);
  for (const filePath of files) {
    stories.push(readStoryDefinitionFromMarkdownFileSync(filePath));
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
