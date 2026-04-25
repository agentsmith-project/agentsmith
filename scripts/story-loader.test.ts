import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listCommittedStoryMarkdownFiles,
  loadCommittedStoryDefinitions,
  loadCommittedStoryDefinitionById,
} from './story-catalog-support';
import {
  getRequiredStoryVisualSceneBundle,
  listStorySceneIds,
  listStoryVisualSceneIds,
} from './story-visual-scene-fixtures';
import { loadAllStoryDefinitions, loadStoryDefinition, parseStoryDefinition } from '../e2e/story-loader';

function buildJsonFrontmatterStory(overrides: Record<string, unknown> = {}): string {
  const story = {
    storyId: 'sample-story',
    title: 'Sample story',
    actor: 'project owner',
    lane: 'mock-lane',
    family: 'workspace-governance',
    personas: ['project owner', 'workspace admin'],
    kind: 'journey',
    gatePolicy: {
      tier: 'default',
      requiredEvidence: ['trace', 'visual'],
    },
    externalDependencies: [
      {
        dependencyId: 'msw-auth',
        kind: 'service',
        required: true,
        note: 'Mock auth lane must be available.',
      },
    ],
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
    expect(story.family).toBe('workspace-governance');
    expect(story.personas).toEqual(['project owner', 'workspace admin']);
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace', 'visual'],
    });
    expect(story.externalDependencies).toEqual([
      {
        dependencyId: 'msw-auth',
        kind: 'service',
        required: true,
        note: 'Mock auth lane must be available.',
      },
    ]);
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

  it.each([
    ['family', { family: undefined }],
    ['personas', { personas: undefined }],
    ['kind', { kind: undefined }],
    ['gatePolicy', { gatePolicy: undefined }],
    ['externalDependencies', { externalDependencies: undefined }],
  ] as const)('rejects missing canonical story metadata for %s instead of deriving defaults', (_field, overrides) => {
      const story = {
        storyId: 'missing-canonical-metadata',
        title: 'Missing canonical metadata',
        actor: 'system 管理侧 / project owner',
        lane: 'mock-lane',
        family: 'missing-canonical-metadata',
        personas: ['system 管理侧', 'project owner'],
        kind: 'journey',
      gatePolicy: {
        tier: 'default',
        requiredEvidence: ['trace'],
      },
      externalDependencies: [],
      entryRoute: '/en-US/workspaces/ws_default',
      goal: 'Verify the loader rejects missing canonical metadata.',
      narrative: 'This story intentionally omits canonical story pyramid metadata.',
      scenes: [
        {
          sceneId: 'workspace-home',
          route: '/en-US/workspaces/ws_default',
          recipeFamily: 'work_surface_standard',
          authLane: 'authed',
          stableMarkers: ['workspace-home__heading'],
        },
      ],
      steps: [
        {
          stepId: 'workspace-home-open',
          sceneId: 'workspace-home',
          intent: 'Open workspace home',
          action: 'Open workspace home',
          target: 'workspace-home__heading',
          expectedFeedback: 'Workspace home heading is visible',
          evidence: ['trace'],
        },
      ],
      ...overrides,
    };

    const frontmatter = `---\n${JSON.stringify(story, null, 2)}\n---\n`;
    expect(() => parseStoryDefinition(frontmatter)).toThrow(/missing frontmatter key|frontmatter key kind|invalid|must define/i);
  });

  it('loads explicit runtime visual review scenes from the story contract instead of a separate visual parser', async () => {
    const story = await loadCommittedStoryDefinitionById('mock-lane-chat-operate-and-recover');
    const providerCapacity = getRequiredStoryVisualSceneBundle(
      story,
      'chat-provider-capacity-retry',
    );

    expect(listStoryVisualSceneIds(story)).toEqual(listStorySceneIds(story));
    expect(providerCapacity.visualScene).toMatchObject({
      sceneId: 'chat-provider-capacity-retry',
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'chat__stream-error-recovery',
          'chat__stream-error-message',
          'chat__composer-recovery-endpoint--ep_2',
        ]),
        prominentActionScopeTestIds: ['chat__composer-recovery-shell'],
      },
    });
  });

  it('keeps notebook lifecycle visual scenes anchored to same-surface running and terminal recovery contracts', async () => {
    const story = await loadCommittedStoryDefinitionById('mock-lane-notebook-task-lifecycle');
    const running = getRequiredStoryVisualSceneBundle(story, 'notebook-task-running');
    const hiddenTerminalBlocked = getRequiredStoryVisualSceneBundle(
      story,
      'notebook-hidden-terminal-blocked',
    );
    const terminalTruthUnavailable = getRequiredStoryVisualSceneBundle(
      story,
      'notebook-terminal-truth-unavailable',
    );

    expect(listStoryVisualSceneIds(story)).toEqual(listStorySceneIds(story));
    expect(running.storyScene.stableMarkers).toContain('notebook__run-active-cancel');
    expect(running.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['notebook__run-active-cancel']),
    );

    expect(hiddenTerminalBlocked.storyScene.stableMarkers).toEqual(
      expect.arrayContaining([
        'notebook__task-terminal-status-action',
        'notebook__task-terminal-status-end-all',
      ]),
    );
    expect(hiddenTerminalBlocked.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining([
        'notebook__task-terminal-status-action',
        'notebook__task-terminal-status-end-all',
      ]),
    );
    expect(hiddenTerminalBlocked.visualScene.semanticAssertions?.requiredViewportTestIds).not.toContain(
      'notebook__conversation-blocked-action',
    );

    expect(terminalTruthUnavailable.storyScene.stableMarkers).toContain(
      'notebook__task-terminal-truth-unavailable-retry',
    );
    expect(terminalTruthUnavailable.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['notebook__task-terminal-truth-unavailable-retry']),
    );
    expect(terminalTruthUnavailable.visualScene.semanticAssertions?.requiredViewportTestIds).not.toContain(
      'notebook__conversation-blocked-action',
    );
  });

  it('rejects section-style story markup because the loader only accepts json frontmatter stories', () => {
    expect(() =>
      parseStoryDefinition(`---\nstory_id: section-style-story\ntitle: Section style story\nactor: workspace admin\nlane: mock-lane\nentry_route: /en-US/workspaces/ws_default\ngoal: Must be rejected.\n---\n\n## Narrative\n\nThis format is no longer canonical.\n\n## Scenes\n\n\`\`\`json\n[]\n\`\`\`\n\n## Steps\n\n\`\`\`json\n[\n  {\n    \"step_id\": \"open\",\n    \"intent\": \"Open route\",\n    \"action\": \"Open page\",\n    \"target\": \"page__heading\",\n    \"expected_feedback\": \"Page is visible\",\n    \"evidence\": [\"trace\"]\n  }\n]\n\`\`\`\n`),
    ).toThrow(/json frontmatter/i);
  });

  it('discovers only committed story markdown files from canonical lane directories under the story root', async () => {
    const [stories, committedFiles] = await Promise.all([
      loadCommittedStoryDefinitions(),
      listCommittedStoryMarkdownFiles(),
    ]);

    const committedStoryIds = committedFiles.map((filePath) => path.basename(filePath, '.story.md'));
    expect(stories.map((story) => story.storyId)).toEqual(committedStoryIds);
    expect(
      stories.every((story) =>
        /(\/|\\)e2e(\/|\\)stories(\/|\\)(backend-real|mock-lane)(\/|\\).+\.story\.md$/.test(story.filePath),
      ),
    ).toBe(true);
    expect(new Set(committedStoryIds).size).toBe(committedStoryIds.length);
  });

  it('does not keep committed story markdown files at the story root', async () => {
    const rootEntries = await readdir(path.resolve('e2e/stories'), { withFileTypes: true });
    expect(rootEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.story.md'))).toEqual([]);
  });

  it('keeps backend-real governance and admin stories on explicit gatePolicy tiers instead of inheriting release by default', async () => {
    const [systemAdminEntry, onboarding, runtimeSetup, workspaceEntry, personalContext, filesManagement, memberInvite, workspacePublish] = await Promise.all([
      loadCommittedStoryDefinitionById('system-admin-entry'),
      loadCommittedStoryDefinitionById('project-governance-onboarding'),
      loadCommittedStoryDefinitionById('project-governance-runtime-setup'),
      loadCommittedStoryDefinitionById('workspace-entry-and-project-discovery'),
      loadCommittedStoryDefinitionById('workspace-project-personal-context'),
      loadCommittedStoryDefinitionById('files-library-access-and-recovery'),
      loadCommittedStoryDefinitionById('members-invite-and-chat-privacy'),
      loadCommittedStoryDefinitionById('workspace-publish-to-usable-access'),
    ]);

    expect(systemAdminEntry.gatePolicy).toEqual({
      tier: 'release',
      requiredEvidence: ['trace'],
    });
    expect(onboarding.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(runtimeSetup.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(workspaceEntry.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(personalContext.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(filesManagement.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(memberInvite.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(workspacePublish.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
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
            family: 'duplicate-story',
            personas: ['project owner'],
            kind: 'journey',
            gatePolicy: {
              tier: 'default',
              requiredEvidence: ['trace'],
            },
            externalDependencies: [],
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
            lane: 'backend-real',
            family: 'duplicate-story',
            personas: ['workspace admin'],
            kind: 'journey',
            gatePolicy: {
              tier: 'default',
              requiredEvidence: ['trace'],
            },
            externalDependencies: [],
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
            lane: 'backend-real',
            family: 'root-story',
            personas: ['workspace admin'],
            kind: 'journey',
            gatePolicy: {
              tier: 'default',
              requiredEvidence: ['trace'],
            },
            externalDependencies: [],
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
            lane: 'backend-real',
            family: 'nested-story',
            personas: ['workspace admin'],
            kind: 'journey',
            gatePolicy: {
              tier: 'default',
              requiredEvidence: ['trace'],
            },
            externalDependencies: [],
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

  it('loads stories from both backend-real and mock-lane canonical directories but ignores non-lane roots', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-story-lanes-'));
    try {
      await mkdir(path.join(rootDir, 'backend-real'), { recursive: true });
      await mkdir(path.join(rootDir, 'mock-lane'), { recursive: true });
      await mkdir(path.join(rootDir, 'notes'), { recursive: true });

      await writeFile(
        path.join(rootDir, 'backend-real', 'backend-story.story.md'),
        buildJsonFrontmatterStory({
          storyId: 'backend-story',
          title: 'Backend story',
          lane: 'backend-real',
          actor: 'system 管理侧 / project owner',
          family: 'release-validation',
          kind: 'journey',
          gatePolicy: {
            tier: 'release',
            requiredEvidence: ['trace'],
          },
          steps: [
            {
              stepId: 'backend-open',
              intent: 'Open backend story',
              action: 'Open backend story',
              target: 'page__heading',
              expectedFeedback: 'Backend story visible',
              evidence: ['trace'],
            },
          ],
        }),
        'utf-8',
      );
      await writeFile(
        path.join(rootDir, 'mock-lane', 'mock-story.story.md'),
        buildJsonFrontmatterStory({
          storyId: 'mock-story',
          title: 'Mock story',
          lane: 'mock-lane',
          family: 'self-service',
          kind: 'review',
        }),
        'utf-8',
      );
      await writeFile(
        path.join(rootDir, 'notes', 'ignored.story.md'),
        buildJsonFrontmatterStory({
          storyId: 'ignored',
          title: 'Ignored',
          lane: 'mock-lane',
        }),
        'utf-8',
      );

      const stories = await loadAllStoryDefinitions({ rootDir });
      expect(stories.map((story) => story.storyId)).toEqual(['backend-story', 'mock-story']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects lane directory drift when the story lane does not match the committed lane directory', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-story-lane-drift-'));
    try {
      await mkdir(path.join(rootDir, 'mock-lane'), { recursive: true });
      await writeFile(
        path.join(rootDir, 'mock-lane', 'lane-drift.story.md'),
        buildJsonFrontmatterStory({
          storyId: 'lane-drift',
          title: 'Lane drift',
          lane: 'backend-real',
        }),
        'utf-8',
      );

      await expect(loadAllStoryDefinitions({ rootDir })).rejects.toThrow(/lane directory/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
