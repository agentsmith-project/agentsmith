import { createHash } from 'node:crypto';

export const STORY_FILE_SUFFIX = '.story.md';

export type StoryLane = 'mock-lane' | 'backend-real';
export type StoryEvidence = 'trace' | 'visual' | 'doc';
export type StoryTargetMatch = 'exact' | 'prefix';
export type StoryAuthLane =
  | 'public'
  | 'authed'
  | 'guest'
  | 'system_admin'
  | 'mock_auth'
  | 'mixed';
export type StoryRecipeFamily =
  | 'public_auth_single'
  | 'public_auth_split'
  | 'work_surface_standard'
  | 'work_surface_immersive'
  | 'settings_sheet'
  | 'governance_table_detail'
  | 'system_admin_detail'
  | 'overlay_dialog'
  | 'overlay_sheet';

export type StorySceneDefinition = {
  sceneId: string;
  route: string;
  recipeFamily?: StoryRecipeFamily;
  authLane?: StoryAuthLane;
  stableMarkers: readonly string[];
};

export type StoryStepDefinition = {
  stepId: string;
  sceneId?: string;
  intent: string;
  action: string;
  target?: string;
  targetMatch?: StoryTargetMatch;
  expectedFeedback: string;
  evidence: readonly StoryEvidence[];
  optional?: boolean;
  note?: string;
};

export type StoryRuntimeNotebookTurnDefinition = {
  prompt: string;
  expectedToken: string;
  expectedArtifactPath: string;
  minAgentMessages?: number;
};

export type StoryRuntimeNotebookFlowDefinition = {
  turnOne: StoryRuntimeNotebookTurnDefinition;
  turnTwo: StoryRuntimeNotebookTurnDefinition;
};

export type StoryRuntimeVisualReviewNotebookTaskDefinition = {
  taskTitlePrefix: string;
  expectedTokenPrefix: string;
  artifactNamePrefix: string;
  artifactExtension: string;
  promptIntro: string;
  artifactBodyLines: readonly string[];
};

export type StoryRuntimeData = {
  notebook?: Record<string, StoryRuntimeNotebookFlowDefinition>;
  visualReview?: {
    notebookTask: StoryRuntimeVisualReviewNotebookTaskDefinition;
  };
};

export type StoryDefinition = {
  filePath: string;
  sourceFile?: string;
  storyId: string;
  title: string;
  actor: string;
  lane: StoryLane;
  entryRoute: string;
  goal: string;
  preconditions?: readonly string[];
  seedData?: readonly string[];
  narrative: string;
  runtimeData?: StoryRuntimeData;
  scenes: readonly StorySceneDefinition[];
  steps: readonly StoryStepDefinition[];
};

function hashStableObject(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateNonEmptyText(field: string, value: string, storyId: string) {
  if (!value.trim()) {
    throw new Error(`story ${storyId} has empty ${field}`);
  }
}

export function buildStorySourceFingerprint(source: string): string {
  return hashStableObject(source.replace(/\r\n/g, '\n').trim());
}

function canonicalStoryForHash(story: StoryDefinition) {
  return {
    storyId: story.storyId,
    title: story.title,
    actor: story.actor,
    lane: story.lane,
    entryRoute: story.entryRoute,
    goal: story.goal,
    preconditions: [...(story.preconditions ?? [])],
    seedData: [...(story.seedData ?? [])],
    narrative: story.narrative,
    runtimeData: story.runtimeData,
    scenes: story.scenes.map((scene) => ({
      sceneId: scene.sceneId,
      route: scene.route,
      recipeFamily: scene.recipeFamily,
      authLane: scene.authLane,
      stableMarkers: [...scene.stableMarkers],
    })),
    steps: story.steps.map((step) => ({
      stepId: step.stepId,
      sceneId: step.sceneId,
      intent: step.intent,
      action: step.action,
      target: step.target,
      targetMatch: step.targetMatch ?? 'exact',
      expectedFeedback: step.expectedFeedback,
      evidence: [...step.evidence],
      optional: step.optional ?? false,
      note: step.note,
    })),
  };
}

export function buildStoryFingerprint(story: StoryDefinition): string {
  return hashStableObject(canonicalStoryForHash(story));
}

export function buildStoryStepMapFingerprint(story: StoryDefinition): string {
  return hashStableObject(
    story.steps.map((step) => ({
      stepId: step.stepId,
      sceneId: step.sceneId,
      action: step.action,
      target: step.target,
      targetMatch: step.targetMatch ?? 'exact',
      expectedFeedback: step.expectedFeedback,
      evidence: [...step.evidence],
      optional: step.optional ?? false,
      note: step.note,
    })),
  );
}

export function validateStoryDefinition(story: StoryDefinition) {
  validateNonEmptyText('story id', story.storyId, story.storyId || '<unknown>');
  validateNonEmptyText('title', story.title, story.storyId);
  validateNonEmptyText('actor', story.actor, story.storyId);
  validateNonEmptyText('goal', story.goal, story.storyId);
  validateNonEmptyText('narrative', story.narrative, story.storyId);

  if (!story.entryRoute.startsWith('/')) {
    throw new Error(`story ${story.storyId} has invalid entry route`);
  }

  if (story.steps.length === 0) {
    throw new Error(`story ${story.storyId} must define at least one step`);
  }

  const sceneIds = new Set<string>();
  for (const scene of story.scenes) {
    validateNonEmptyText('scene id', scene.sceneId, story.storyId);
    if (!scene.route.startsWith('/')) {
      throw new Error(`story ${story.storyId} scene ${scene.sceneId} has invalid route`);
    }
    if (sceneIds.has(scene.sceneId)) {
      throw new Error(`story ${story.storyId} has duplicate scene id: ${scene.sceneId}`);
    }
    sceneIds.add(scene.sceneId);
  }

  const stepIds = new Set<string>();
  for (const step of story.steps) {
    validateNonEmptyText('step id', step.stepId, story.storyId);
    validateNonEmptyText('step intent', step.intent, story.storyId);
    validateNonEmptyText('step action', step.action, story.storyId);
    validateNonEmptyText('step expected feedback', step.expectedFeedback, story.storyId);
    if (step.note !== undefined) {
      validateNonEmptyText('step note', step.note, story.storyId);
    }
    if (stepIds.has(step.stepId)) {
      throw new Error(`story ${story.storyId} has duplicate step id: ${step.stepId}`);
    }
    stepIds.add(step.stepId);
    if (step.sceneId && !sceneIds.has(step.sceneId)) {
      throw new Error(`story ${story.storyId} step ${step.stepId} references unknown scene: ${step.sceneId}`);
    }
    if (step.evidence.length === 0) {
      throw new Error(`story ${story.storyId} step ${step.stepId} must declare evidence`);
    }
    if (step.evidence.includes('visual') && !step.sceneId) {
      throw new Error(`story ${story.storyId} step ${step.stepId} uses visual evidence without a scene`);
    }
  }
}
