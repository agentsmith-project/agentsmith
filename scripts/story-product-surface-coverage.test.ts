import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog, readCommittedGeneratedStorySpecs } from './story-catalog-support';
import { MAJOR_PRODUCT_SURFACE_COVERAGE } from './story-product-surface-coverage';

describe('story product surface coverage', () => {
  it('keeps the committed story catalog anchored to major product surfaces instead of ad hoc recall', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const specs = await readCommittedGeneratedStorySpecs();
    const storiesById = new Map(stories.map((story) => [story.storyId, story] as const));
    const generatedSpecIds = new Set(specs.map((entry) => entry.storyId));

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.map((entry) => entry.surfaceId)).toEqual([
      'entry_and_identity',
      'workspace_and_project_core',
      'system_administration',
      'governance_and_membership',
      'chat_work',
      'notebook_and_terminal_work',
      'files_and_context',
      'connections_and_runtime_use',
      'self_service_and_usage',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'notebook_and_terminal_work')?.storyIds).toEqual([
      'notebook-first-success',
      'notebook-artifact-to-files-download',
      'notebook-terminal-workspace-multi-session',
      'notebook-terminal-reentry-recovery',
      'notebook-terminal-truth-unavailable-retry',
    ]);

    for (const surface of MAJOR_PRODUCT_SURFACE_COVERAGE) {
      expect(surface.label.length).toBeGreaterThan(0);
      expect(new Set(surface.storyIds).size).toBe(surface.storyIds.length);
      expect(surface.storyIds.length).toBeGreaterThan(0);

      const coveredStories = surface.storyIds.map((storyId) => storiesById.get(storyId));
      expect(coveredStories.every((story) => story?.lane === 'backend-real')).toBe(true);
      expect(coveredStories.every((story) => story && story.steps.length > 0)).toBe(true);
      expect(surface.storyIds.every((storyId) => generatedSpecIds.has(storyId))).toBe(true);
    }
  });
});
