import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('project surface handoff continuity story', () => {
  it('defines the daily-work story as overview to chat to Agent Task to files and back to overview', () => {
    const story = loadStoryDefinitionSync('project-surface-handoff-continuity');

    expect(story.storyId).toBe('project-surface-handoff-continuity');
    expect(story.actor).toBe('project member');
    expect(story.goal).toContain('overview');
    expect(story.goal).toContain('chat');
    expect(story.goal).toContain('Agent Task');
    expect(story.goal).toContain('files');
    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'project-overview',
      'project-chat',
      'project-agent-tasks',
      'project-files',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-project-overview',
      'handoff-to-chat',
      'handoff-to-agent-tasks',
      'handoff-to-files',
      'return-to-overview',
    ]);

    const filesScene = story.scenes.find((scene) => scene.sceneId === 'project-files');
    expect(filesScene?.stableMarkers).toContain('files__workspace-surface');
    expect(filesScene?.stableMarkers).toContain('files__library-list');
    expect(filesScene?.stableMarkers).not.toContain('project-workbench__heading');
  });

  it('wires the existing real backend visual review spec to the new handoff story and sidebar continuity helper', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-visual-review.spec.ts'), 'utf-8');

    expect(source).toContain("loadStoryDefinitionSync('project-surface-handoff-continuity')");
    expect(source).toContain('PROJECT_SURFACE_HANDOFF_STORY_BINDING');
    expect(source).toContain('captureProjectSurfaceHandoffContinuity');
    expect(source).toContain('sidebar__nav-item--chat');
    expect(source).toContain('sidebar__nav-item--agent-tasks');
    expect(source).toContain('sidebar__nav-item--files');
    expect(source).toContain('sidebar__nav-item--overview');
    expect(source).not.toContain('resume-last-surface');
    expect(source).not.toContain('recent surface');
  });
});
