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
        'mock-lane-entry-access',
        'release-user-story-end-to-end',
        'real-backend-visual-review',
        'workspace-entry-and-project-discovery',
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
  "family": "contract-owned-parser",
  "personas": ["reviewer"],
  "kind": "journey",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["trace"]
  },
  "externalDependencies": [],
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

  it('rejects unsafe visual code refs before they can become unverifiable review evidence', () => {
    const buildStoryWithCodeRef = (codeRef: string) => `
---
{
  "storyId": "unsafe-code-ref",
  "title": "Unsafe code ref",
  "actor": "reviewer",
  "lane": "mock-lane",
  "family": "visual-review",
  "personas": ["reviewer"],
  "kind": "review",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["visual"]
  },
  "externalDependencies": [],
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/chat",
  "goal": "Verify visual code refs remain repository-relative files.",
  "narrative": "Visual review evidence must point at committed code and not arbitrary local or remote paths.",
  "scenes": [
    {
      "sceneId": "chat",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "stableMarkers": ["chat__surface"]
    }
  ],
  "steps": [
    {
      "stepId": "open-chat",
      "sceneId": "chat",
      "intent": "Open chat",
      "action": "Open chat",
      "target": "chat__surface",
      "expectedFeedback": "Chat surface is visible",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "chat",
          "scenarioId": "chat",
          "scenario": "Chat surface visual review.",
          "group": "project_pages",
          "codeRefs": ["${codeRef}"],
          "capture": "full_page"
        }
      ]
    }
  }
}
---
`;

    expect(() => parseStoryDefinition(buildStoryWithCodeRef('/tmp/outside.ts'))).toThrow(/code ref/i);
    expect(() => parseStoryDefinition(buildStoryWithCodeRef('../outside.ts'))).toThrow(/code ref/i);
    expect(() => parseStoryDefinition(buildStoryWithCodeRef('https://example.com/source.ts'))).toThrow(/code ref/i);
  });

  it('rejects visual scenes that do not expose story-owned stable markers for executor waits', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "missing-visual-markers",
  "title": "Missing visual markers",
  "actor": "reviewer",
  "lane": "mock-lane",
  "family": "visual-review",
  "personas": ["reviewer"],
  "kind": "review",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["visual"]
  },
  "externalDependencies": [],
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/chat",
  "goal": "Verify visual scenes wait on explicit stable markers.",
  "narrative": "A visual scene without stable markers can pass before the user-visible state is ready.",
  "scenes": [
    {
      "sceneId": "chat",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "stableMarkers": []
    }
  ],
  "steps": [
    {
      "stepId": "open-chat",
      "sceneId": "chat",
      "intent": "Open chat",
      "action": "Open chat",
      "target": "chat__surface",
      "expectedFeedback": "Chat surface is visible",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "chat",
          "scenarioId": "chat",
          "scenario": "Chat surface visual review.",
          "group": "project_pages",
          "codeRefs": ["e2e/visual.spec.ts"],
          "capture": "full_page"
        }
      ]
    }
  }
}
---
`),
    ).toThrow(/stable markers/i);
  });

  it('rejects empty story-owned visual semantic assertions before they enter the screenshot catalog', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "empty-visual-semantic-assertion",
  "title": "Empty visual semantic assertion",
  "actor": "reviewer",
  "lane": "mock-lane",
  "family": "visual-review",
  "personas": ["reviewer"],
  "kind": "review",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["visual"]
  },
  "externalDependencies": [],
  "entryRoute": "/en-US/workspaces/overview",
  "goal": "Verify visual semantic assertions stay explicit and reviewable.",
  "narrative": "Visual review evidence should fail fast when a story declares meaningless semantic acceptance rules.",
  "scenes": [
    {
      "sceneId": "workspace-overview",
      "route": "/en-US/workspaces/overview",
      "stableMarkers": ["workspace-overview__list"]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-overview",
      "sceneId": "workspace-overview",
      "intent": "Open workspace overview",
      "action": "Open workspace overview",
      "target": "workspace-overview__list",
      "expectedFeedback": "Workspace overview is ready for review",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "workspace-overview",
          "scenarioId": "workspace-overview",
          "scenario": "Workspace overview visual review.",
          "group": "workspace_pages",
          "codeRefs": ["e2e/visual.spec.ts"],
          "capture": "full_page",
          "semanticAssertions": {
            "forbiddenVisibleText": ["Invalid Date", ""]
          }
        }
      ]
    }
  }
}
---
`),
    ).toThrow(/semantic assertion/i);
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
