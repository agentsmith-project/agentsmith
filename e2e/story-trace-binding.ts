import {
  buildStoryFingerprint,
  buildStoryStepMapFingerprint,
  type StoryDefinition,
  type StoryStepDefinition,
  type StoryTargetMatch,
} from './story-contract';

export type StoryTraceEventInput = {
  stepId: string;
  action?: string;
  target?: string;
  input?: string;
  route?: string;
  request?: unknown;
  response?: unknown;
  assertion?: string;
  note?: string;
  fullPage?: boolean;
};

export type TraceStoryBinding = {
  storyId: string;
  title: string;
  actor: string;
  goal: string;
  preconditions: readonly string[];
  seedData: readonly string[];
  storySource: string;
  storyFingerprint: string;
  stepMapFingerprint: string;
  steps: readonly StoryStepDefinition[];
};

function matchesTarget(stepTarget: string, actualTarget: string, mode: StoryTargetMatch): boolean {
  if (mode === 'prefix') {
    return actualTarget.startsWith(stepTarget);
  }
  return actualTarget === stepTarget;
}

export function buildTraceStoryBinding(story: StoryDefinition): TraceStoryBinding {
  const cwd = `${process.cwd().replace(/\\/g, '/')}/`;
  const normalizedFilePath = (story.sourceFile ?? story.filePath).replace(/\\/g, '/');
  return {
    storyId: story.storyId,
    title: story.title,
    actor: story.actor,
    goal: story.goal,
    preconditions: [...(story.preconditions ?? [])],
    seedData: [...(story.seedData ?? [])],
    storySource: `${normalizedFilePath.startsWith(cwd) ? normalizedFilePath.slice(cwd.length) : normalizedFilePath}#${story.storyId}`,
    storyFingerprint: buildStoryFingerprint(story),
    stepMapFingerprint: buildStoryStepMapFingerprint(story),
    steps: story.steps.map((step) => ({
      ...step,
      evidence: [...step.evidence],
      optional: step.optional ?? false,
    })),
  };
}

export function bindTraceEventToStory(
  story: TraceStoryBinding,
  event: StoryTraceEventInput,
): StoryTraceEventInput & { action: string; note: string } {
  const step = story.steps.find((entry) => entry.stepId === event.stepId);
  if (!step) {
    throw new Error(`unknown story step: ${event.stepId}`);
  }

  if (event.action && event.action !== step.action) {
    throw new Error(`story step action drift: ${event.stepId}`);
  }

  if (step.target && event.target) {
    const mode = step.targetMatch ?? 'exact';
    if (!matchesTarget(step.target, event.target, mode)) {
      throw new Error(`story step target drift: ${event.stepId}`);
    }
  }

  return {
    ...event,
    action: event.action ?? step.action,
    target: event.target ?? step.target,
    note: event.note ?? step.note ?? step.expectedFeedback,
  };
}
