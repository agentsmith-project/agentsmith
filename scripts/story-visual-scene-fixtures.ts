import type {
  StoryDefinition,
  StoryRuntimeVisualReviewSceneDefinition,
  StorySceneDefinition,
} from '../e2e/story-contract';

export type StoryVisualSceneBundle = {
  storyScene: StorySceneDefinition;
  visualScene: StoryRuntimeVisualReviewSceneDefinition;
};

export function listStorySceneIds(story: StoryDefinition): string[] {
  return story.scenes.map((scene) => scene.sceneId).sort();
}

export function listStoryVisualSceneIds(story: StoryDefinition): string[] {
  return [...(story.runtimeData?.visualReview?.scenes ?? [])]
    .map((scene) => scene.sceneId)
    .sort();
}

export function buildStoryVisualSceneBundleIndex(
  story: StoryDefinition,
): Map<string, StoryVisualSceneBundle> {
  const storyScenesById = new Map(
    story.scenes.map((scene) => [scene.sceneId, scene] as const),
  );

  return new Map(
    (story.runtimeData?.visualReview?.scenes ?? []).map((visualScene) => {
      const storyScene = storyScenesById.get(visualScene.sceneId);
      if (!storyScene) {
        throw new Error(
          `missing_story_scene_for_visual_scene:${story.storyId}:${visualScene.sceneId}`,
        );
      }
      return [
        visualScene.scenarioId,
        {
          storyScene,
          visualScene,
        },
      ] as const;
    }),
  );
}

export function getRequiredStoryVisualSceneBundle(
  story: StoryDefinition,
  scenarioId: string,
): StoryVisualSceneBundle {
  const bundle = buildStoryVisualSceneBundleIndex(story).get(scenarioId);
  if (!bundle) {
    throw new Error(`missing_visual_scene_bundle:${story.storyId}:${scenarioId}`);
  }
  return bundle;
}
