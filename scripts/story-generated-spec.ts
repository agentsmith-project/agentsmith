import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderGeneratedStorySpecsJson } from '../e2e/story-generated-spec';
import { loadCanonicalStoryCatalog } from './story-catalog-support';

export const DEFAULT_GENERATED_STORY_SPECS_PATH = path.resolve(
  process.cwd(),
  'e2e/generated/story-specs.generated.json',
);

export type StoryGeneratedSpecSyncResult = {
  outputPath: string;
  updated: boolean;
};

async function renderCanonicalGeneratedStorySpecs(): Promise<string> {
  const { generatedSpecs } = await loadCanonicalStoryCatalog();
  return renderGeneratedStorySpecsJson(generatedSpecs);
}

async function readExistingGeneratedStorySpecs(outputPath: string): Promise<string | null> {
  try {
    return await readFile(outputPath, 'utf-8');
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function syncGeneratedStorySpecs(
  outputPath = DEFAULT_GENERATED_STORY_SPECS_PATH,
): Promise<StoryGeneratedSpecSyncResult> {
  const resolvedOutputPath = path.resolve(outputPath);
  const nextContent = await renderCanonicalGeneratedStorySpecs();
  const currentContent = await readExistingGeneratedStorySpecs(resolvedOutputPath);

  if (currentContent === nextContent) {
    return {
      outputPath: resolvedOutputPath,
      updated: false,
    };
  }

  await writeFile(resolvedOutputPath, nextContent, 'utf-8');

  return {
    outputPath: resolvedOutputPath,
    updated: true,
  };
}

export async function checkGeneratedStorySpecsFreshness(
  outputPath = DEFAULT_GENERATED_STORY_SPECS_PATH,
): Promise<void> {
  const resolvedOutputPath = path.resolve(outputPath);
  const expectedContent = await renderCanonicalGeneratedStorySpecs();
  const currentContent = await readExistingGeneratedStorySpecs(resolvedOutputPath);

  if (currentContent === expectedContent) {
    return;
  }

  const displayPath = path.relative(process.cwd(), resolvedOutputPath) || resolvedOutputPath;
  throw new Error(
    `[story-generated-spec] generated story specs are out of sync: ${displayPath}. Run: npm run story-generated-spec:sync`,
  );
}

function resolveOutputPath(argv: readonly string[]): string {
  const outputFlagIndex = argv.indexOf('--output');
  if (outputFlagIndex >= 0) {
    const candidate = argv[outputFlagIndex + 1];
    if (!candidate) {
      throw new Error('[story-generated-spec] --output requires a file path');
    }
    return candidate;
  }

  const positionalPath = argv.find((argument) => !argument.startsWith('--'));
  return positionalPath ?? DEFAULT_GENERATED_STORY_SPECS_PATH;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const outputPath = resolveOutputPath(argv);

  if (argv.includes('--check')) {
    await checkGeneratedStorySpecsFreshness(outputPath);
    process.stdout.write('[story-generated-spec] generated story specs are in sync.\n');
    return;
  }

  const result = await syncGeneratedStorySpecs(outputPath);
  process.stdout.write(
    `[story-generated-spec] ${result.updated ? 'sync completed.' : 'already in sync.'}\n`,
  );
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && pathToFileURL(path.resolve(entrypoint)).href === import.meta.url;
}

if (isDirectExecution()) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
