import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildStoryFingerprint,
  buildStorySourceFingerprint,
  buildStoryStepMapFingerprint,
  type StoryDefinition,
} from './story-contract';

export type GeneratedStorySpec = {
  storyId: string;
  title: string;
  actor: string;
  lane: StoryDefinition['lane'];
  entryRoute: string;
  goal: string;
  sourceRef: string;
  sourceFingerprint: string;
  storyFingerprint: string;
  stepMapFingerprint: string;
  sceneIds: readonly string[];
  stepIds: readonly string[];
  traceStepIds: readonly string[];
  visualStepIds: readonly string[];
};

export function buildGeneratedStorySpecs(stories: readonly StoryDefinition[]): GeneratedStorySpec[] {
  return stories.map((story) => ({
    storyId: story.storyId,
    title: story.title,
    actor: story.actor,
    lane: story.lane,
    entryRoute: story.entryRoute,
    goal: story.goal,
    sourceRef: normalizeSourceRef(story.sourceFile ?? story.filePath, story.storyId),
    sourceFingerprint: buildSourceFingerprint(story),
    storyFingerprint: buildStoryFingerprint(story),
    stepMapFingerprint: buildStoryStepMapFingerprint(story),
    sceneIds: story.scenes.map((scene) => scene.sceneId),
    stepIds: story.steps.map((step) => step.stepId),
    traceStepIds: story.steps.filter((step) => step.evidence.includes('trace')).map((step) => step.stepId),
    visualStepIds: story.steps.filter((step) => step.evidence.includes('visual')).map((step) => step.stepId),
  }));
}

function normalizeSourceRef(filePath: string, storyId: string): string {
  const cwd = `${process.cwd().replace(/\\/g, '/')}/`;
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  return `${normalizedFilePath.startsWith(cwd) ? normalizedFilePath.slice(cwd.length) : normalizedFilePath}#${storyId}`;
}

function buildSourceFingerprint(story: StoryDefinition): string {
  const sourceFile = story.sourceFile && story.sourceFile !== 'inline.story.md' ? story.sourceFile : story.filePath;
  const resolvedSourcePath = path.resolve(sourceFile);
  return buildStorySourceFingerprint(readFileSync(resolvedSourcePath, 'utf8'));
}

export function renderGeneratedStorySpecsJson(specs: readonly GeneratedStorySpec[]): string {
  return `${JSON.stringify(specs, null, 2)}\n`;
}
