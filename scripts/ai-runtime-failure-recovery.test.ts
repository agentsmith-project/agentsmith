import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('ai runtime failure and recovery story', () => {
  it('defines a stable backend-real recovery story centered on user-visible next steps', () => {
    const story = loadStoryDefinitionSync('e2e/stories/backend-real/ai-runtime-failure-and-recovery.story.md');
    expect(story.lane).toBe('backend-real');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-chat-runtime-recovery',
      'trigger-runtime-failure',
      'review-runtime-recovery',
      'retry-after-recovery',
    ]);
    const runtime = (story.runtimeData as Record<string, unknown> | undefined)?.aiRuntimeFailureRecovery as
      | Record<string, unknown>
      | undefined;
    expect(runtime?.recoveryToken).toBe('AI_RUNTIME_RECOVERY_OK');
  });

  it('binds integration-agents-external to the recovery story instead of a hard-coded offline script', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-agents-external.spec.ts'), 'utf-8');
    expect(source).toContain("loadStoryDefinitionSync('e2e/stories/backend-real/ai-runtime-failure-and-recovery.story.md')");
    expect(source).toContain('buildTraceStoryBinding');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain("captureTrace('open-chat-runtime-recovery')");
    expect(source).toContain("captureTrace('retry-after-recovery')");
    expect(source).toContain('createCredentialViaUi');
    expect(source).toContain('createEndpointViaApi');
    expect(source).toContain('execution_preferences_json');
  });
});
