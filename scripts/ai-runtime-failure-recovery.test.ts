import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

async function readActiveE2eSpecs() {
  const e2eDir = path.resolve(process.cwd(), 'e2e');
  const entries = await readdir(e2eDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
      .map(async (entry) => ({
        file: entry.name,
        source: await readFile(path.join(e2eDir, entry.name), 'utf-8'),
      })),
  );
}

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

  it('keeps the legacy external agents chat runner out of active e2e specs', async () => {
    const specs = await readActiveE2eSpecs();
    expect(specs.map((spec) => spec.file)).not.toContain('integration-agents-external.spec.ts');

    const legacyPatterns = [
      { label: '/agents route', pattern: /\/agents\b/ },
      { label: 'mode external payload', pattern: /mode:\s*['"]external/ },
      { label: 'chat interaction payload', pattern: /interaction_kind:\s*['"]chat/ },
      { label: 'external agent payload', pattern: /external_agent_id/ },
    ];
    const offenders = specs.flatMap((spec) =>
      legacyPatterns
        .filter(({ pattern }) => pattern.test(spec.source))
        .map(({ label }) => `${spec.file}: ${label}`),
    );
    expect(offenders).toEqual([]);
  });
});
