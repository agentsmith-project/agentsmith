import { loadStoryDefinitionSync } from './story-loader';
import type { StoryDefinition } from './story-contract';

const RELEASE_USER_STORY_DEFINITION = loadStoryDefinitionSync('release-user-story-end-to-end');

export const RELEASE_USER_STORY = {
  manifest: {
    storyId: 'release-user-story-end-to-end',
    title: RELEASE_USER_STORY_DEFINITION.title,
    actor: RELEASE_USER_STORY_DEFINITION.actor,
    goal: RELEASE_USER_STORY_DEFINITION.goal,
    preconditions: [...(RELEASE_USER_STORY_DEFINITION.preconditions ?? [])],
    seedData: [...(RELEASE_USER_STORY_DEFINITION.seedData ?? [])],
  },
  storyDefinition: RELEASE_USER_STORY_DEFINITION,
} as const;

export function getReleaseStoryDefinition(): StoryDefinition {
  return RELEASE_USER_STORY.storyDefinition;
}
