import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllStoryDefinitions, loadStoryDefinition, parseStoryDefinition } from '../e2e/story-loader';

function buildJsonFrontmatterStory(overrides: Record<string, unknown> = {}): string {
  const story = {
    storyId: 'sample-story',
    title: 'Sample story',
    actor: 'project owner',
    lane: 'mock-lane',
    entryRoute: '/en-US/workspaces/ws_default/projects',
    goal: 'Validate a story definition contract.',
    preconditions: ['mocks are ready'],
    seedData: ['ws_default'],
    narrative: 'Project owners need a stable path to inspect project state before they enter governance views.',
    scenes: [
      {
        sceneId: 'workspace-projects',
        route: '/en-US/workspaces/ws_default/projects',
        recipeFamily: 'work_surface_standard',
        authLane: 'authed',
        stableMarkers: ['projects__heading'],
      },
    ],
    steps: [
      {
        stepId: 'workspace-projects-open',
        sceneId: 'workspace-projects',
        intent: 'Open the projects list',
        action: 'Open workspace projects',
        target: 'projects__heading',
        expectedFeedback: 'Project list heading is visible',
        evidence: ['trace', 'visual'],
        note: 'Workspace projects list is the stable first project surface.',
      },
    ],
    runtimeData: {
      notebook: {
        external_create: {
          turnOne: {
            prompt: 'Create notes/external_story.txt and reply with EXT_T1_OK.',
            expectedToken: 'EXT_T1_OK',
            expectedArtifactPath: '.artifacts/external_summary.md',
          },
        },
      },
    },
    ...overrides,
  };

  return `---\n${JSON.stringify(story, null, 2)}\n---\n`;
}

describe('story loader', () => {
  it('parses a json frontmatter story into structured metadata, scenes, and steps', () => {
    const story = parseStoryDefinition(buildJsonFrontmatterStory());

    expect(story.storyId).toBe('sample-story');
    expect(story.preconditions).toEqual(['mocks are ready']);
    expect(story.seedData).toEqual(['ws_default']);
    expect(story.scenes).toEqual([
      {
        sceneId: 'workspace-projects',
        route: '/en-US/workspaces/ws_default/projects',
        recipeFamily: 'work_surface_standard',
        authLane: 'authed',
        stableMarkers: ['projects__heading'],
      },
    ]);
    expect(story.steps).toEqual([
      {
        stepId: 'workspace-projects-open',
        sceneId: 'workspace-projects',
        intent: 'Open the projects list',
        action: 'Open workspace projects',
        target: 'projects__heading',
        expectedFeedback: 'Project list heading is visible',
        evidence: ['trace', 'visual'],
        note: 'Workspace projects list is the stable first project surface.',
        optional: false,
      },
    ]);
    expect(story.runtimeData).toEqual({
      notebook: {
        external_create: {
          turnOne: {
            prompt: 'Create notes/external_story.txt and reply with EXT_T1_OK.',
            expectedToken: 'EXT_T1_OK',
            expectedArtifactPath: '.artifacts/external_summary.md',
          },
        },
      },
    });
    expect(Object.keys(story.runtimeData?.notebook?.external_create ?? {})).toEqual(['turnOne']);
  });

  it('rejects section-style story markup because the loader only accepts json frontmatter stories', () => {
    expect(() =>
      parseStoryDefinition(`---\nstory_id: section-style-story\ntitle: Section style story\nactor: workspace admin\nlane: mock-lane\nentry_route: /en-US/workspaces/ws_default\ngoal: Must be rejected.\n---\n\n## Narrative\n\nThis format is no longer canonical.\n\n## Scenes\n\n\`\`\`json\n[]\n\`\`\`\n\n## Steps\n\n\`\`\`json\n[\n  {\n    \"step_id\": \"open\",\n    \"intent\": \"Open route\",\n    \"action\": \"Open page\",\n    \"target\": \"page__heading\",\n    \"expected_feedback\": \"Page is visible\",\n    \"evidence\": [\"trace\"]\n  }\n]\n\`\`\`\n`),
    ).toThrow(/json frontmatter/i);
  });

  it('discovers only the canonical backend-real story markdown files from the committed story root', async () => {
    const stories = await loadAllStoryDefinitions();

    expect(stories.map((story) => story.filePath.replace(/\\/g, '/'))).toEqual([
      path.resolve('e2e/stories/backend-real/real-backend-visual-review.story.md').replace(/\\/g, '/'),
      path.resolve('e2e/stories/backend-real/release-user-story-end-to-end.story.md').replace(/\\/g, '/'),
    ]);
  });

  it('does not keep committed story markdown files at the story root', async () => {
    const rootEntries = await readdir(path.resolve('e2e/stories'), { withFileTypes: true });
    expect(rootEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.story.md'))).toEqual([]);
  });

  it('rejects file/name drift when a story id does not match the story filename', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-story-contract-'));
    try {
      const filePath = path.join(rootDir, 'wrong-name.story.md');
      await writeFile(
        filePath,
        `---\n${JSON.stringify(
          {
            storyId: 'another-name',
            title: 'Mismatched story',
            actor: 'project owner',
            lane: 'mock-lane',
            entryRoute: '/en-US/workspaces/ws_default',
            goal: 'Detect filename drift.',
            narrative: 'This story should fail because the file stem and story id diverge.',
            scenes: [],
            steps: [
              {
                stepId: 'open',
                intent: 'Open page',
                action: 'Open route',
                target: 'page__heading',
                expectedFeedback: 'Page is visible',
                evidence: ['trace'],
              },
            ],
          },
          null,
          2,
        )}\n---\n`,
        'utf-8',
      );

      await expect(loadStoryDefinition(filePath)).rejects.toThrow(/filename/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate story ids across recursively discovered backend-real story files', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-story-duplicates-'));
    try {
      await mkdir(path.join(rootDir, 'backend-real', 'nested'), { recursive: true });
      const sharedStory = (title: string) =>
        `---\n${JSON.stringify(
          {
            storyId: 'duplicate-story',
            title,
            actor: 'workspace admin',
            lane: 'mock-lane',
            entryRoute: '/en-US/workspaces/ws_default',
            goal: 'Detect duplicate story ids.',
            narrative: 'This story exists to make sure duplicate story ids are rejected at load time.',
            scenes: [],
            steps: [
              {
                stepId: 'open',
                intent: 'Open route',
                action: 'Open page',
                target: 'page__heading',
                expectedFeedback: 'Page is visible',
                evidence: ['trace'],
              },
            ],
          },
          null,
          2,
        )}\n---\n`;

      await writeFile(path.join(rootDir, 'backend-real', 'duplicate-story.story.md'), sharedStory('Duplicate one'), 'utf-8');
      await writeFile(
        path.join(rootDir, 'backend-real', 'nested', 'duplicate-story.story.md'),
        sharedStory('Duplicate two'),
        'utf-8',
      );

      await expect(loadAllStoryDefinitions({ rootDir })).rejects.toThrow(/duplicate story id/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('recursively loads nested canonical backend-real story files', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-story-root-only-'));
    try {
      await mkdir(path.join(rootDir, 'backend-real', 'nested'), { recursive: true });
      await writeFile(
        path.join(rootDir, 'backend-real', 'root-story.story.md'),
        `---\n${JSON.stringify(
          {
            storyId: 'root-story',
            title: 'Root story',
            actor: 'workspace admin',
            lane: 'mock-lane',
            entryRoute: '/en-US/workspaces/ws_default',
            goal: 'Keep stories under backend-real.',
            narrative: 'Root-level canonical story.',
            scenes: [],
            steps: [
              {
                stepId: 'open',
                intent: 'Open route',
                action: 'Open page',
                target: 'page__heading',
                expectedFeedback: 'Page is visible',
                evidence: ['trace'],
              },
            ],
          },
          null,
          2,
        )}\n---\n`,
        'utf-8',
      );
      await writeFile(
        path.join(rootDir, 'backend-real', 'nested', 'nested-story.story.md'),
        `---\n${JSON.stringify(
          {
            storyId: 'nested-story',
            title: 'Nested story',
            actor: 'workspace admin',
            lane: 'mock-lane',
            entryRoute: '/en-US/workspaces/ws_default',
            goal: 'Should be loaded recursively.',
            narrative: 'Nested story.',
            scenes: [],
            steps: [
              {
                stepId: 'open',
                intent: 'Open route',
                action: 'Open page',
                target: 'page__heading',
                expectedFeedback: 'Page is visible',
                evidence: ['trace'],
              },
            ],
          },
          null,
          2,
        )}\n---\n`,
        'utf-8',
      );

      const stories = await loadAllStoryDefinitions({ rootDir });
      expect(stories.map((story) => story.storyId)).toEqual(['nested-story', 'root-story']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
