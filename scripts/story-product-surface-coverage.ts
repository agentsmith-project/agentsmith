import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  StoryDefinition,
  StoryRuntimeVisualReviewSceneDefinition,
  StoryRuntimeVisualSemanticAssertionsDefinition,
  StoryVisualReviewUxState,
} from '../e2e/story-contract';

export type ProductSurfaceCoverage = {
  surfaceId: string;
  label: string;
  storyIds: readonly string[];
};

export type ProductSurfaceCoverageIssue =
  | {
    issue: 'duplicate_story_surface';
    storyId: string;
    surfaceIds: readonly string[];
  }
  | {
    issue: 'missing_backend_real_surface';
    storyId: string;
  }
  | {
    issue: 'non_backend_real_story';
    storyId: string;
    surfaceId: string;
    lane: string;
  }
  | {
    issue: 'unknown_story';
    storyId: string;
    surfaceId: string;
  }
  | {
    issue: 'missing_generated_spec';
    storyId: string;
    surfaceId: string;
  };

export type VisualStoryRuntimeContractIssue =
  | {
    issue: 'unknown_visual_scene';
    storyId: string;
    sceneId: string;
    scenarioId: string;
  }
  | {
    issue: 'missing_stable_markers';
    storyId: string;
    sceneId: string;
    scenarioId: string;
  }
  | {
    issue: 'unsafe_code_ref';
    storyId: string;
    sceneId: string;
    scenarioId: string;
    codeRef: string;
  }
  | {
    issue: 'missing_code_ref';
    storyId: string;
    sceneId: string;
    scenarioId: string;
    codeRef: string;
  }
  | {
    issue: 'missing_happy_ux_state';
    storyId: string;
    sceneId: string;
    scenarioId: string;
  }
  | {
    issue: 'degraded_language_in_happy_scene';
    storyId: string;
    sceneId: string;
    scenarioId: string;
    term: string;
  };

export type VisualStateMatrixContractIssue =
  | {
    issue: 'missing_visual_state_matrix_story';
    storyId: string;
  }
  | {
    issue: 'missing_visual_state_matrix_scenario';
    storyId: string;
    scenarioId: string;
  }
  | {
    issue: 'visual_state_matrix_scene_mismatch';
    storyId: string;
    scenarioId: string;
    expectedSceneId: string;
    actualSceneId: string;
  }
  | {
    issue: 'visual_state_matrix_ux_state_mismatch';
    storyId: string;
    scenarioId: string;
    expectedUxState: StoryVisualReviewUxState;
    actualUxState: StoryVisualReviewUxState | undefined;
  }
  | {
    issue: 'visual_state_matrix_missing_semantic_assertions';
    storyId: string;
    scenarioId: string;
  }
  | {
    issue: 'visual_state_matrix_missing_required_viewport_target';
    storyId: string;
    scenarioId: string;
    testId: string;
  }
  | {
    issue: 'visual_state_matrix_missing_prominent_action_scope';
    storyId: string;
    scenarioId: string;
    testId: string;
  }
  | {
    issue: 'visual_state_matrix_max_prominent_actions_mismatch';
    storyId: string;
    scenarioId: string;
    expected: number;
    actual: number | undefined;
  }
  | {
    issue: 'visual_state_matrix_missing_forbidden_text';
    storyId: string;
    scenarioId: string;
    text: string;
  };

export const MAJOR_PRODUCT_SURFACE_COVERAGE: readonly ProductSurfaceCoverage[] = [
  {
    surfaceId: 'entry_and_identity',
    label: 'Entry and identity',
    storyIds: [
      'workspace-public-entry-and-login-truth',
      'invite-to-first-effective-work',
      'workspace-identity-switch-truth',
    ],
  },
  {
    surfaceId: 'workspace_and_project_core',
    label: 'Workspace and project core',
    storyIds: [
      'workspace-entry-and-project-discovery',
      'project-surface-handoff-continuity',
      'workspace-publish-to-usable-access',
      'workspace-settings-save-and-effect',
    ],
  },
  {
    surfaceId: 'system_administration',
    label: 'System administration',
    storyIds: [
      'system-admin-entry',
      'system-admin-multi-workspace-handoff',
      'workspace-lifecycle-admin-operations',
      'workspace-idp-and-admin-handoff',
    ],
  },
  {
    surfaceId: 'governance_and_membership',
    label: 'Governance and membership',
    storyIds: [
      'project-governance-onboarding',
      'project-governance-runtime-setup',
      'project-owner-daily-governance-review',
      'members-invite-and-chat-privacy',
      'membership-change-and-effective-access',
      'admin-switches-to-member-and-keeps-working',
      'governance-change-then-member-keeps-working',
      'resource-policy-change-to-observable-effect',
      'workspace-admin-boundary-and-project-creator',
    ],
  },
  {
    surfaceId: 'chat_work',
    label: 'Chat work',
    storyIds: [
      'chat-conversation-continuity',
      'chat-day-two-thread-workflow',
      'chat-stop-terminate-idempotent-state-resync',
    ],
  },
  {
    surfaceId: 'agent_task_and_terminal_work',
    label: 'Agent Task and terminal work',
    storyIds: [
      'agent-task-first-success',
      'agent-task-artifact-to-files-download',
      'agent-task-cancel-terminate-refresh-recovery',
      'agent-task-terminal-workspace-multi-session',
      'agent-task-terminal-reentry-recovery',
      'agent-task-terminal-truth-unavailable-retry',
    ],
  },
  {
    surfaceId: 'files_and_context',
    label: 'Files and context continuity',
    storyIds: [
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'agent-task-image-asset-savepoint-delete-restore',
      'unicode-filename-round-trip',
      'workspace-project-personal-context',
      'workspace-shared-context-continuity',
    ],
  },
  {
    surfaceId: 'connections_and_runtime_use',
    label: 'Connections and runtime use',
    storyIds: [
      'api-key-to-endpoint-consumption',
      'ai-runtime-failure-and-recovery',
      'chat-agent-task-target-model-continuity',
      'provider-capacity-retry-error-ux',
      'use-guide-first-consumption',
    ],
  },
  {
    surfaceId: 'self_service_and_usage',
    label: 'Self service and usage',
    storyIds: [
      'personal-self-service-lifecycle',
      'usage-self-scope-review',
    ],
  },
  {
    surfaceId: 'release_verification_and_review',
    label: 'Release verification and review',
    storyIds: [
      'release-user-story-end-to-end',
      'real-backend-visual-review',
    ],
  },
] as const;

export const CHAT_VISUAL_STATE_MATRIX_SCENARIO_IDS = [
  'chat-streaming-active',
  'chat-stop-requested',
  'chat-stop-escalation-confirm',
  'chat-stop-escalation-unavailable',
  'chat-recovering-live-session',
  'chat-provider-capacity-retry',
] as const;

export const AGENT_TASK_VISUAL_STATE_MATRIX_SCENARIO_IDS = [
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
] as const;

type VisualStateMatrixScenarioContract = {
  storyId: string;
  sceneId: string;
  scenarioId: string;
  uxState: StoryVisualReviewUxState;
  semanticAssertions: {
    requiredViewportTestIds: readonly string[];
    prominentActionScopeTestIds?: readonly string[];
    maxProminentActions: number;
    forbiddenVisibleText: readonly string[];
  };
};

const DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT = [
  'Unknown',
  'Agent Unknown',
  'Unknown Runner',
] as const;

const CHAT_AND_AGENT_TASK_VISUAL_STATE_MATRIX_CONTRACTS: readonly VisualStateMatrixScenarioContract[] = [
  {
    storyId: 'mock-lane-chat-operate-and-recover',
    sceneId: 'chat-streaming-active',
    scenarioId: 'chat-streaming-active',
    uxState: 'happy',
    semanticAssertions: {
      requiredViewportTestIds: [
        'chat__surface',
        'chat__stream-status',
        'chat__composer',
        'chat__stop-btn',
      ],
      prominentActionScopeTestIds: ['chat__composer'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-chat-operate-and-recover',
    sceneId: 'chat-stop-requested',
    scenarioId: 'chat-stop-requested',
    uxState: 'diagnostic',
    semanticAssertions: {
      requiredViewportTestIds: [
        'chat__surface',
        'chat__stream-status',
        'chat__composer',
        'chat__stop-btn',
      ],
      prominentActionScopeTestIds: ['chat__composer'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-chat-operate-and-recover',
    sceneId: 'chat-stop-escalation-confirm',
    scenarioId: 'chat-stop-escalation-confirm',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'chat__surface',
        'chat__stop-escalation-dialog',
        'chat__stop-escalation-cancel',
        'chat__stop-escalation-confirm',
      ],
      prominentActionScopeTestIds: ['chat__stop-escalation-dialog'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-chat-operate-and-recover',
    sceneId: 'chat-stop-escalation-unavailable',
    scenarioId: 'chat-stop-escalation-unavailable',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'chat__surface',
        'chat__stream-status',
        'chat__composer',
        'chat__stop-escalation-unavailable',
      ],
      prominentActionScopeTestIds: ['chat__header'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-chat-operate-and-recover',
    sceneId: 'chat-recovering-live-session',
    scenarioId: 'chat-recovering-live-session',
    uxState: 'diagnostic',
    semanticAssertions: {
      requiredViewportTestIds: [
        'chat__surface',
        'chat__stream-status',
        'chat__composer',
        'chat__stop-btn',
      ],
      prominentActionScopeTestIds: ['chat__composer'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-chat-operate-and-recover',
    sceneId: 'chat-provider-capacity-retry',
    scenarioId: 'chat-provider-capacity-retry',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'chat__surface',
        'chat__stream-status',
        'chat__composer',
        'chat__stream-error-recovery',
        'chat__stream-error-message',
        'chat__composer-recovery-endpoint--ep_2',
      ],
      prominentActionScopeTestIds: ['chat__composer-recovery-shell'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-running',
    scenarioId: 'agent-task-running',
    uxState: 'happy',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__message-active-run-footer',
        'agent-tasks__message-active-run-status',
        'agent-tasks__message-active-run-elapsed',
        'agent-tasks__message-active-run-latest-action',
        'agent-tasks__message-active-run-cancel',
        'agent-tasks__conversation-input',
      ],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-cancelling',
    scenarioId: 'agent-task-cancelling',
    uxState: 'diagnostic',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__message-active-run-footer',
        'agent-tasks__conversation-input',
        'agent-tasks__send-btn',
      ],
      prominentActionScopeTestIds: ['agent-tasks__conversation-input'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-cancel-escalation-confirm',
    scenarioId: 'agent-task-cancel-escalation-confirm',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__cancel-escalation-dialog',
        'agent-tasks__cancel-escalation-cancel',
        'agent-tasks__cancel-escalation-confirm',
      ],
      prominentActionScopeTestIds: ['agent-tasks__cancel-escalation-dialog'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-terminating',
    scenarioId: 'agent-task-terminating',
    uxState: 'diagnostic',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__message-active-run-footer',
        'agent-tasks__conversation-input',
        'agent-tasks__send-btn',
      ],
      prominentActionScopeTestIds: ['agent-tasks__conversation-input'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-finalizing',
    scenarioId: 'agent-task-finalizing',
    uxState: 'diagnostic',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__message-active-run-footer',
        'agent-tasks__conversation-input',
        'agent-tasks__send-btn',
      ],
      prominentActionScopeTestIds: ['agent-tasks__conversation-input'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-sse-reconnecting',
    scenarioId: 'agent-task-sse-reconnecting',
    uxState: 'diagnostic',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__message-active-run-footer',
        'agent-tasks__message-active-run-status',
        'agent-tasks__conversation-input',
        'agent-tasks__send-btn',
      ],
      prominentActionScopeTestIds: ['agent-tasks__conversation-input'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-sse-unavailable-reconcile',
    scenarioId: 'agent-task-sse-unavailable-reconcile',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__sse-status',
      ],
      prominentActionScopeTestIds: ['agent-tasks__execution-visibility'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-recovered-ready',
    scenarioId: 'agent-task-recovered-ready',
    uxState: 'happy',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__conversation-input',
        'agent-tasks__send-btn',
      ],
      prominentActionScopeTestIds: ['agent-tasks__conversation-input'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-provider-upstream-error',
    scenarioId: 'agent-task-provider-upstream-error',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__agent-message-bubble',
        'agent-tasks__message-run-status',
        'agent-tasks__send-btn',
      ],
      prominentActionScopeTestIds: ['agent-tasks__conversation-input'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-hidden-terminal-blocked',
    scenarioId: 'agent-task-hidden-terminal-blocked',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__task-terminal-status-strip',
        'agent-tasks__task-terminal-status-action',
        'agent-tasks__task-terminal-status-end-all',
      ],
      prominentActionScopeTestIds: ['agent-tasks__task-terminal-status-strip'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
  {
    storyId: 'mock-lane-agent-task-lifecycle',
    sceneId: 'agent-task-terminal-truth-unavailable',
    scenarioId: 'agent-task-terminal-truth-unavailable',
    uxState: 'degraded',
    semanticAssertions: {
      requiredViewportTestIds: [
        'agent-task__task-header',
        'agent-tasks__task-terminal-truth-unavailable',
        'agent-tasks__task-terminal-truth-unavailable-retry',
      ],
      prominentActionScopeTestIds: ['agent-tasks__task-terminal-truth-unavailable'],
      maxProminentActions: 0,
      forbiddenVisibleText: DEFAULT_VISUAL_STATE_MATRIX_FORBIDDEN_TEXT,
    },
  },
] as const;

const HAPPY_AGENT_TASK_VISUAL_SCENARIO_IDS = new Set([
  'agent-task-lifecycle-list',
  'agent-task-lifecycle-detail',
  'agent-task-detail',
]);

const HAPPY_SCENE_FORBIDDEN_DEGRADED_TERMS = [
  'Agent Unknown',
  'Unknown Runner',
  'Realtime ticket service unavailable',
] as const;

function buildSurfaceStoryIndex() {
  const index = new Map<string, string[]>();
  for (const surface of MAJOR_PRODUCT_SURFACE_COVERAGE) {
    for (const storyId of surface.storyIds) {
      const surfaceIds = index.get(storyId) ?? [];
      surfaceIds.push(surface.surfaceId);
      index.set(storyId, surfaceIds);
    }
  }
  return index;
}

function visualSceneSemanticAssertionsIncludeAll(
  values: readonly string[] | undefined,
  requiredValues: readonly string[],
) {
  if (!values) {
    return false;
  }
  return requiredValues.every((value) => values.includes(value));
}

function findVisualSceneForScenario(
  story: StoryDefinition,
  scenarioId: string,
): StoryRuntimeVisualReviewSceneDefinition | undefined {
  return story.runtimeData?.visualReview?.scenes.find((scene) => scene.scenarioId === scenarioId);
}

function validateVisualSceneSemanticAssertions(args: {
  storyId: string;
  scenarioId: string;
  actual: StoryRuntimeVisualSemanticAssertionsDefinition | undefined;
  expected: VisualStateMatrixScenarioContract['semanticAssertions'];
}): VisualStateMatrixContractIssue[] {
  const issues: VisualStateMatrixContractIssue[] = [];
  if (!args.actual) {
    issues.push({
      issue: 'visual_state_matrix_missing_semantic_assertions',
      storyId: args.storyId,
      scenarioId: args.scenarioId,
    });
    return issues;
  }

  if (!visualSceneSemanticAssertionsIncludeAll(args.actual.requiredViewportTestIds, args.expected.requiredViewportTestIds)) {
    for (const testId of args.expected.requiredViewportTestIds) {
      if (args.actual.requiredViewportTestIds?.includes(testId)) {
        continue;
      }
      issues.push({
        issue: 'visual_state_matrix_missing_required_viewport_target',
        storyId: args.storyId,
        scenarioId: args.scenarioId,
        testId,
      });
    }
  }

  if (args.expected.prominentActionScopeTestIds && !visualSceneSemanticAssertionsIncludeAll(
    args.actual.prominentActionScopeTestIds,
    args.expected.prominentActionScopeTestIds,
  )) {
    for (const testId of args.expected.prominentActionScopeTestIds) {
      if (args.actual.prominentActionScopeTestIds?.includes(testId)) {
        continue;
      }
      issues.push({
        issue: 'visual_state_matrix_missing_prominent_action_scope',
        storyId: args.storyId,
        scenarioId: args.scenarioId,
        testId,
      });
    }
  }

  if (args.actual.maxProminentActions !== args.expected.maxProminentActions) {
    issues.push({
      issue: 'visual_state_matrix_max_prominent_actions_mismatch',
      storyId: args.storyId,
      scenarioId: args.scenarioId,
      expected: args.expected.maxProminentActions,
      actual: args.actual.maxProminentActions,
    });
  }

  if (!visualSceneSemanticAssertionsIncludeAll(args.actual.forbiddenVisibleText, args.expected.forbiddenVisibleText)) {
    for (const text of args.expected.forbiddenVisibleText) {
      if (args.actual.forbiddenVisibleText?.includes(text)) {
        continue;
      }
      issues.push({
        issue: 'visual_state_matrix_missing_forbidden_text',
        storyId: args.storyId,
        scenarioId: args.scenarioId,
        text,
      });
    }
  }

  return issues;
}

export function validateMajorProductSurfaceCoverage(
  stories: readonly StoryDefinition[],
  generatedSpecIds = new Set<string>(),
): ProductSurfaceCoverageIssue[] {
  const issues: ProductSurfaceCoverageIssue[] = [];
  const storiesById = new Map(stories.map((story) => [story.storyId, story] as const));
  const surfaceStoryIndex = buildSurfaceStoryIndex();

  for (const [storyId, surfaceIds] of surfaceStoryIndex) {
    if (surfaceIds.length > 1) {
      issues.push({ issue: 'duplicate_story_surface', storyId, surfaceIds });
    }
  }

  for (const surface of MAJOR_PRODUCT_SURFACE_COVERAGE) {
    for (const storyId of surface.storyIds) {
      const story = storiesById.get(storyId);
      if (!story) {
        issues.push({ issue: 'unknown_story', storyId, surfaceId: surface.surfaceId });
        continue;
      }
      if (story.lane !== 'backend-real') {
        issues.push({
          issue: 'non_backend_real_story',
          storyId,
          surfaceId: surface.surfaceId,
          lane: story.lane,
        });
      }
      if (generatedSpecIds.size > 0 && !generatedSpecIds.has(storyId)) {
        issues.push({ issue: 'missing_generated_spec', storyId, surfaceId: surface.surfaceId });
      }
    }
  }

  for (const story of stories) {
    if (story.lane !== 'backend-real' || story.gatePolicy.tier === 'advisory') {
      continue;
    }
    if (!surfaceStoryIndex.has(story.storyId)) {
      issues.push({ issue: 'missing_backend_real_surface', storyId: story.storyId });
    }
  }

  return issues;
}

export function validateChatAgentTaskVisualStateMatrixCoverage(
  stories: readonly StoryDefinition[],
): VisualStateMatrixContractIssue[] {
  const issues: VisualStateMatrixContractIssue[] = [];
  const storiesById = new Map(stories.map((story) => [story.storyId, story] as const));

  for (const contract of CHAT_AND_AGENT_TASK_VISUAL_STATE_MATRIX_CONTRACTS) {
    const story = storiesById.get(contract.storyId);
    if (!story) {
      issues.push({
        issue: 'missing_visual_state_matrix_story',
        storyId: contract.storyId,
      });
      continue;
    }

    const visualScene = findVisualSceneForScenario(story, contract.scenarioId);
    if (!visualScene) {
      issues.push({
        issue: 'missing_visual_state_matrix_scenario',
        storyId: contract.storyId,
        scenarioId: contract.scenarioId,
      });
      continue;
    }

    if (visualScene.sceneId !== contract.sceneId) {
      issues.push({
        issue: 'visual_state_matrix_scene_mismatch',
        storyId: contract.storyId,
        scenarioId: contract.scenarioId,
        expectedSceneId: contract.sceneId,
        actualSceneId: visualScene.sceneId,
      });
    }

    if (visualScene.uxState !== contract.uxState) {
      issues.push({
        issue: 'visual_state_matrix_ux_state_mismatch',
        storyId: contract.storyId,
        scenarioId: contract.scenarioId,
        expectedUxState: contract.uxState,
        actualUxState: visualScene.uxState,
      });
    }

    issues.push(...validateVisualSceneSemanticAssertions({
      storyId: contract.storyId,
      scenarioId: contract.scenarioId,
      actual: visualScene.semanticAssertions,
      expected: contract.semanticAssertions,
    }));
  }

  return issues;
}

function isSafeRepoRelativeCodeRef(codeRef: string): boolean {
  if (path.isAbsolute(codeRef) || /^[a-z][a-z0-9+.-]*:/i.test(codeRef) || codeRef.includes('\\')) {
    return false;
  }
  const normalized = path.posix.normalize(codeRef);
  return normalized === codeRef && !normalized.startsWith('../') && normalized !== '..';
}

function resolveCodeRef(repoRoot: string, codeRef: string): string | undefined {
  if (!isSafeRepoRelativeCodeRef(codeRef)) {
    return undefined;
  }
  const resolved = path.resolve(repoRoot, codeRef);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

export function validateVisualStoryRuntimeContracts(
  stories: readonly StoryDefinition[],
  repoRoot = process.cwd(),
): VisualStoryRuntimeContractIssue[] {
  const issues: VisualStoryRuntimeContractIssue[] = [];
  for (const story of stories) {
    const visualScenes = story.runtimeData?.visualReview?.scenes ?? [];
    if (visualScenes.length === 0) {
      continue;
    }
    const storyScenesById = new Map(story.scenes.map((scene) => [scene.sceneId, scene] as const));
    for (const visualScene of visualScenes) {
      const storyScene = storyScenesById.get(visualScene.sceneId);
      if (!storyScene) {
        issues.push({
          issue: 'unknown_visual_scene',
          storyId: story.storyId,
          sceneId: visualScene.sceneId,
          scenarioId: visualScene.scenarioId,
        });
        continue;
      }
      if (storyScene.stableMarkers.length === 0) {
        issues.push({
          issue: 'missing_stable_markers',
          storyId: story.storyId,
          sceneId: visualScene.sceneId,
          scenarioId: visualScene.scenarioId,
        });
      }
      if (HAPPY_AGENT_TASK_VISUAL_SCENARIO_IDS.has(visualScene.scenarioId) && visualScene.uxState !== 'happy') {
        issues.push({
          issue: 'missing_happy_ux_state',
          storyId: story.storyId,
          sceneId: visualScene.sceneId,
          scenarioId: visualScene.scenarioId,
        });
      }
      if (visualScene.uxState !== 'degraded' && visualScene.uxState !== 'diagnostic') {
        const semanticText = [
          visualScene.scenario,
          ...story.steps
            .filter((step) => step.sceneId === visualScene.sceneId)
            .flatMap((step) => [
              step.intent,
              step.action,
              step.expectedFeedback,
              step.note ?? '',
            ]),
        ].join('\n');
        for (const term of HAPPY_SCENE_FORBIDDEN_DEGRADED_TERMS) {
          if (semanticText.includes(term)) {
            issues.push({
              issue: 'degraded_language_in_happy_scene',
              storyId: story.storyId,
              sceneId: visualScene.sceneId,
              scenarioId: visualScene.scenarioId,
              term,
            });
          }
        }
      }
      for (const codeRef of visualScene.codeRefs) {
        const resolved = resolveCodeRef(repoRoot, codeRef);
        if (!resolved) {
          issues.push({
            issue: 'unsafe_code_ref',
            storyId: story.storyId,
            sceneId: visualScene.sceneId,
            scenarioId: visualScene.scenarioId,
            codeRef,
          });
          continue;
        }
        if (!existsSync(resolved)) {
          issues.push({
            issue: 'missing_code_ref',
            storyId: story.storyId,
            sceneId: visualScene.sceneId,
            scenarioId: visualScene.scenarioId,
            codeRef,
          });
        }
      }
    }
  }

  return issues;
}
