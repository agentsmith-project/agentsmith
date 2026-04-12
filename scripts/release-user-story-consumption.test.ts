import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type GeneratedStorySpec = {
  storyId: string;
  title: string;
  sourceRef: string;
  stepIds: string[];
  traceStepIds: string[];
};

async function readGeneratedStorySpecs(): Promise<GeneratedStorySpec[]> {
  const raw = await readFile(
    path.resolve(process.cwd(), 'e2e/generated/story-specs.generated.json'),
    'utf-8',
  );
  return JSON.parse(raw) as GeneratedStorySpec[];
}

describe('release story consumption guards', () => {
  it('keeps committed release story metadata in a generated file instead of a spec-local manifest', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-release-user-story.spec.ts'),
      'utf-8',
    );

    expect(source).not.toContain("storyId: 'release-user-story-end-to-end'");
    expect(source).not.toContain("title: 'Release user story end-to-end'");
    expect(source).not.toContain("actor: 'system 管理侧 / workspace admin / project owner / member'");
    expect(source).not.toContain("seedData: ['ws_default']");
  });

  it('requires the canonical release story source to be an external story file, not a TS constant module', async () => {
    const specs = await readGeneratedStorySpecs();
    const releaseStory = specs.find((entry) => entry.storyId === 'release-user-story-end-to-end');

    expect(releaseStory).toBeTruthy();
    expect(releaseStory?.title).toBe('Release user story end-to-end');
    expect(releaseStory?.stepIds).toEqual(
      expect.arrayContaining([
        'system-login',
        'workspace-login',
        'project-overview',
        'usage-overview',
      ]),
    );
    expect(releaseStory?.traceStepIds).toEqual(expect.arrayContaining(['system-login', 'workspace-login']));
    expect(releaseStory?.sourceRef).not.toContain('e2e/story-contract.ts#');
    expect(releaseStory?.sourceRef).toMatch(/\.(json|ya?ml|md)(#|$)/);
  });

  it('requires visual review to consume shared story step metadata instead of maintaining its own overlapping map', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-visual-review.spec.ts'),
      'utf-8',
    );

    expect(source).not.toContain('const VISUAL_REVIEW_TRACE_META');
    expect(source).not.toContain('getReleaseStoryTraceMeta');
    expect(source).not.toContain('RELEASE_STORY_STEP_IDS');
    expect(source).toMatch(/story|trace.*binding|load.*story/i);
  });

  it('keeps release notebook tokens, prompts, and artifact paths derived from story runtime data instead of inline constants', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-release-user-story.spec.ts'),
      'utf-8',
    );

    expect(source).not.toContain('EXT_T1_OK');
    expect(source).not.toContain('EXT_T2_OK');
    expect(source).not.toContain('EXT_REUSE_T1_OK');
    expect(source).not.toContain('EXT_REUSE_T2_OK');
    expect(source).not.toContain('INT_T1_OK');
    expect(source).not.toContain('INT_T2_OK');
    expect(source).not.toContain('external_summary.md');
    expect(source).not.toContain('external_reuse.md');
    expect(source).not.toContain('internal_summary.md');
    expect(source).not.toContain('Create notes/external_story.txt');
    expect(source).not.toContain('internal turn 1');
  });
});
