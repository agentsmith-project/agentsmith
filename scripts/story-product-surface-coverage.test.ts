import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog, readCommittedGeneratedStorySpecs } from './story-catalog-support';
import { getRequiredStoryVisualSceneBundle } from './story-visual-scene-fixtures';
import {
  CHAT_VISUAL_STATE_MATRIX_SCENARIO_IDS,
  MAJOR_PRODUCT_SURFACE_COVERAGE,
  AGENT_TASK_VISUAL_STATE_MATRIX_SCENARIO_IDS,
  validateChatAgentTaskVisualStateMatrixCoverage,
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
      'agent_task_and_terminal_work',
      'files_and_context',
      'connections_and_runtime_use',
      'self_service_and_usage',
      'release_verification_and_review',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'agent_task_and_terminal_work')?.storyIds).toEqual([
      'agent-task-first-success',
      'agent-task-artifact-to-files-download',
      'agent-task-cancel-terminate-refresh-recovery',
      'agent-task-terminal-workspace-multi-session',
      'agent-task-terminal-reentry-recovery',
      'agent-task-terminal-truth-unavailable-retry',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'chat_work')?.storyIds).toEqual([
      'chat-conversation-continuity',
      'chat-day-two-thread-workflow',
      'chat-stop-terminate-idempotent-state-resync',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'files_and_context')?.storyIds).toEqual([
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'agent-task-image-asset-savepoint-delete-restore',
      'unicode-filename-round-trip',
      'workspace-project-personal-context',
      'workspace-shared-context-continuity',
    ]);

    expect(MAJOR_PRODUCT_SURFACE_COVERAGE.find((entry) => entry.surfaceId === 'connections_and_runtime_use')?.storyIds).toEqual([
      'workspace-connections-to-project-use',
      'api-key-to-endpoint-consumption',
      'ai-runtime-failure-and-recovery',
      'chat-agent-task-target-model-continuity',
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

  it('forces chat and agent-tasks visual state matrices to stay aligned with user-visible runtime truth', async () => {
    const { stories } = await loadCanonicalStoryCatalog();

    expect(CHAT_VISUAL_STATE_MATRIX_SCENARIO_IDS).toEqual([
      'chat-streaming-active',
      'chat-stop-requested',
      'chat-stop-escalation-confirm',
      'chat-stop-escalation-unavailable',
      'chat-recovering-live-session',
      'chat-provider-capacity-retry',
    ]);
    expect(AGENT_TASK_VISUAL_STATE_MATRIX_SCENARIO_IDS).toEqual([
      'agent-task-running',
      'agent-task-cancelling',
      'agent-task-cancel-escalation-confirm',
      'agent-task-terminating',
      'agent-task-finalizing',
      'agent-task-sse-reconnecting',
      'agent-task-sse-unavailable-reconcile',
      'agent-task-recovered-ready',
      'agent-task-provider-upstream-error',
      'agent-task-hidden-terminal-blocked',
      'agent-task-terminal-truth-unavailable',
    ]);

    expect(validateChatAgentTaskVisualStateMatrixCoverage(stories)).toEqual([]);
  });

  it('locks same-surface recovery CTA semantics for running chat and agent-tasks visual review scenes', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const storiesById = new Map(stories.map((story) => [story.storyId, story] as const));
    const chatStory = storiesById.get('mock-lane-chat-operate-and-recover');
    const agentTaskStory = storiesById.get('mock-lane-agent-task-lifecycle');

    expect(chatStory).toBeDefined();
    expect(agentTaskStory).toBeDefined();

    const providerCapacity = getRequiredStoryVisualSceneBundle(
      chatStory!,
      'chat-provider-capacity-retry',
    );
    const running = getRequiredStoryVisualSceneBundle(
      agentTaskStory!,
      'agent-task-running',
    );
    const hiddenTerminalBlocked = getRequiredStoryVisualSceneBundle(
      agentTaskStory!,
      'agent-task-hidden-terminal-blocked',
    );
    const terminalTruthUnavailable = getRequiredStoryVisualSceneBundle(
      agentTaskStory!,
      'agent-task-terminal-truth-unavailable',
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
      expect.arrayContaining(['agent-tasks__message-active-run-cancel']),
    );
    expect(running.storyScene.stableMarkers).toContain('agent-tasks__message-active-run-cancel');

    expect(hiddenTerminalBlocked.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining([
        'agent-tasks__task-terminal-status-action',
        'agent-tasks__task-terminal-status-end-all',
      ]),
    );
    expect(hiddenTerminalBlocked.visualScene.semanticAssertions?.requiredViewportTestIds).not.toContain(
      'agent-tasks__conversation-blocked-action',
    );

    expect(terminalTruthUnavailable.visualScene.semanticAssertions?.requiredViewportTestIds).toEqual(
      expect.arrayContaining(['agent-tasks__task-terminal-truth-unavailable-retry']),
    );
    expect(terminalTruthUnavailable.visualScene.semanticAssertions?.requiredViewportTestIds).not.toContain(
      'agent-tasks__conversation-blocked-action',
    );
  });

  it('locks agent-tasks recovery scenes to explicit escalation, provider failure, and terminal CTA semantics', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const agentTaskStory = stories.find((story) => story.storyId === 'mock-lane-agent-task-lifecycle');
    const agentTaskScenes = agentTaskStory?.runtimeData?.visualReview?.scenes ?? [];
    const scenesByScenarioId = new Map(agentTaskScenes.map((scene) => [scene.scenarioId, scene] as const));

    expect(scenesByScenarioId.get('agent-task-cancel-escalation-confirm')).toMatchObject({
      sceneId: 'agent-task-cancel-escalation-confirm',
      group: 'overlay_cases',
      uxState: 'degraded',
      semanticAssertions: {
        requiredViewportTestIds: [
          'agent-task__task-header',
          'agent-tasks__cancel-escalation-dialog',
          'agent-tasks__cancel-escalation-cancel',
          'agent-tasks__cancel-escalation-confirm',
        ],
      },
    });

    expect(scenesByScenarioId.get('agent-task-provider-upstream-error')).toMatchObject({
      sceneId: 'agent-task-provider-upstream-error',
      group: 'project_pages',
      uxState: 'degraded',
      semanticAssertions: {
        requiredViewportTestIds: [
          'agent-task__task-header',
          'agent-tasks__agent-message-bubble',
          'agent-tasks__message-run-status',
          'agent-tasks__send-btn',
        ],
      },
    });

    expect(scenesByScenarioId.get('agent-task-hidden-terminal-blocked')).toMatchObject({
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'agent-tasks__task-terminal-status-action',
          'agent-tasks__task-terminal-status-end-all',
        ]),
        prominentActionScopeTestIds: ['agent-tasks__task-terminal-status-strip'],
      },
    });

    expect(scenesByScenarioId.get('agent-task-terminal-truth-unavailable')).toMatchObject({
      semanticAssertions: {
        requiredViewportTestIds: expect.arrayContaining([
          'agent-tasks__task-terminal-truth-unavailable-retry',
        ]),
        prominentActionScopeTestIds: ['agent-tasks__task-terminal-truth-unavailable'],
      },
    });
  });

  it('marks happy agent-tasks visual scenes as non-degraded product states', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const happyAgentTaskScenarioIds = [
      'agent-task-lifecycle-list',
      'agent-task-lifecycle-detail',
      'agent-task-detail',
    ];
    const visualScenes = stories.flatMap((story) => story.runtimeData?.visualReview?.scenes ?? []);

    expect(
      happyAgentTaskScenarioIds.map((scenarioId) => {
        const scene = visualScenes.find((entry) => entry.scenarioId === scenarioId);
        return [scenarioId, scene?.uxState] as const;
      }),
    ).toEqual(happyAgentTaskScenarioIds.map((scenarioId) => [scenarioId, 'happy']));
  });
});
