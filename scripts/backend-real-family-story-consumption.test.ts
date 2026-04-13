import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog, loadCommittedStoryDefinitionByIdSync } from './story-catalog-support';

type GeneratedStorySpec = {
  storyId: string;
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

function expectedSourceRefForStory(story: { sourceFile?: string; filePath: string; storyId: string }): string {
  const sourcePath = story.sourceFile ?? path.relative(process.cwd(), story.filePath).replace(/\\/g, '/');
  return `${sourcePath}#${story.storyId}`;
}

describe('backend-real family story consumption', () => {
  it('keeps the daily-use and self-service family stories in the generated story catalog', async () => {
    const { stories } = await loadCanonicalStoryCatalog();
    const specs = await readGeneratedStorySpecs();
    const backendRealStories = stories.filter((story) => story.lane === 'backend-real');
    const backendRealSpecs = specs.filter((entry) => backendRealStories.some((story) => story.storyId === entry.storyId));

    expect(backendRealSpecs.map((entry) => entry.storyId)).toEqual(backendRealStories.map((story) => story.storyId));

    for (const story of backendRealStories) {
      const spec = backendRealSpecs.find((entry) => entry.storyId === story.storyId);

      expect(spec?.lane).toBe('backend-real');
      expect(spec?.sourceRef).toBe(expectedSourceRefForStory(story));
      expect(spec?.stepIds).toEqual(story.steps.map((step) => step.stepId));
      expect(spec?.traceStepIds).toEqual(
        story.steps.filter((step) => step.evidence.includes('trace')).map((step) => step.stepId),
      );
    }
  });

  it('loads story definitions in the backend-real family specs instead of hard-coding daily-use runtime details inline', async () => {
    const chatSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-chat-llm-runner.spec.ts'), 'utf-8');
    const filesCrudSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-files.spec.ts'), 'utf-8');
    const filesSyncSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-files-mount-sync.spec.ts'), 'utf-8');
    const notebookSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-notebook-codex-runner.spec.ts'), 'utf-8');
    const apiKeySource = await readFile(path.resolve(process.cwd(), 'e2e/integration-api-key-gateway.spec.ts'), 'utf-8');
    const contextSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-context-store-isolation.spec.ts'), 'utf-8');
    const filesSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-files-management-ux.spec.ts'), 'utf-8');
    const membersSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-membership-chat-isolation.spec.ts'), 'utf-8');
    const publishSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-workspace-publish-usable.spec.ts'), 'utf-8');
    const workspaceSettingsSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-workspace-settings-directory.spec.ts'), 'utf-8');
    const endpointSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-endpoint-create-edit.spec.ts'), 'utf-8');
    const agentMemberSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-agent-member-permissions.spec.ts'), 'utf-8');

    expect(chatSource).toContain("loadStoryDefinitionSync('chat-conversation-continuity')");
    expect(chatSource).toContain('buildTraceStoryBinding');
    expect(chatSource).not.toContain('What token did I ask you to remember? Reply with only the token.');
    expect(chatSource).not.toContain('MEM_${Date.now()}');

    expect(filesCrudSource).toContain("loadStoryDefinitionSync('files-crud-and-sync')");
    expect(filesCrudSource).toContain('buildTraceStoryBinding');
    expect(filesCrudSource).toContain('createUxTraceBundleWriter');
    expect(filesCrudSource).not.toContain('integration-note-renamed.txt');
    expect(filesCrudSource).not.toContain('integration-note.txt');

    expect(filesSyncSource).toContain("loadStoryDefinitionSync('files-crud-and-sync')");
    expect(filesSyncSource).toContain('buildTraceStoryBinding');
    expect(filesSyncSource).toContain('createUxTraceBundleWriter');
    expect(filesSyncSource).not.toContain('from-local.txt');
    expect(filesSyncSource).not.toContain('from-web.txt');
    expect(filesSyncSource).not.toContain('Mount Sync');

    expect(notebookSource).toContain("loadStoryDefinitionSync('notebook-artifact-to-files-download')");
    expect(notebookSource).toContain('buildTraceStoryBinding');
    expect(notebookSource).toContain("].join('\\n')");
    expect(notebookSource).not.toContain('North America consumer electronics');

    expect(apiKeySource).toContain("loadStoryDefinitionSync('api-key-to-endpoint-consumption')");
    expect(apiKeySource).toContain('buildTraceStoryBinding');
    expect(apiKeySource).toContain('runtime.consumeProtocol');
    expect(apiKeySource).toContain('text/event-stream');
    expect(apiKeySource).not.toContain("projects__join-now-dialog");
    expect(apiKeySource).not.toContain("Reply exactly: ok");
    expect(apiKeySource).not.toContain("'ok'");

    expect(contextSource).toContain("readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-project-personal-context.story.md')");
    expect(contextSource).toContain('buildTraceStoryBinding');
    expect(contextSource).toContain('user-menu__workspace-personal-context');
    expect(contextSource).toContain('user-menu__project-personal-context');
    expect(contextSource).not.toContain("projects__join-now-dialog");
    expect(contextSource).not.toContain('prefs.member_private_');
    expect(contextSource).not.toContain('shared.workspace_visible_');

    expect(filesSource).toContain("loadStoryDefinitionSync('files-library-access-and-recovery')");
    expect(filesSource).toContain('buildTraceStoryBinding');
    expect(filesSource).toContain('createUxTraceBundleWriter');
    expect(filesSource).not.toContain('Release UX Degraded');

    expect(membersSource).toContain("loadStoryDefinitionSync('members-invite-and-chat-privacy')");
    expect(membersSource).toContain('buildTraceStoryBinding');
    expect(membersSource).toContain('createUxTraceBundleWriter');
    expect(membersSource).not.toContain('Invite Chat Isolation');
    expect(membersSource).not.toContain('OWNER_PRIVATE_MESSAGE_');

    expect(publishSource).toContain("loadStoryDefinitionSync('workspace-publish-to-usable-access')");
    expect(publishSource).toContain('buildTraceStoryBinding');
    expect(publishSource).toContain('createUxTraceBundleWriter');
    expect(publishSource).toContain("loadStoryDefinitionSync('workspace-idp-and-admin-handoff')");
    expect(publishSource).toContain('system-workspaces__draft-admin');
    expect(publishSource).not.toContain('Publish Usable');
    expect(publishSource).not.toContain('dev-admin@example.com');

    expect(workspaceSettingsSource).toContain("loadStoryDefinitionSync('workspace-settings-save-and-effect')");
    expect(workspaceSettingsSource).toContain('buildTraceStoryBinding');
    expect(workspaceSettingsSource).toContain('createUxTraceBundleWriter');
    expect(workspaceSettingsSource).not.toContain('integration-user@example.com');
    expect(workspaceSettingsSource).toContain('ensureProjectCreatorAccess: false');

    expect(endpointSource).toContain("loadStoryDefinitionSync('project-governance-runtime-setup')");
    expect(endpointSource).toContain('buildTraceStoryBinding');
    expect(endpointSource).toContain('createUxTraceBundleWriter');
    expect(endpointSource).not.toContain('Project Governance Credential');
    expect(endpointSource).not.toContain('Responses Custom');
    expect(endpointSource).not.toContain('Catalog Anthropic');

    expect(agentMemberSource).toContain("loadStoryDefinitionSync('project-governance-runtime-setup')");
    expect(agentMemberSource).toContain('buildTraceStoryBinding');
    expect(agentMemberSource).toContain('createUxTraceBundleWriter');
    expect(agentMemberSource).not.toContain('Project Governance Credential');
    expect(agentMemberSource).not.toContain('Agent Permissions Endpoint');
    expect(agentMemberSource).not.toContain('member-use-only-agent');
  });

  it('keeps notebook artifact prompts executable as multiline shell commands', () => {
    const story = loadCommittedStoryDefinitionByIdSync('notebook-artifact-to-files-download');
    const runtime = (story.runtimeData as Record<string, unknown> | undefined)?.notebookArtifactDownload as
      | Record<string, unknown>
      | undefined;

    expect(typeof runtime?.createPrompt).toBe('string');
    const prompt = runtime?.createPrompt as string;
    expect(prompt).toContain('```bash\n');
    expect(prompt).toContain("\nmkdir -p .artifacts && cat <<'EOF' > .artifacts/story-notebook-download.md\n");
    expect(prompt).toContain('\nEOF\n```');
    expect(prompt).toContain('\nAfter the file is written, reply with exactly: NOTEBOOK_ARTIFACT_DOWNLOAD_OK');
  });

  it('keeps api key and personal context stories aligned with the member journey assumptions', () => {
    const apiKeyStory = loadCommittedStoryDefinitionByIdSync('api-key-to-endpoint-consumption');
    const apiKeyRuntime = (apiKeyStory.runtimeData as Record<string, unknown> | undefined)?.apiKeyEndpointConsumption as
      | Record<string, unknown>
      | undefined;
    expect(apiKeyRuntime?.consumeProtocol).toBe('anthropic');

    const personalContextStory = loadCommittedStoryDefinitionByIdSync('workspace-project-personal-context');
    const [workspaceStep, projectStep] = personalContextStory.steps.filter(
      (step) =>
        step.stepId === 'open-workspace-personal-context'
        || step.stepId === 'open-project-personal-context',
    );
    expect(workspaceStep?.target).toBe('user-menu__workspace-personal-context');
    expect(projectStep?.target).toBe('user-menu__project-personal-context');
  });

  it('keeps the second-wave backend-real stories aligned with user goals instead of implementation-specific runtime labels', () => {
    const filesCrudStory = loadCommittedStoryDefinitionByIdSync('files-crud-and-sync');
    expect(filesCrudStory.goal).toContain('管理文件');
    expect(filesCrudStory.goal).not.toContain('JuiceFS');

    const filesStory = loadCommittedStoryDefinitionByIdSync('files-library-access-and-recovery');
    expect(filesStory.goal).toContain('文件库');
    expect(filesStory.goal).not.toContain('Mongo');

    const membersStory = loadCommittedStoryDefinitionByIdSync('members-invite-and-chat-privacy');
    expect(membersStory.goal).toContain('成员');
    expect(membersStory.goal).not.toContain('JWT');

    const publishStory = loadCommittedStoryDefinitionByIdSync('workspace-publish-to-usable-access');
    expect(publishStory.goal).toContain('发布');
    expect(publishStory.goal).not.toContain('Keycloak');

    const workspaceSettingsStory = loadCommittedStoryDefinitionByIdSync('workspace-settings-save-and-effect');
    expect(workspaceSettingsStory.goal).toContain('project creator');
    expect(workspaceSettingsStory.goal).not.toContain('directory search');
  });

  it('keeps the chat day-two and first notebook stories aligned with common user journeys instead of runner internals', () => {
    const chatDayTwoStory = loadCommittedStoryDefinitionByIdSync('chat-day-two-thread-workflow');
    expect(chatDayTwoStory.goal).toContain('第二天');
    expect(chatDayTwoStory.goal).not.toContain('upstream');

    const notebookFirstStory = loadCommittedStoryDefinitionByIdSync('notebook-first-success');
    expect(notebookFirstStory.goal).toContain('第一次');
    expect(notebookFirstStory.goal).not.toContain('WebSocket');
  });

  it('keeps files story runtime data focused on stable fixtures instead of environment-derived deployment URLs', async () => {
    const filesStory = loadCommittedStoryDefinitionByIdSync('files-library-access-and-recovery');
    const filesRuntime = (filesStory.runtimeData as Record<string, unknown> | undefined)?.filesLibraryAccessRecovery as
      | Record<string, unknown>
      | undefined;
    const filesSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-files-management-ux.spec.ts'), 'utf-8');

    expect(filesRuntime).toBeDefined();
    expect(filesRuntime).not.toHaveProperty('desktopMountUrl');
    expect(filesSource).not.toContain('runtime.desktopMountUrl');
    expect(filesSource).toContain("files__desktop-mount__deployment-url");
    expect(filesSource).toMatch(/toHaveValue\(\/https\?:\\\/\\\/\.\+\/\)/);
  });

  it('keeps files CRUD and workspace settings stories focused on visible user outcomes instead of raw fixture strings', async () => {
    const filesCrudStory = loadCommittedStoryDefinitionByIdSync('files-crud-and-sync');
    const filesCrudRuntime = (filesCrudStory.runtimeData as Record<string, unknown> | undefined)?.filesCrudSync as
      | Record<string, unknown>
      | undefined;
    expect(filesCrudRuntime).toBeDefined();
    expect(filesCrudRuntime?.webCrud).toBeDefined();
    expect(filesCrudRuntime?.mountSync).toBeDefined();

    const workspaceSettingsStory = loadCommittedStoryDefinitionByIdSync('workspace-settings-save-and-effect');
    const workspaceSettingsRuntime = (workspaceSettingsStory.runtimeData as Record<string, unknown> | undefined)?.workspaceSettingsSaveEffect as
      | Record<string, unknown>
      | undefined;
    expect(workspaceSettingsRuntime?.creatorEmail).toBe('integration-user@example.com');
    expect(typeof workspaceSettingsRuntime?.projectNamePrefix).toBe('string');
  });

  it('anchors the workspace publish story on the live system workspaces entry point instead of a removed heading marker', async () => {
    const publishStory = loadCommittedStoryDefinitionByIdSync('workspace-publish-to-usable-access');
    const publishScene = publishStory.scenes.find((scene) => scene.sceneId === 'system-workspaces');
    const publishStep = publishStory.steps.find((step) => step.stepId === 'publish-workspace');
    const publishSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-workspace-publish-usable.spec.ts'), 'utf-8');

    expect(publishScene?.stableMarkers).toEqual(['system-workspaces__new-workspace']);
    expect(publishStep?.target).toBe('system-workspaces__new-workspace');
    expect(publishSource).not.toContain("system-workspaces__heading");
    expect(publishSource).not.toContain("system-workspace-create__heading");
    expect(publishSource).toContain("getByTestId('system-workspaces__draft-admin')");
    expect(publishSource).toContain("system-workspaces__new-workspace");
    expect(publishSource).toContain("system-workspace-create__shell");
    expect(publishSource).toContain("system-workspaces__admin-mode--email");
  });

  it('keeps the family story source files external to the specs', async () => {
    const specs = await readGeneratedStorySpecs();

    expect(specs.find((entry) => entry.storyId === 'chat-conversation-continuity')?.sourceRef).toBe(
      'e2e/stories/backend-real/chat-conversation-continuity.story.md#chat-conversation-continuity',
    );
    expect(specs.find((entry) => entry.storyId === 'chat-day-two-thread-workflow')?.sourceRef).toBe(
      'e2e/stories/backend-real/chat-day-two-thread-workflow.story.md#chat-day-two-thread-workflow',
    );
    expect(specs.find((entry) => entry.storyId === 'files-crud-and-sync')?.sourceRef).toBe(
      'e2e/stories/backend-real/files-crud-and-sync.story.md#files-crud-and-sync',
    );
    expect(specs.find((entry) => entry.storyId === 'notebook-artifact-to-files-download')?.sourceRef).toBe(
      'e2e/stories/backend-real/notebook-artifact-to-files-download.story.md#notebook-artifact-to-files-download',
    );
    expect(specs.find((entry) => entry.storyId === 'notebook-first-success')?.sourceRef).toBe(
      'e2e/stories/backend-real/notebook-first-success.story.md#notebook-first-success',
    );
    expect(specs.find((entry) => entry.storyId === 'api-key-to-endpoint-consumption')?.sourceRef).toBe(
      'e2e/stories/backend-real/api-key-to-endpoint-consumption.story.md#api-key-to-endpoint-consumption',
    );
    expect(specs.find((entry) => entry.storyId === 'workspace-project-personal-context')?.sourceRef).toBe(
      'e2e/stories/backend-real/workspace-project-personal-context.story.md#workspace-project-personal-context',
    );
    expect(specs.find((entry) => entry.storyId === 'files-library-access-and-recovery')?.sourceRef).toBe(
      'e2e/stories/backend-real/files-library-access-and-recovery.story.md#files-library-access-and-recovery',
    );
    expect(specs.find((entry) => entry.storyId === 'members-invite-and-chat-privacy')?.sourceRef).toBe(
      'e2e/stories/backend-real/members-invite-and-chat-privacy.story.md#members-invite-and-chat-privacy',
    );
    expect(specs.find((entry) => entry.storyId === 'workspace-publish-to-usable-access')?.sourceRef).toBe(
      'e2e/stories/backend-real/workspace-publish-to-usable-access.story.md#workspace-publish-to-usable-access',
    );
    expect(specs.find((entry) => entry.storyId === 'workspace-settings-save-and-effect')?.sourceRef).toBe(
      'e2e/stories/backend-real/workspace-settings-save-and-effect.story.md#workspace-settings-save-and-effect',
    );
    expect(specs.find((entry) => entry.storyId === 'system-admin-multi-workspace-handoff')?.sourceRef).toBe(
      'e2e/stories/backend-real/system-admin-multi-workspace-handoff.story.md#system-admin-multi-workspace-handoff',
    );
  });
});
