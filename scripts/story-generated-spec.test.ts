import { readFile } from 'node:fs/promises';
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

  it('keeps the committed generated cache byte-for-byte aligned with regenerated story specs', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const regenerated = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const committedStories = await readCommittedGeneratedStorySpecs();
    const regeneratedStories = JSON.parse(regenerated) as typeof committedStories;
    const committed = await readFile(path.resolve('e2e/generated/story-specs.generated.json'), 'utf-8');

    expect(committedStories.map((entry) => entry.storyId)).toEqual(stories.map((story) => story.storyId));
    expect(committedStories).toEqual(regeneratedStories);
    expect(committed).toBe(regenerated);
  });
});
