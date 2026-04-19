import { createHash } from 'node:crypto';

export const STORY_FILE_SUFFIX = '.story.md';

export const STORY_LANE_VALUES = ['mock-lane', 'backend-real'] as const;
export type StoryLane = (typeof STORY_LANE_VALUES)[number];
export const STORY_EVIDENCE_VALUES = ['trace', 'visual', 'doc'] as const;
export type StoryEvidence = (typeof STORY_EVIDENCE_VALUES)[number];
export const STORY_TRACE_ORDER_MODE_VALUES = ['strict_sequence'] as const;
export type StoryTraceOrderMode = (typeof STORY_TRACE_ORDER_MODE_VALUES)[number];
export type StoryTargetMatch = 'exact' | 'prefix';
export const STORY_KIND_VALUES = ['journey', 'review'] as const;
export type StoryKind = (typeof STORY_KIND_VALUES)[number];
export const STORY_GATE_TIER_VALUES = ['default', 'release', 'advisory'] as const;
export type StoryGateTier = (typeof STORY_GATE_TIER_VALUES)[number];
export const STORY_EXTERNAL_DEPENDENCY_KIND_VALUES = ['service', 'integration', 'credential', 'manual'] as const;
export type StoryExternalDependencyKind = (typeof STORY_EXTERNAL_DEPENDENCY_KIND_VALUES)[number];
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

export const STORY_VISUAL_REVIEW_SCENARIO_GROUP_VALUES = [
  'public_pages',
  'workspace_pages',
  'project_pages',
  'system_pages',
  'user_pages',
  'governance_pages',
  'overlay_cases',
  'overlay_drawers',
] as const;
export type StoryVisualReviewScenarioGroup = (typeof STORY_VISUAL_REVIEW_SCENARIO_GROUP_VALUES)[number];
export const STORY_VISUAL_REVIEW_CAPTURE_VALUES = ['full_page', 'viewport'] as const;
export type StoryVisualReviewCaptureMode = (typeof STORY_VISUAL_REVIEW_CAPTURE_VALUES)[number];
export const STORY_VISUAL_REVIEW_THEME_VALUES = ['light', 'dark', 'default'] as const;
export type StoryVisualReviewTheme = (typeof STORY_VISUAL_REVIEW_THEME_VALUES)[number];
export const STORY_VISUAL_REVIEW_VIEWPORT_VALUES = ['default', 'ultrawide'] as const;
export type StoryVisualReviewViewport = (typeof STORY_VISUAL_REVIEW_VIEWPORT_VALUES)[number];
export const STORY_VISUAL_REVIEW_UX_STATE_VALUES = ['happy', 'degraded', 'diagnostic'] as const;
export type StoryVisualReviewUxState = (typeof STORY_VISUAL_REVIEW_UX_STATE_VALUES)[number];

export type StoryRuntimeVisualSemanticAssertionsDefinition = {
  forbiddenVisibleText?: readonly string[];
  forbiddenVisibleTextPatterns?: readonly string[];
  allowedDefaultForbiddenVisibleText?: readonly string[];
  requiredViewportTestIds?: readonly string[];
  requiredViewerLocalDateTimeTestIds?: readonly string[];
  primaryActionTestIds?: readonly string[];
  prominentActionScopeTestIds?: readonly string[];
  maxProminentActions?: number;
};

export type StoryRuntimeVisualReviewSceneDefinition = {
  sceneId: string;
  scenarioId: string;
  scenario: string;
  group: StoryVisualReviewScenarioGroup;
  codeRefs: readonly string[];
  capture: StoryVisualReviewCaptureMode;
  authLane?: StoryAuthLane;
  screenshotBaseName?: string;
  themes?: readonly StoryVisualReviewTheme[];
  viewport?: StoryVisualReviewViewport;
  uxState?: StoryVisualReviewUxState;
  setupNotes?: readonly string[];
  semanticAssertions?: StoryRuntimeVisualSemanticAssertionsDefinition;
};

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

export type StoryTraceOrderContract = {
  mode: StoryTraceOrderMode;
  orderedStepIds: readonly string[];
};

export type StoryGatePolicy = {
  tier: StoryGateTier;
  requiredEvidence: readonly StoryEvidence[];
};

export type StoryExternalDependency = {
  dependencyId: string;
  kind: StoryExternalDependencyKind;
  required?: boolean;
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

export type StoryRuntimeVisualReviewDefinition = {
  scenes: readonly StoryRuntimeVisualReviewSceneDefinition[];
  notebookTask?: StoryRuntimeVisualReviewNotebookTaskDefinition;
};

export type StoryRuntimeData = {
  notebook?: Record<string, StoryRuntimeNotebookFlowDefinition>;
  visualReview?: StoryRuntimeVisualReviewDefinition;
};

export type StoryDefinition = {
  filePath: string;
  sourceFile?: string;
  storyId: string;
  title: string;
  actor: string;
  family: string;
  personas: readonly string[];
  kind: StoryKind;
  gatePolicy: StoryGatePolicy;
  externalDependencies: readonly StoryExternalDependency[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateNonEmptyText(field: string, value: string, storyId: string) {
  if (!value.trim()) {
    throw new Error(`story ${storyId} has empty ${field}`);
  }
}

function validateUniqueList(field: string, values: readonly string[], storyId: string) {
  const seen = new Set<string>();
  for (const value of values) {
    validateNonEmptyText(field, value, storyId);
    if (seen.has(value)) {
      throw new Error(`story ${storyId} has duplicate ${field}: ${value}`);
    }
    seen.add(value);
  }
}

function validateRepoRelativeCodeRef(codeRef: string, storyId: string, sceneId: string) {
  if (
    codeRef.startsWith('/')
    || codeRef.includes('\\')
    || codeRef.split('/').includes('..')
    || /^[a-z][a-z0-9+.-]*:/i.test(codeRef)
  ) {
    throw new Error(`story ${storyId} visual review scene ${sceneId} has unsafe code ref: ${codeRef}`);
  }
}

function validateSurfaceScopedSemanticTargetReference(
  value: string,
  storyId: string,
  sceneId: string,
  field: string,
) {
  const segments = value.split('::');
  if (segments.length === 1) {
    return;
  }
  if (segments.length !== 2 || segments.some((segment) => segment.trim().length === 0)) {
    throw new Error(
      `story ${storyId} visual review scene ${sceneId} has invalid surface-scoped semantic target for ${field}: ${value}`,
    );
  }
}

function validateSemanticTargetReferenceList(
  field: string,
  values: readonly string[],
  storyId: string,
  sceneId: string,
) {
  validateUniqueList(field, values, storyId);
  for (const value of values) {
    validateSurfaceScopedSemanticTargetReference(value, storyId, sceneId, field);
  }
}

function validateProminentActionScopeReferenceList(
  field: string,
  values: readonly string[],
  storyId: string,
  sceneId: string,
) {
  validateUniqueList(field, values, storyId);
  for (const value of values) {
    if (value.includes('::')) {
      throw new Error(
        `story ${storyId} visual review scene ${sceneId} has invalid prominent action scope for ${field}: ${value}`,
      );
    }
  }
}

function validateVisualReviewScene(scene: StoryRuntimeVisualReviewSceneDefinition, storyId: string) {
  validateNonEmptyText('visual review scene id', scene.sceneId, storyId);
  validateNonEmptyText('visual review scenario id', scene.scenarioId, storyId);
  validateNonEmptyText('visual review scenario', scene.scenario, storyId);
  if (!STORY_VISUAL_REVIEW_SCENARIO_GROUP_VALUES.includes(scene.group)) {
    throw new Error(`story ${storyId} has invalid visual review scene group: ${scene.group}`);
  }
  if (scene.codeRefs.length === 0) {
    throw new Error(`story ${storyId} visual review scene ${scene.sceneId} must define code refs`);
  }
  validateUniqueList('visual review code ref', scene.codeRefs, storyId);
  for (const codeRef of scene.codeRefs) {
    validateRepoRelativeCodeRef(codeRef, storyId, scene.sceneId);
  }
  if (!STORY_VISUAL_REVIEW_CAPTURE_VALUES.includes(scene.capture)) {
    throw new Error(`story ${storyId} has invalid visual review capture mode: ${scene.capture}`);
  }
  if (scene.authLane !== undefined && !['public', 'authed', 'guest', 'system_admin', 'mock_auth', 'mixed'].includes(scene.authLane)) {
    throw new Error(`story ${storyId} has invalid visual review auth lane: ${scene.authLane}`);
  }
  if (scene.screenshotBaseName !== undefined) {
    validateNonEmptyText('visual review screenshot base name', scene.screenshotBaseName, storyId);
  }
  if (scene.themes !== undefined) {
    if (scene.themes.length === 0) {
      throw new Error(`story ${storyId} visual review scene ${scene.sceneId} must define at least one theme when themes are provided`);
    }
    validateUniqueList('visual review theme', scene.themes, storyId);
    for (const theme of scene.themes) {
      if (!STORY_VISUAL_REVIEW_THEME_VALUES.includes(theme)) {
        throw new Error(`story ${storyId} has invalid visual review theme: ${theme}`);
      }
    }
  }
  if (scene.viewport !== undefined && !STORY_VISUAL_REVIEW_VIEWPORT_VALUES.includes(scene.viewport)) {
    throw new Error(`story ${storyId} has invalid visual review viewport: ${scene.viewport}`);
  }
  if (scene.uxState !== undefined && !STORY_VISUAL_REVIEW_UX_STATE_VALUES.includes(scene.uxState)) {
    throw new Error(`story ${storyId} has invalid visual review UX state: ${scene.uxState}`);
  }
  if (scene.setupNotes !== undefined) {
    validateUniqueList('visual review setup note', scene.setupNotes, storyId);
  }
  validateVisualSemanticAssertions(scene.semanticAssertions, storyId, scene.sceneId);
}

function validateVisualSemanticAssertions(
  assertions: StoryRuntimeVisualSemanticAssertionsDefinition | undefined,
  storyId: string,
  sceneId: string,
) {
  if (assertions === undefined) {
    return;
  }
  if (!isRecord(assertions)) {
    throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertions must be an object`);
  }
  if (assertions.forbiddenVisibleText !== undefined) {
    if (!Array.isArray(assertions.forbiddenVisibleText)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion forbidden visible text must be a list`);
    }
    validateUniqueList('visual semantic assertion forbidden visible text', assertions.forbiddenVisibleText, storyId);
  }
  if (assertions.forbiddenVisibleTextPatterns !== undefined) {
    if (!Array.isArray(assertions.forbiddenVisibleTextPatterns)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion forbidden visible text pattern must be a list`);
    }
    validateUniqueList(
      'visual semantic assertion forbidden visible text pattern',
      assertions.forbiddenVisibleTextPatterns,
      storyId,
    );
    for (const pattern of assertions.forbiddenVisibleTextPatterns) {
      try {
        new RegExp(pattern);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `story ${storyId} visual review scene ${sceneId} has invalid forbidden visible text pattern: ${pattern} (${reason})`,
        );
      }
    }
  }
  if (assertions.allowedDefaultForbiddenVisibleText !== undefined) {
    if (!Array.isArray(assertions.allowedDefaultForbiddenVisibleText)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion default override must be a list`);
    }
    validateUniqueList(
      'visual semantic assertion allowed default forbidden visible text',
      assertions.allowedDefaultForbiddenVisibleText,
      storyId,
    );
  }
  if (assertions.requiredViewportTestIds !== undefined) {
    if (!Array.isArray(assertions.requiredViewportTestIds)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion required viewport test ids must be a list`);
    }
    validateSemanticTargetReferenceList(
      'visual semantic assertion required viewport test id',
      assertions.requiredViewportTestIds,
      storyId,
      sceneId,
    );
  }
  if (assertions.requiredViewerLocalDateTimeTestIds !== undefined) {
    if (!Array.isArray(assertions.requiredViewerLocalDateTimeTestIds)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion viewer-local datetime test ids must be a list`);
    }
    validateSemanticTargetReferenceList(
      'visual semantic assertion viewer-local datetime test id',
      assertions.requiredViewerLocalDateTimeTestIds,
      storyId,
      sceneId,
    );
  }
  if (assertions.primaryActionTestIds !== undefined) {
    if (!Array.isArray(assertions.primaryActionTestIds)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion primary action test ids must be a list`);
    }
    validateSemanticTargetReferenceList(
      'visual semantic assertion primary action test id',
      assertions.primaryActionTestIds,
      storyId,
      sceneId,
    );
  }
  if (assertions.prominentActionScopeTestIds !== undefined) {
    if (!Array.isArray(assertions.prominentActionScopeTestIds)) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion prominent action scope test ids must be a list`);
    }
    validateProminentActionScopeReferenceList(
      'visual semantic assertion prominent action scope test id',
      assertions.prominentActionScopeTestIds,
      storyId,
      sceneId,
    );
  }
  if (assertions.maxProminentActions !== undefined) {
    if (!Number.isInteger(assertions.maxProminentActions) || assertions.maxProminentActions < 0) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion max prominent actions must be a non-negative integer`);
    }
    if ((assertions.primaryActionTestIds?.length ?? 0) > assertions.maxProminentActions) {
      throw new Error(`story ${storyId} visual review scene ${sceneId} semantic assertion primary action ids exceed max prominent actions`);
    }
  }
}

function validateRuntimeData(runtimeData: StoryRuntimeData | undefined, story: StoryDefinition) {
  const visualReview = runtimeData?.visualReview;
  if (!visualReview) {
    return;
  }
  if (visualReview.scenes.length === 0) {
    throw new Error(`story ${story.storyId} must define at least one visual review scene`);
  }
  const sceneIds = new Set(story.scenes.map((scene) => scene.sceneId));
  const visualSceneIds = new Set<string>();
  const visualScenarioIds = new Set<string>();
  for (const scene of visualReview.scenes) {
    validateVisualReviewScene(scene, story.storyId);
    if (!sceneIds.has(scene.sceneId)) {
      throw new Error(`story ${story.storyId} visual review scene ${scene.sceneId} references unknown story scene`);
    }
    const storyScene = story.scenes.find((entry) => entry.sceneId === scene.sceneId);
    if (!storyScene || storyScene.stableMarkers.length === 0) {
      throw new Error(`story ${story.storyId} visual review scene ${scene.sceneId} must define story-owned stable markers`);
    }
    if (visualSceneIds.has(scene.sceneId)) {
      throw new Error(`story ${story.storyId} has duplicate visual review scene id: ${scene.sceneId}`);
    }
    if (visualScenarioIds.has(scene.scenarioId)) {
      throw new Error(`story ${story.storyId} has duplicate visual review scenario id: ${scene.scenarioId}`);
    }
    visualSceneIds.add(scene.sceneId);
    visualScenarioIds.add(scene.scenarioId);
  }
}

function stableMarkerMatchesTarget(marker: string, target: string, mode: StoryTargetMatch): boolean {
  if (mode === 'prefix') {
    return marker.startsWith(target);
  }
  return marker === target;
}

export function buildStorySourceFingerprint(source: string): string {
  return hashStableObject(source.replace(/\r\n/g, '\n').trim());
}

function canonicalStoryForHash(story: StoryDefinition) {
  return {
    storyId: story.storyId,
    title: story.title,
    actor: story.actor,
    family: story.family,
    personas: [...story.personas],
    kind: story.kind,
    gatePolicy: {
      tier: story.gatePolicy.tier,
      requiredEvidence: [...story.gatePolicy.requiredEvidence],
    },
    externalDependencies: story.externalDependencies.map((dependency) => ({
      dependencyId: dependency.dependencyId,
      kind: dependency.kind,
      required: dependency.required ?? false,
      note: dependency.note,
    })),
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

export function resolveStoryTraceOrderContract(story: Pick<StoryDefinition, 'steps'>): StoryTraceOrderContract {
  return {
    mode: 'strict_sequence',
    orderedStepIds: story.steps
      .filter((step) => step.evidence.includes('trace') && !step.optional)
      .map((step) => step.stepId),
  };
}

export function validateStoryDefinition(story: StoryDefinition) {
  validateNonEmptyText('story id', story.storyId, story.storyId || '<unknown>');
  validateNonEmptyText('title', story.title, story.storyId);
  validateNonEmptyText('actor', story.actor, story.storyId);
  validateNonEmptyText('family', story.family, story.storyId);
  validateNonEmptyText('goal', story.goal, story.storyId);
  validateNonEmptyText('narrative', story.narrative, story.storyId);
  if (!STORY_LANE_VALUES.includes(story.lane)) {
    throw new Error(`story ${story.storyId} has invalid lane: ${story.lane}`);
  }
  if (story.personas.length === 0) {
    throw new Error(`story ${story.storyId} must define at least one persona`);
  }
  validateUniqueList('persona', story.personas, story.storyId);
  if (!STORY_KIND_VALUES.includes(story.kind)) {
    throw new Error(`story ${story.storyId} has invalid kind: ${story.kind}`);
  }
  if (!STORY_GATE_TIER_VALUES.includes(story.gatePolicy.tier)) {
    throw new Error(`story ${story.storyId} has invalid gate tier: ${story.gatePolicy.tier}`);
  }
  if (story.gatePolicy.requiredEvidence.length === 0) {
    throw new Error(`story ${story.storyId} must define gate policy evidence`);
  }
  validateUniqueList('gate policy evidence', story.gatePolicy.requiredEvidence, story.storyId);
  for (const evidence of story.gatePolicy.requiredEvidence) {
    if (!STORY_EVIDENCE_VALUES.includes(evidence)) {
      throw new Error(`story ${story.storyId} has invalid gate policy evidence: ${evidence}`);
    }
  }
  const dependencyIds = new Set<string>();
  for (const dependency of story.externalDependencies) {
    validateNonEmptyText('external dependency id', dependency.dependencyId, story.storyId);
    if (!STORY_EXTERNAL_DEPENDENCY_KIND_VALUES.includes(dependency.kind)) {
      throw new Error(`story ${story.storyId} has invalid external dependency kind: ${dependency.kind}`);
    }
    if (dependency.note !== undefined) {
      validateNonEmptyText('external dependency note', dependency.note, story.storyId);
    }
    if (dependencyIds.has(dependency.dependencyId)) {
      throw new Error(`story ${story.storyId} has duplicate external dependency: ${dependency.dependencyId}`);
    }
    dependencyIds.add(dependency.dependencyId);
  }

  if (!story.entryRoute.startsWith('/')) {
    throw new Error(`story ${story.storyId} has invalid entry route`);
  }

  if (story.steps.length === 0) {
    throw new Error(`story ${story.storyId} must define at least one step`);
  }

  const sceneIds = new Set<string>();
  const sceneOrder = new Map<string, number>();
  for (const [index, scene] of story.scenes.entries()) {
    validateNonEmptyText('scene id', scene.sceneId, story.storyId);
    if (!scene.route.startsWith('/')) {
      throw new Error(`story ${story.storyId} scene ${scene.sceneId} has invalid route`);
    }
    if (sceneIds.has(scene.sceneId)) {
      throw new Error(`story ${story.storyId} has duplicate scene id: ${scene.sceneId}`);
    }
    sceneIds.add(scene.sceneId);
    sceneOrder.set(scene.sceneId, index);
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
    if (step.sceneId && step.target) {
      const targetMatchMode = step.targetMatch ?? 'exact';
      const currentSceneOrder = sceneOrder.get(step.sceneId);
      const currentScene = story.scenes.find((scene) => scene.sceneId === step.sceneId);
      const currentSceneOwnsTarget = currentScene?.stableMarkers.some((marker) =>
        stableMarkerMatchesTarget(marker, step.target as string, targetMatchMode),
      ) ?? false;
      const priorOwningSceneIds = story.scenes
        .filter((scene) => {
          const ownerSceneOrder = sceneOrder.get(scene.sceneId);
          return ownerSceneOrder !== undefined
            && currentSceneOrder !== undefined
            && ownerSceneOrder < currentSceneOrder
            && scene.stableMarkers.some((marker) => stableMarkerMatchesTarget(marker, step.target as string, targetMatchMode));
        })
        .map((scene) => scene.sceneId);
      if (!currentSceneOwnsTarget && priorOwningSceneIds.length > 0) {
        throw new Error(
          `story ${story.storyId} step ${step.stepId} target ${step.target} points back to earlier scene-owned stable marker(s) ${priorOwningSceneIds.join(', ')} from step scene ${step.sceneId}`,
        );
      }
    }
    if (step.evidence.length === 0) {
      throw new Error(`story ${story.storyId} step ${step.stepId} must declare evidence`);
    }
    for (const evidence of step.evidence) {
      if (!STORY_EVIDENCE_VALUES.includes(evidence)) {
        throw new Error(`story ${story.storyId} step ${step.stepId} has invalid evidence: ${evidence}`);
      }
    }
    if (step.evidence.includes('visual') && !step.sceneId) {
      throw new Error(`story ${story.storyId} step ${step.stepId} uses visual evidence without a scene`);
    }
  }

  validateRuntimeData(story.runtimeData, story);
}
