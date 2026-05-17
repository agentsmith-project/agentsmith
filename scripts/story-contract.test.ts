import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildStoryFingerprint,
  buildStoryStepMapFingerprint,
  resolveStoryTraceOrderContract,
  type StoryDefinition,
} from '../e2e/story-contract';
import { loadAllStoryDefinitions, loadStoryDefinition, parseStoryDefinition } from '../e2e/story-loader';
import {
  CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP,
  CURRENT_RELEASE_PRECHECK_MOVED_BROWSER_SPECS,
} from './governance/current-gate-manifest';

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

function requiredScreenshotStepIds(story: StoryDefinition): string[] {
  return story.steps
    .filter((step) => step.evidence.includes('trace') && !step.optional && step.sceneId)
    .map((step) => step.stepId);
}

function collectStringLiterals(value: string): string[] {
  return [...value.matchAll(/['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);
}

function collectTraceStepUsage(source: string): {
  capturedStepIds: Set<string>;
  notedStepIds: Set<string>;
} {
  const capturedStepIds = new Set<string>();
  const notedStepIds = new Set<string>();

  for (const match of source.matchAll(/trace\.capture\([\s\S]*?\bstepId:\s*['"`]([^'"`]+)['"`][\s\S]*?\}\s*\)/g)) {
    capturedStepIds.add(match[1]);
  }
  for (const match of source.matchAll(/trace\.note\(\s*\{[\s\S]*?\bstepId:\s*['"`]([^'"`]+)['"`]/g)) {
    notedStepIds.add(match[1]);
  }

  const captureWrapperNames = [...source.matchAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\([^)]*\bstepId\b[^)]*\)[\s\S]*?=>\s*\{[\s\S]*?trace\.capture\(/g,
  )].map((match) => match[1]);
  for (const wrapperName of captureWrapperNames) {
    const wrapperCallPattern = new RegExp(`\\b${wrapperName}\\s*\\(([^;\\n]+)\\)`, 'g');
    for (const match of source.matchAll(wrapperCallPattern)) {
      for (const literal of collectStringLiterals(match[1])) {
        capturedStepIds.add(literal);
      }
    }
  }

  return {
    capturedStepIds,
    notedStepIds,
  };
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

  it('derives the default trace order contract from canonical story step order', async () => {
    const story = await loadStoryDefinition('release-user-story-end-to-end');
    const expectedOrderedStepIds = story.steps
      .filter((step) => step.evidence.includes('trace') && !step.optional)
      .map((step) => step.stepId);

    expect(resolveStoryTraceOrderContract(story)).toEqual({
      mode: 'strict_sequence',
      orderedStepIds: expectedOrderedStepIds,
    });
  });

  it('keeps release UX trace membership screenshot steps captured by their owning specs', async () => {
    const releaseMembershipStoryIds = new Set(
      CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP.map((membership) => membership.storyId),
    );
    const failures: string[] = [];

    for (const spec of CURRENT_RELEASE_PRECHECK_MOVED_BROWSER_SPECS) {
      const source = await readFile(path.resolve(spec.specFile), 'utf-8');
      const usage = collectTraceStepUsage(source);

      for (const storyId of spec.storyIds) {
        expect(releaseMembershipStoryIds.has(storyId)).toBe(true);
        const story = await loadStoryDefinition(storyId);

        for (const stepId of requiredScreenshotStepIds(story)) {
          if (usage.notedStepIds.has(stepId)) {
            failures.push(`${spec.specFile} ${storyId}/${stepId} must use trace.capture, not trace.note`);
          }
          if (!usage.capturedStepIds.has(stepId)) {
            failures.push(`${spec.specFile} ${storyId}/${stepId} is missing trace.capture screenshot evidence`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
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

  it('rejects step targets that resolve to another scene stable marker inside the same story', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "cross-scene-target-drift",
  "title": "Cross scene target drift",
  "actor": "reviewer",
  "lane": "mock-lane",
  "family": "scene-target-coherence",
  "personas": ["reviewer"],
  "kind": "journey",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": ["trace"]
  },
  "externalDependencies": [],
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/overview",
  "goal": "Verify story steps cannot point at another scene's stable marker.",
  "narrative": "Scene ownership should stay coherent so traces do not encode cross-scene aliases.",
  "scenes": [
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/overview",
      "stableMarkers": ["project-overview__page", "project-overview__primary-cta"]
    },
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "stableMarkers": ["chat__surface"]
    }
  ],
  "steps": [
    {
      "stepId": "cross-scene-action",
      "sceneId": "project-chat",
      "intent": "Attempt to bind a chat scene step to an overview target.",
      "action": "Start first chat work",
      "target": "project-overview__primary-cta",
      "expectedFeedback": "The step should fail validation because the target belongs to another scene.",
      "evidence": ["trace"]
    }
  ]
}
---
`),
    ).toThrow(/cross-scene|scene.*target|target.*scene/i);
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

  it('rejects malformed surface-scoped semantic target references before visual runtime', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "invalid-surface-scoped-semantic-target",
  "title": "Invalid surface scoped semantic target",
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
  "entryRoute": "/en-US/system/workspaces",
  "goal": "Verify surface-scoped semantic targets stay structurally valid before runtime.",
  "narrative": "Scoped semantic targets must resolve to a unique surface and a concrete target test id.",
  "scenes": [
    {
      "sceneId": "system-workspaces-default",
      "route": "/en-US/system/workspaces",
      "stableMarkers": ["system-workspaces__list", "system-workspaces__editor"]
    }
  ],
  "steps": [
    {
      "stepId": "open-system-workspaces",
      "sceneId": "system-workspaces-default",
      "intent": "Open system workspaces",
      "action": "Open system workspaces",
      "target": "system-workspaces__list",
      "expectedFeedback": "System workspaces are ready for review",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "system-workspaces-default",
          "scenarioId": "system-workspaces-default",
          "scenario": "System workspaces visual review.",
          "group": "system_pages",
          "codeRefs": ["e2e/visual.spec.ts"],
          "capture": "full_page",
          "semanticAssertions": {
            "requiredViewerLocalDateTimeTestIds": ["system-workspaces__editor::"],
            "primaryActionTestIds": ["::system-workspaces__new-workspace", "page-layout__header::system-workspaces__new-workspace::extra"]
          }
        }
      ]
    }
  }
}
---
`),
    ).toThrow(/surface-scoped semantic target/i);
  });

  it('rejects surface-scoped prominent action scope ids because scope and target must stay separate', () => {
    expect(() =>
      parseStoryDefinition(`
---
{
  "storyId": "invalid-prominent-action-scope",
  "title": "Invalid prominent action scope",
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
  "entryRoute": "/en-US/system/workspaces",
  "goal": "Verify prominent action scope ids stay scope-only before visual runtime.",
  "narrative": "Prominent action scope ids should name unique visible scope containers instead of mixing scope and target.",
  "scenes": [
    {
      "sceneId": "system-workspaces-default",
      "route": "/en-US/system/workspaces",
      "stableMarkers": ["system-workspaces__list", "system-workspaces__editor"]
    }
  ],
  "steps": [
    {
      "stepId": "open-system-workspaces",
      "sceneId": "system-workspaces-default",
      "intent": "Open system workspaces",
      "action": "Open system workspaces",
      "target": "system-workspaces__list",
      "expectedFeedback": "System workspaces are ready for review",
      "evidence": ["visual"]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "system-workspaces-default",
          "scenarioId": "system-workspaces-default",
          "scenario": "System workspaces visual review.",
          "group": "system_pages",
          "codeRefs": ["e2e/visual.spec.ts"],
          "capture": "full_page",
          "semanticAssertions": {
            "prominentActionScopeTestIds": ["page-layout__header::system-workspaces__new-workspace"]
          }
        }
      ]
    }
  }
}
---
`),
    ).toThrow(/prominent action scope/i);
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
