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
    const story = await loadStoryDefinition('mock-lane-chat-operate-and-recover');

    expect(story.runtimeData?.visualReview?.scenes).toEqual([
      {
        sceneId: 'chat-operate',
        scenarioId: 'chat-operate',
        scenario: expect.stringContaining('active thread'),
        group: 'project_pages',
        codeRefs: expect.arrayContaining([
          'e2e/visual.spec.ts',
          'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx',
          'src/components/chat/ChatMainPane.tsx',
          'src/components/chat/ChatHeader.tsx',
          'src/components/chat/ThreadsPane.tsx',
        ]),
        capture: 'full_page',
        authLane: 'authed',
        themes: ['light', 'dark'],
      },
      {
        sceneId: 'chat-recover-empty',
        scenarioId: 'chat-recover-empty',
        scenario: expect.stringContaining('search results filtered to zero'),
        group: 'project_pages',
        codeRefs: expect.arrayContaining([
          'e2e/visual.spec.ts',
          'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx',
          'src/components/chat/ChatMainPane.tsx',
          'src/components/chat/ThreadsPane.tsx',
        ]),
        capture: 'full_page',
        authLane: 'authed',
        themes: ['light', 'dark'],
      },
    ]);
  });

  it('rejects section-style story markup because the loader only accepts json frontmatter stories', () => {
    expect(() =>
      parseStoryDefinition(`---\nstory_id: section-style-story\ntitle: Section style story\nactor: workspace admin\nlane: mock-lane\nentry_route: /en-US/workspaces/ws_default\ngoal: Must be rejected.\n---\n\n## Narrative\n\nThis format is no longer canonical.\n\n## Scenes\n\n\`\`\`json\n[]\n\`\`\`\n\n## Steps\n\n\`\`\`json\n[\n  {\n    \"step_id\": \"open\",\n    \"intent\": \"Open route\",\n    \"action\": \"Open page\",\n    \"target\": \"page__heading\",\n    \"expected_feedback\": \"Page is visible\",\n    \"evidence\": [\"trace\"]\n  }\n]\n\`\`\`\n`),
    ).toThrow(/json frontmatter/i);
  });

  it('discovers only committed story markdown files from canonical lane directories under the story root', async () => {
    const stories = await loadAllStoryDefinitions();

    expect(stories.map((story) => story.storyId)).toEqual([
      'api-key-to-endpoint-consumption',
      'chat-conversation-continuity',
      'chat-day-two-thread-workflow',
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'members-invite-and-chat-privacy',
      'mock-lane-alerts-and-usage-review',
      'mock-lane-chat-operate-and-recover',
      'mock-lane-connections-and-credentials-lifecycle',
      'mock-lane-entry-access',
      'mock-lane-governance-surfaces',
      'mock-lane-notebook-task-lifecycle',
      'mock-lane-self-service',
      'mock-lane-settings-and-members-review',
      'mock-lane-workspace-project-core',
      'notebook-artifact-to-files-download',
      'notebook-first-success',
      'project-governance-onboarding',
      'project-governance-runtime-setup',
      'real-backend-visual-review',
      'release-user-story-end-to-end',
      'system-admin-entry',
      'workspace-entry-and-project-discovery',
      'workspace-project-personal-context',
      'workspace-publish-to-usable-access',
      'workspace-settings-save-and-effect',
    ]);
    expect(
      stories.every((story) =>
        /(\/|\\)e2e(\/|\\)stories(\/|\\)(backend-real|mock-lane)(\/|\\).+\.story\.md$/.test(story.filePath),
      ),
    ).toBe(true);
  });

  it('does not keep committed story markdown files at the story root', async () => {
    const rootEntries = await readdir(path.resolve('e2e/stories'), { withFileTypes: true });
    expect(rootEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.story.md'))).toEqual([]);
  });

  it('keeps backend-real governance and admin stories on explicit gatePolicy tiers instead of inheriting release by default', async () => {
    const [systemAdminEntry, onboarding, runtimeSetup, workspaceEntry, personalContext, filesManagement, memberInvite, workspacePublish] = await Promise.all([
      loadStoryDefinition('system-admin-entry'),
      loadStoryDefinition('project-governance-onboarding'),
      loadStoryDefinition('project-governance-runtime-setup'),
      loadStoryDefinition('workspace-entry-and-project-discovery'),
      loadStoryDefinition('workspace-project-personal-context'),
      loadStoryDefinition('files-library-access-and-recovery'),
      loadStoryDefinition('members-invite-and-chat-privacy'),
      loadStoryDefinition('workspace-publish-to-usable-access'),
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
