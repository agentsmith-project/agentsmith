import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog, readCommittedGeneratedStorySpecs } from './story-catalog-support';
import {
  MAJOR_PRODUCT_SURFACE_COVERAGE,
  validateMajorProductSurfaceCoverage,
  validateVisualStoryRuntimeContracts,
} from './story-product-surface-coverage';

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
      'release_verification_and_review',
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

  it('closes major product surface coverage over every backend-real non-advisory story', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const specs = await readCommittedGeneratedStorySpecs();
    const generatedSpecIds = new Set(specs.map((entry) => entry.storyId));

    expect(validateMajorProductSurfaceCoverage(stories, generatedSpecIds)).toEqual([]);

    const backendRealStoryIds = stories
      .filter((story) => story.lane === 'backend-real' && story.gatePolicy.tier !== 'advisory')
      .map((story) => story.storyId)
      .sort();
    const coveredStoryIds = MAJOR_PRODUCT_SURFACE_COVERAGE
      .flatMap((surface) => [...surface.storyIds])
      .sort();

    expect(coveredStoryIds).toEqual(backendRealStoryIds);
  });

  it('keeps visual story runtime contracts anchored to real code refs and explicit stable markers', async () => {
    const { stories } = await loadCanonicalStoryCatalog();

    expect(validateVisualStoryRuntimeContracts(stories)).toEqual([]);
  });

  it('marks happy notebook visual scenes as non-degraded product states', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const happyNotebookScenarioIds = [
      'notebook-task-lifecycle-list',
      'notebook-task-lifecycle-detail',
      'notebook-task-detail',
    ];
    const visualScenes = stories.flatMap((story) => story.runtimeData?.visualReview?.scenes ?? []);

    expect(
      happyNotebookScenarioIds.map((scenarioId) => {
        const scene = visualScenes.find((entry) => entry.scenarioId === scenarioId);
        return [scenarioId, scene?.uxState] as const;
      }),
    ).toEqual(happyNotebookScenarioIds.map((scenarioId) => [scenarioId, 'happy']));
  });
});
