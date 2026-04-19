import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  loadCanonicalStoryCatalog,
  readCommittedGeneratedStorySpecs,
  type GeneratedStorySpec as SupportGeneratedStorySpec,
} from './story-catalog-support';
import {
  buildGeneratedStorySpecs,
  renderGeneratedStorySpecsJson,
} from '../e2e/story-generated-spec';
import type { GeneratedStorySpec as CanonicalGeneratedStorySpec } from '../e2e/story-generated-spec';
import {
  checkGeneratedStorySpecsFreshness,
  syncGeneratedStorySpecs,
} from './story-generated-spec';

type TypeEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false;
type ExpectTrue<Value extends true> = Value;
const _generatedStorySpecSchemaAligned: ExpectTrue<
  TypeEqual<SupportGeneratedStorySpec, CanonicalGeneratedStorySpec>
> = true;

describe('generated story specs', () => {
  it('exposes explicit sync and check commands and wires freshness into contracts:check', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['story-generated-spec:sync']).toBe('tsx scripts/story-generated-spec.ts');
    expect(packageJson.scripts?.['story-generated-spec:check']).toBe('tsx scripts/story-generated-spec.ts --check');
    expect(packageJson.scripts?.['contracts:check']).toContain('npm run story-generated-spec:check');
  });

  it('derives generated specs from markdown story sources without hand-maintained prose drift', async () => {
    const { stories, generatedSpecs } = await loadCanonicalStoryCatalog();
    const specs = buildGeneratedStorySpecs(stories);

    expect(specs.map((spec) => spec.storyId)).toEqual(stories.map((story) => story.storyId));
    expect(generatedSpecs.map((spec) => spec.storyId)).toEqual(stories.map((story) => story.storyId));
    expect(specs.every((spec) => spec.sourceFingerprint.length > 0)).toBe(true);
    expect(specs[0]?.stepIds.length).toBeGreaterThan(0);
    expect(specs[0]?.storyFingerprint.length).toBeGreaterThan(0);
    expect(specs[0]?.stepMapFingerprint.length).toBeGreaterThan(0);
  });

  it('renders generated specs as stable json ordered by story id', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const json = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const parsed = JSON.parse(json) as Array<{
      storyId: string;
      stepIds: string[];
    }>;

    const storyIds = parsed.map((entry) => entry.storyId);
    expect(storyIds).toEqual([...storyIds].sort((left, right) => left.localeCompare(right)));
    expect(storyIds).toEqual(stories.map((story) => story.storyId));
    expect(parsed.every((entry) => entry.stepIds.length > 0)).toBe(true);
    expect(parsed.every((entry) => entry.sourceRef.endsWith(`#${entry.storyId}`))).toBe(true);
  });

  it('reads committed generated specs through the canonical generated spec schema', async () => {
    const committedStories = await readCommittedGeneratedStorySpecs();

    expectTypeOf(committedStories).toEqualTypeOf<CanonicalGeneratedStorySpec[]>();
    expect(committedStories[0]).toHaveProperty('sceneIds');
    expect(committedStories[0]).toHaveProperty('visualStepIds');
    expect(committedStories[0]).toHaveProperty('personas');
  });

  it('routes committed generated cache freshness through the explicit check flow', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const regenerated = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const generatedPath = path.resolve('e2e/generated/story-specs.generated.json');
    const committed = await readFile(generatedPath, 'utf-8');

    if (committed === regenerated) {
      await expect(checkGeneratedStorySpecsFreshness(generatedPath)).resolves.toBeUndefined();
      return;
    }

    await expect(checkGeneratedStorySpecsFreshness(generatedPath)).rejects.toThrow(
      /npm run story-generated-spec:sync/,
    );
  });

  it('syncs generated story specs through the canonical story loader and generator', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'story-generated-spec-'));
    const outputPath = path.join(tempDir, 'story-specs.generated.json');

    try {
      const firstSync = await syncGeneratedStorySpecs(outputPath);
      const written = await readFile(outputPath, 'utf-8');
      const { generatedSpecs } = await loadCanonicalStoryCatalog();

      expect(firstSync.updated).toBe(true);
      expect(written).toBe(renderGeneratedStorySpecsJson(generatedSpecs));

      const secondSync = await syncGeneratedStorySpecs(outputPath);
      expect(secondSync.updated).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails freshness checks with the sync command hint when the generated cache drifts', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'story-generated-spec-'));
    const outputPath = path.join(tempDir, 'story-specs.generated.json');

    try {
      await syncGeneratedStorySpecs(outputPath);
      await writeFile(outputPath, '[]\n', 'utf-8');

      await expect(checkGeneratedStorySpecsFreshness(outputPath)).rejects.toThrow(
        /npm run story-generated-spec:sync/,
      );

      await syncGeneratedStorySpecs(outputPath);
      await expect(checkGeneratedStorySpecsFreshness(outputPath)).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
