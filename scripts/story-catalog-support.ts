import fs from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  buildGeneratedStorySpecs,
  type GeneratedStorySpec as CanonicalGeneratedStorySpec,
} from '../e2e/story-generated-spec';
import { loadAllStoryDefinitions, loadAllStoryDefinitionsSync } from '../e2e/story-loader';

export type GeneratedStorySpec = CanonicalGeneratedStorySpec;

export async function loadCanonicalStoryCatalog() {
  const stories = await loadCanonicalStoryDefinitions();
  const generatedSpecs = buildGeneratedStorySpecs(stories);

  return {
    stories,
    generatedSpecs,
  };
}

export async function loadCommittedStoryDefinitions() {
  return loadCanonicalStoryDefinitions();
}

export function loadCommittedStoryDefinitionsSync() {
  return loadCanonicalStoryDefinitionsSync();
}

export async function loadCommittedStoryDefinitionById(storyId: string) {
  const stories = await loadCanonicalStoryDefinitions();
  const story = stories.find((entry) => entry.storyId === storyId);
  if (!story) {
    throw new Error(`committed story not found: ${storyId}`);
  }
  return story;
}

export function loadCommittedStoryDefinitionByIdSync(storyId: string) {
  const stories = loadCanonicalStoryDefinitionsSync();
  const story = stories.find((entry) => entry.storyId === storyId);
  if (!story) {
    throw new Error(`committed story not found: ${storyId}`);
  }
  return story;
}

export async function readCommittedGeneratedStorySpecs(
  filePath = path.resolve(process.cwd(), 'e2e/generated/story-specs.generated.json'),
): Promise<GeneratedStorySpec[]> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as GeneratedStorySpec[];
}

export async function listCommittedStoryMarkdownFiles(
  rootDir = path.resolve(process.cwd(), 'e2e/stories'),
): Promise<string[]> {
  return listStoryMarkdownFiles(rootDir);
}

export function listCommittedStoryMarkdownFilesSync(
  rootDir = path.resolve(process.cwd(), 'e2e/stories'),
): string[] {
  return listStoryMarkdownFilesSync(rootDir);
}

export async function loadCanonicalStoryDefinitions() {
  return loadAllStoryDefinitions();
}

export function loadCanonicalStoryDefinitionsSync() {
  return loadAllStoryDefinitionsSync();
}

async function listStoryMarkdownFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listStoryMarkdownFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith('.story.md')) {
        return [entryPath];
      }
      return [];
    }),
  );

  return nested.flat().sort((left, right) => {
    const leftId = path.basename(left, '.story.md');
    const rightId = path.basename(right, '.story.md');
    return leftId.localeCompare(rightId);
  });
}

function listStoryMarkdownFilesSync(rootDir: string): string[] {
  if (!fs.statSync(rootDir).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listStoryMarkdownFilesSync(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith('.story.md')) {
        return [entryPath];
      }
      return [];
    })
    .sort((left, right) => {
      const leftId = path.basename(left, '.story.md');
      const rightId = path.basename(right, '.story.md');
      return leftId.localeCompare(rightId);
    });
}
