import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllStoryDefinitions } from '../e2e/story-loader';
import {
  buildGeneratedStorySpecs,
  renderGeneratedStorySpecsJson,
} from '../e2e/story-generated-spec';

describe('generated story specs', () => {
  it('derives generated specs from markdown story sources without hand-maintained prose drift', async () => {
    const stories = await loadAllStoryDefinitions();
    const specs = buildGeneratedStorySpecs(stories);

    expect(specs.map((spec) => spec.storyId)).toEqual(stories.map((story) => story.storyId));
    expect(specs.every((spec) => spec.sourceFingerprint.length > 0)).toBe(true);
    expect(specs[0]?.stepIds.length).toBeGreaterThan(0);
    expect(specs[0]?.storyFingerprint.length).toBeGreaterThan(0);
    expect(specs[0]?.stepMapFingerprint.length).toBeGreaterThan(0);
  });

  it('renders generated specs as stable json ordered by story id', async () => {
    const stories = await loadAllStoryDefinitions();
    const json = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const parsed = JSON.parse(json) as Array<{ storyId: string; stepIds: string[] }>;

    expect(parsed.map((entry) => entry.storyId)).toEqual([
      'real-backend-visual-review',
      'release-user-story-end-to-end',
    ]);
    expect(parsed.every((entry) => entry.stepIds.length > 0)).toBe(true);
  });

  it('keeps the committed generated cache byte-for-byte aligned with regenerated story specs', async () => {
    const stories = await loadAllStoryDefinitions();
    const regenerated = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const committed = await readFile(path.resolve('e2e/generated/story-specs.generated.json'), 'utf-8');

    expect(committed).toBe(regenerated);
  });
});
