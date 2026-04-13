import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('project surface handoff continuity story', () => {
  it('defines the daily-work story as overview to chat to notebook to files and back to overview', () => {
    const story = loadStoryDefinitionSync('project-surface-handoff-continuity');

    expect(story.storyId).toBe('project-surface-handoff-continuity');
    expect(story.actor).toBe('project member');
    expect(story.goal).toContain('overview');
    expect(story.goal).toContain('chat');
    expect(story.goal).toContain('notebook');
    expect(story.goal).toContain('files');
    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'project-overview',
      'project-chat',
      'project-notebook',
      'project-files',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-project-overview',
      'handoff-to-chat',
      'handoff-to-notebook',
      'handoff-to-files',
      'return-to-overview',
    ]);
  });

  it('wires the existing real backend visual review spec to the new handoff story and sidebar continuity helper', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-visual-review.spec.ts'), 'utf-8');

    expect(source).toContain("loadStoryDefinitionSync('project-surface-handoff-continuity')");
    expect(source).toContain('PROJECT_SURFACE_HANDOFF_STORY_BINDING');
    expect(source).toContain('captureProjectSurfaceHandoffContinuity');
    expect(source).toContain('sidebar__nav-item--chat');
    expect(source).toContain('sidebar__nav-item--notebook');
    expect(source).toContain('sidebar__nav-item--files');
    expect(source).toContain('sidebar__nav-item--overview');
    expect(source).not.toContain('resume-last-surface');
    expect(source).not.toContain('recent surface');
  });
});
