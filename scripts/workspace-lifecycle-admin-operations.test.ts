import { describe, expect, it } from 'vitest';
import { readStoryDefinitionFromMarkdownFileSync } from '../e2e/story-loader';

describe('workspace lifecycle admin operations story', () => {
  it('loads the canonical backend-real story for live workspace maintenance and accessibility checks', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-lifecycle-admin-operations.story.md');

    expect(story.sourceFile).toBe('e2e/stories/backend-real/workspace-lifecycle-admin-operations.story.md');
    expect(story.storyId).toBe('workspace-lifecycle-admin-operations');
    expect(story.lane).toBe('backend-real');
    expect(story.actor).toContain('system 管理侧');
    expect(story.goal).toContain('已上线 workspace');
    expect(story.goal).toContain('真实可访问');
    expect(story.seedData).toEqual(['ws_default']);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'system-login',
      'system-workspaces',
      'live-workspace-maintenance',
      'workspace-login',
      'workspace-projects',
    ]);
  });
});
