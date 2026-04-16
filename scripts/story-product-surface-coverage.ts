import { existsSync } from 'node:fs';
import path from 'node:path';
import type { StoryDefinition } from '../e2e/story-contract';

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

export const MAJOR_PRODUCT_SURFACE_COVERAGE: readonly ProductSurfaceCoverage[] = [
  {
    surfaceId: 'entry_and_identity',
    label: 'Entry and identity',
    storyIds: [
      'workspace-public-entry-and-login-truth',
      'desktop-auth-request-complete-and-work',
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
    ],
  },
  {
    surfaceId: 'notebook_and_terminal_work',
    label: 'Notebook and terminal work',
    storyIds: [
      'notebook-first-success',
      'notebook-artifact-to-files-download',
      'notebook-terminal-workspace-multi-session',
      'notebook-terminal-reentry-recovery',
      'notebook-terminal-truth-unavailable-retry',
    ],
  },
  {
    surfaceId: 'files_and_context',
    label: 'Files and context continuity',
    storyIds: [
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'workspace-project-personal-context',
      'workspace-shared-context-continuity',
    ],
  },
  {
    surfaceId: 'connections_and_runtime_use',
    label: 'Connections and runtime use',
    storyIds: [
      'workspace-connections-to-project-use',
      'api-key-to-endpoint-consumption',
      'ai-runtime-failure-and-recovery',
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

const HAPPY_NOTEBOOK_VISUAL_SCENARIO_IDS = new Set([
  'notebook-task-lifecycle-list',
  'notebook-task-lifecycle-detail',
  'notebook-task-detail',
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
      if (HAPPY_NOTEBOOK_VISUAL_SCENARIO_IDS.has(visualScene.scenarioId) && visualScene.uxState !== 'happy') {
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
