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

  it('keeps release user story Agent Runners checks on deployment-managed runner selectors', async () => {
    const specSource = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-release-user-story.spec.ts'),
      'utf-8',
    );
    const storySource = await readFile(
      path.resolve(process.cwd(), 'e2e/stories/backend-real/release-user-story-end-to-end.story.md'),
      'utf-8',
    );

    expect(specSource).toContain("page.getByTestId('agent-runners__system-managed-section')");
    expect(specSource).toContain("page.getByTestId('agent-runners__system-managed-table')");
    expect(specSource).toContain("'agent-runners__project-default-status'");
    expect(specSource).not.toContain("page.getByTestId('agent-runners__table')");
    expect(storySource).toContain('"target": "agent-runners__system-managed-table"');
    expect(storySource).toContain('"target": "agent-runners__project-default-status"');
  });

  it('keeps full demo managed runner configuration under owner identity before member task use', async () => {
    const specSource = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-release-user-story.spec.ts'),
      'utf-8',
    );
    const storySource = await readFile(
      path.resolve(process.cwd(), 'e2e/stories/backend-real/release-user-story-end-to-end.story.md'),
      'utf-8',
    );

    const runnerTitleIndex = specSource.indexOf('Managed Continuity Runner');
    expect(runnerTitleIndex).toBeGreaterThanOrEqual(0);
    const fullBranchStart = specSource.lastIndexOf('if (DEMO_MODE_IS_FULL)', runnerTitleIndex);
    const ownerLogin = specSource.indexOf(
      'await loginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);',
      fullBranchStart,
    );
    const managedRunnerConfig = specSource.lastIndexOf('await createManagedAgentRunnerViaApi(page, {', runnerTitleIndex);
    const memberLogin = specSource.indexOf(
      'await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);',
      managedRunnerConfig,
    );
    const memberTaskCreate = specSource.indexOf('const internalTask = await createTaskViaUi({', managedRunnerConfig);

    expect(fullBranchStart).toBeGreaterThanOrEqual(0);
    expect(ownerLogin).toBeGreaterThan(fullBranchStart);
    expect(managedRunnerConfig).toBeGreaterThan(ownerLogin);
    expect(memberLogin).toBeGreaterThan(managedRunnerConfig);
    expect(memberLogin).toBeLessThan(memberTaskCreate);
    expect(storySource).toContain('"stepId": "managed-continuity-governance-config"');
    expect(storySource).toContain('项目所有者执行治理配置');
    expect(storySource).toContain('"stepId": "member-workspace-home-after-governance-config"');
    expect(storySource).toContain('普通成员重新进入 workspace，继续使用托管 Agent Runner');
  });

  it('keeps release user story Files artifact checks under task workspace/.artifacts', async () => {
    const specSource = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-release-user-story.spec.ts'),
      'utf-8',
    );
    const storySource = await readFile(
      path.resolve(process.cwd(), 'e2e/stories/backend-real/release-user-story-end-to-end.story.md'),
      'utf-8',
    );

    expect(specSource).toContain('openTaskWorkspaceArtifactsFolder');
    expect(specSource).toContain("await openFolderByName(args.page, 'workspace')");
    expect(specSource).toContain("await openFolderByName(args.page, '.artifacts')");
    expect(specSource).not.toMatch(
      /openWorkspaceFilesRoot\(\{[\s\S]{0,500}\}\);\s*await openFolderByName\(page, '\.artifacts'\)/,
    );
    expect(storySource).toContain('workspace/.artifacts');
    expect(storySource).not.toContain('managed Agent Task 的 .artifacts 已可见');
  });

  it('keeps release user story task deletion convergent after workspace generation conflicts', async () => {
    const specSource = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-release-user-story.spec.ts'),
      'utf-8',
    );
    const deleteStart = specSource.indexOf('async function deleteCurrentTaskViaUi');
    const deleteEnd = specSource.indexOf('\nasync function openWorkspaceFilesRoot', deleteStart);
    const deleteBody = specSource.slice(deleteStart, deleteEnd);

    expect(deleteBody).toContain('for (let attempt = 0; attempt < 2; attempt += 1)');
    expect(deleteBody).toContain('workspace changed|refresh and try again');
    expect(deleteBody).toContain("conflict.waitFor({ state: 'visible'");
    expect(deleteBody).toContain("await page.reload({ waitUntil: 'load' })");
    expect(deleteBody).toContain('/task not found/i');
    expect(deleteBody).toContain('await gotoWithRetry(page, listPath)');
    expect(deleteBody).toContain('await page.waitForURL(listUrl');
  });

  it('keeps backend-real visual review workspace fixtures aligned with directory-backed project creator selection', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-visual-review.spec.ts'),
      'utf-8',
    );

    expect(source).toContain('createAndPublishWorkspaceWithDirectoryAdmin');
    expect(source).toContain('adminEmail: DEV_ADMIN_EMAIL');
    expect(source).toContain('/api/v1/workspaces/${workspaceId}/directory/users');
    expect(source).toContain('workspace_project_creator_directory_search_failed');
    expect(source).toContain('missing_email=');
    expect(source).toContain('status=');
    expect(source).toContain('body=');
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
