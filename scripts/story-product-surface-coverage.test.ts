import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog, readCommittedGeneratedStorySpecs } from './story-catalog-support';
import { getRequiredStoryVisualSceneBundle } from './story-visual-scene-fixtures';
import {
  CHAT_VISUAL_STATE_MATRIX_SCENARIO_IDS,
  MAJOR_PRODUCT_SURFACE_COVERAGE,
  NOTEBOOK_VISUAL_STATE_MATRIX_SCENARIO_IDS,
  validateChatNotebookVisualStateMatrixCoverage,
  validateMajorProductSurfaceCoverage,
  validateVisualStoryRuntimeContracts,
} from './story-product-surface-coverage';

describe('story product surface coverage', () => {
  it('keeps the committed story catalog anchored to major product surfaces instead of ad hoc recall', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const specs = await readCommittedGeneratedStorySpecs();
    const storiesById = new Map(stories.map((story) => [story.storyId, story] as const));
    const generatedSpecIds = new Set(specs.map((entry) => entry.storyId));

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.map((entry) => entry.surfaceId)).toEqual([
      'entry_and_identity',
      'workspace_and_project_core',
      'system_administration',
      'governance_and_membership',
      'chat_work',
      'notebook_and_terminal_work',
      'files_and_context',
      'connections_and_runtime_use',
      'self_service_and_usage',
      'release_verification_and_review',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'notebook_and_terminal_work')?.storyIds).toEqual([
      'notebook-first-success',
      'notebook-artifact-to-files-download',
      'notebook-cancel-terminate-refresh-recovery',
      'notebook-terminal-workspace-multi-session',
      'notebook-terminal-reentry-recovery',
      'notebook-terminal-truth-unavailable-retry',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'chat_work')?.storyIds).toEqual([
      'chat-conversation-continuity',
      'chat-day-two-thread-workflow',
      'chat-stop-terminate-idempotent-state-resync',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'files_and_context')?.storyIds).toEqual([
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'unicode-filename-round-trip',
      'workspace-project-personal-context',
      'workspace-shared-context-continuity',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'connections_and_runtime_use')?.storyIds).toEqual([
      'workspace-connections-to-project-use',
      'api-key-to-endpoint-consumption',
      'ai-runtime-failure-and-recovery',
      'internal-external-chat-notebook-proxy-matrix',
      'provider-capacity-retry-error-ux',
      'use-guide-first-consumption',
    ]);

    for (const surface of MAJOR_PRODUCT_SURFACE_COVERAGE) {
      expect(surface.label.length).toBeGreaterThan(0);
      expect(new Set(surface.storyIds).size).toBe(surface.storyIds.length);
      expect(surface.storyIds.length).toBeGreaterThan(0);

      const coveredStories = surface.storyIds.map((storyId) => storiesById.get(storyId));
      expect(coveredStories.every((story) => story?.lane === 'backend-real')).toBe(true);
      expect(coveredStories.every((story) => story && story.steps.length > 0)).toBe(true);
      expect(surface.storyIds.every((storyId) => generatedSpecIds.has(storyId))).toBe(true);
    }
  });

  it('closes major product surface coverage over every backend-real non-advisory story', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const specs = await readCommittedGeneratedStorySpecs();
    const generatedSpecIds = new Set(specs.map((entry) => entry.storyId));

    expect(validateMajorProductSurfaceCoverage(stories, generatedSpecIds)).toEqual([]);

    const backendRealStoryIds = stories
      .filter((story) => story.lane === 'backend-real' && story.gatePolicy.tier !== 'advisory')
      .map((story) => story.storyId)
      .sort();
    const coveredStoryIds = MAJOR_PRODUCT_SURFACE_COVERAGE
      .flatMap((surface) => [...surface.storyIds])
      .sort();

    expect(coveredStoryIds).toEqual(backendRealStoryIds);
  });

  it('keeps visual story runtime contracts anchored to real code refs and explicit stable markers', async () => {
    const { stories } = await loadCanonicalStoryCatalog();

    expect(validateVisualStoryRuntimeContracts(stories)).toEqual([]);
  });

  it('forces chat and notebook visual state matrices to stay aligned with user-visible runtime truth', async () => {
    const { stories } = await loadCanonicalStoryCatalog();

    expect(CHAT_VISUAL_STATE_MATRIX_SCENARIO_IDS).toEqual([
      'chat-streaming-active',
      'chat-stop-requested',
      'chat-stop-escalation-confirm',
      'chat-stop-escalation-unavailable',
      'chat-recovering-live-session',
      'chat-provider-capacity-retry',
    ]);
    expect(NOTEBOOK_VISUAL_STATE_MATRIX_SCENARIO_IDS).toEqual([
      'notebook-task-running',
      'notebook-task-cancelling',
      'notebook-cancel-escalation-confirm',
      'notebook-task-terminating',
      'notebook-task-finalizing',
      'notebook-sse-reconnecting',
      'notebook-sse-unavailable-reconcile',
      'notebook-task-recovered-ready',
      'notebook-provider-upstream-error',
      'notebook-hidden-terminal-blocked',
      'notebook-terminal-truth-unavailable',
    ]);

    expect(validateChatNotebookVisualStateMatrixCoverage(stories)).toEqual([]);
  });

  it('locks same-surface recovery CTA semantics for running chat and notebook visual review scenes', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const storiesById = new Map(stories.map((story) => [story.storyId, story] as const));
    const chatStory = storiesById.get('mock-lane-chat-operate-and-recover');
    const notebookStory = storiesById.get('mock-lane-notebook-task-lifecycle');

    expect(chatStory).toBeDefined();
    expect(notebookStory).toBeDefined();

    const providerCapacity = getRequiredStoryVisualSceneBundle(
      chatStory!,
      'chat-provider-capacity-retry',
    );
    const running = getRequiredStoryVisualSceneBundle(
      notebookStory!,
      'notebook-task-running',
    );
    const hiddenTerminalBlocked = getRequiredStoryVisualSceneBundle(
      notebookStory!,
      'notebook-hidden-terminal-blocked',
    );
    const terminalTruthUnavailable = getRequiredStoryVisualSceneBundle(
      notebookStory!,
      'notebook-terminal-truth-unavailable',
    );

    expect(providerCapacity.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining([
        'chat__stream-error-recovery',
        'chat__stream-error-message',
        'chat__composer-recovery-endpoint--ep_2',
      ]),
    );
    expect(providerCapacity.visualScene.semanticAssertions?.prominentActionScopeTestIds).toEqual([
      'chat__composer-recovery-shell',
    ]);

    expect(running.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['notebook__run-active-cancel']),
    );
    expect(running.storyScene.stableMarkers).toContain('notebook__run-active-cancel');

    expect(hiddenTerminalBlocked.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining([
        'notebook__task-terminal-status-action',
        'notebook__task-terminal-status-end-all',
      ]),
    );
    expect(hiddenTerminalBlocked.visualScene.semanticAssertions?.requiredViewportTestIds).not.toContain(
      'notebook__conversation-blocked-action',
    );

    expect(terminalTruthUnavailable.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['notebook__task-terminal-truth-unavailable-retry']),
    );
    expect(terminalTruthUnavailable.visualScene.semanticAssertions?.requiredViewportTestIds).not.toContain(
      'notebook__conversation-blocked-action',
    );
  });

  it('locks notebook recovery scenes to explicit escalation, provider failure, and terminal CTA semantics', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const notebookStory = stories.find((story) => story.storyId === 'mock-lane-notebook-task-lifecycle');
    const notebookScenes = notebookStory?.runtimeData?.visualReview?.scenes ?? [];
    const scenesByScenarioId = new Map(notebookScenes.map((scene) => [scene.scenarioId, scene] as const));

    expect(scenesByScenarioId.get('notebook-cancel-escalation-confirm')).toMatchObject({
      sceneId: 'notebook-cancel-escalation-confirm',
      group: 'overlay_cases',
      uxState: 'degraded',
      semanticAssertions: {
        requiredViewportTestIds: [
          'notebook__task-header',
          'notebook__cancel-escalation-dialog',
          'notebook__cancel-escalation-cancel',
          'notebook__cancel-escalation-confirm',
        ],
      },
    });

    expect(scenesByScenarioId.get('notebook-provider-upstream-error')).toMatchObject({
      sceneId: 'notebook-provider-upstream-error',
      group: 'project_pages',
      uxState: 'degraded',
      semanticAssertions: {
        requiredViewportTestIds: [
          'notebook__task-header',
          'notebook__agent-message-bubble',
          'notebook__message-run-status',
          'notebook__send-btn',
        ],
      },
    });

    expect(scenesByScenarioId.get('notebook-hidden-terminal-blocked')).toMatchObject({
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'notebook__task-terminal-status-action',
          'notebook__task-terminal-status-end-all',
        ]),
        prominentActionScopeTestIds: ['notebook__task-terminal-status-strip'],
      },
    });

    expect(scenesByScenarioId.get('notebook-terminal-truth-unavailable')).toMatchObject({
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'notebook__task-terminal-truth-unavailable-retry',
        ]),
        prominentActionScopeTestIds: ['notebook__task-terminal-truth-unavailable'],
      },
    });
  });

  it('marks happy notebook visual scenes as non-degraded product states', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const happyNotebookScenarioIds = [
      'notebook-task-lifecycle-list',
      'notebook-task-lifecycle-detail',
      'notebook-task-detail',
    ];
    const visualScenes = stories.flatMap((story) => story.runtimeData?.visualReview?.scenes ?? []);

    expect(
      happyNotebookScenarioIds.map((scenarioId) => {
        const scene = visualScenes.find((entry) => entry.scenarioId === scenarioId);
        return [scenarioId, scene?.uxState] as const;
      }),
    ).toEqual(happyNotebookScenarioIds.map((scenarioId) => [scenarioId, 'happy']));
  });
});
