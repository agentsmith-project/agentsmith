import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStoryFingerprint, buildStoryStepMapFingerprint, type StoryDefinition } from '../e2e/story-contract';
import { loadAllStoryDefinitions, loadStoryDefinition, parseStoryDefinition } from '../e2e/story-loader';

function expectStableStory(story: StoryDefinition) {
  expect(story.filePath.endsWith('.story.md')).toBe(true);
  expect(story.storyId.length).toBeGreaterThan(0);
  expect(story.title.length).toBeGreaterThan(0);
  expect(story.actor.length).toBeGreaterThan(0);
  expect(story.goal.length).toBeGreaterThan(0);
  expect(story.entryRoute.startsWith('/')).toBe(true);
  expect(story.steps.length).toBeGreaterThan(0);
  expect(new Set(story.steps.map((step) => step.stepId)).size).toBe(story.steps.length);
  expect(new Set(story.scenes.map((scene) => scene.sceneId)).size).toBe(story.scenes.length);
}

describe('story contract', () => {
  it('loads committed canonical stories from markdown source files', async () => {
    const stories = await loadAllStoryDefinitions();

    expect(stories.length).toBeGreaterThanOrEqual(2);
    expect(stories.map((story) => story.storyId)).toEqual(
      expect.arrayContaining([
        'release-user-story-end-to-end',
        'real-backend-visual-review',
      ]),
    );

    for (const story of stories) {
      expectStableStory(story);
    }
  });

  it('loads a single story by id and keeps fingerprint generation deterministic', async () => {
    const story = await loadStoryDefinition('release-user-story-end-to-end');

    expect(story.storyId).toBe('release-user-story-end-to-end');
    expect(story.steps.map((step) => step.stepId)).toContain('system-login');
    expect(buildStoryFingerprint(story)).toBe(buildStoryFingerprint(story));
    expect(buildStoryStepMapFingerprint(story)).toBe(buildStoryStepMapFingerprint(story));
  });

  it('loads story markdown parsing through story-loader instead of story-contract', () => {
    const story = parseStoryDefinition(`
---
{
  "storyId": "contract-owned-parser",
  "title": "Contract owned parser",
  "actor": "reviewer",
  "lane": "mock-lane",
  "entryRoute": "/en-US/workspaces/ws_default",
  "goal": "Verify the parser lives in story-loader.",
  "narrative": "Story parsing should stay in story-loader so story-contract can remain schema-only.",
  "scenes": [
    {
      "sceneId": "workspace-home",
      "route": "/en-US/workspaces/ws_default",
      "stableMarkers": ["workspace-home__heading"]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-home",
      "sceneId": "workspace-home",
      "intent": "Open workspace home",
      "action": "Open workspace home",
      "target": "workspace-home__heading",
      "expectedFeedback": "Workspace home heading is visible",
      "evidence": ["trace"]
    }
  ]
}
---
`);

    expect(story.storyId).toBe('contract-owned-parser');
    expect(story.steps.map((step) => step.stepId)).toEqual(['open-workspace-home']);
  });

  it('keeps story-contract focused on schema/fingerprint helpers instead of parser and loader logic', async () => {
    const contractSource = await readFile(path.resolve('e2e/story-contract.ts'), 'utf-8');
    const loaderSource = await readFile(path.resolve('e2e/story-loader.ts'), 'utf-8');

    expect(contractSource).not.toContain('release-user-story-end-to-end');
    expect(contractSource).not.toContain('real-backend-visual-review');
    expect(contractSource).not.toContain('loadAllStoryDefinitions');
    expect(contractSource).not.toContain('loadStoryDefinition');
    expect(contractSource).not.toContain('parseStoryDefinition');
    expect(contractSource).not.toContain("from './story-loader'");
    expect(contractSource).toContain('buildStoryFingerprint');
    expect(contractSource).toContain('validateStoryDefinition');

    expect(loaderSource).toContain('parseStoryDefinition');
    expect(loaderSource).toContain('readStoryDefinitionFromMarkdown');
    expect(loaderSource).not.toContain("export * from './story-contract'");
  });
});
