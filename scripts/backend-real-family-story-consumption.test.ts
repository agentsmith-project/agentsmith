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

const REMOVED_SYSTEM_WORKSPACES_HEADING_MARKER = 'system-workspaces__heading';

const SYSTEM_WORKSPACES_ENTRY_CONTRACT_FILES = [
  'e2e/integration-release-user-story.spec.ts',
  'e2e/stories/backend-real/project-governance-onboarding.story.md',
  'e2e/stories/backend-real/system-admin-entry.story.md',
  'e2e/stories/backend-real/real-backend-visual-review.story.md',
  'e2e/stories/backend-real/release-user-story-end-to-end.story.md',
  'e2e/generated/story-specs.generated.json',
] as const;

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
  it('keeps backend-real system workspace entry markers aligned with the current work surface contract', async () => {
    for (const relativeFile of SYSTEM_WORKSPACES_ENTRY_CONTRACT_FILES) {
      const source = await readFile(path.resolve(process.cwd(), relativeFile), 'utf-8');

      expect(source).not.toContain(REMOVED_SYSTEM_WORKSPACES_HEADING_MARKER);
    }
  });

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
    const notebookTerminalSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-notebook-terminal-ux.spec.ts'), 'utf-8');
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

    expect(notebookTerminalSource).toContain("loadStoryDefinitionSync('notebook-terminal-workspace-multi-session')");
    expect(notebookTerminalSource).toContain("loadStoryDefinitionSync('notebook-terminal-truth-unavailable-retry')");
    expect(notebookTerminalSource).toContain('buildTraceStoryBinding');
    expect(notebookTerminalSource).toContain('createUxTraceBundleWriter');
    expect(notebookTerminalSource).toContain("captureTerminalTrace(page, 'create-second-terminal-session')");
    expect(notebookTerminalSource).toContain("captureTerminalTrace(page, 'reload-task-and-preserve-backend-session-ids')");
    expect(notebookTerminalSource).toContain("captureTerminalTrace(page, 'reject-new-run-while-live-terminal-sessions-exist')");
    expect(notebookTerminalSource).toContain("captureTruthUnavailableTrace(page, 'return-to-task-while-terminal-truth-is-unavailable')");
    expect(notebookTerminalSource).toContain("captureTruthUnavailableTrace(page, 'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing')");
    expect(notebookTerminalSource).toContain("captureTruthUnavailableTrace(page, 'retry-terminal-truth-check-from-blocked-task')");
    expect(notebookTerminalSource).toContain("captureTruthUnavailableTrace(page, 'unlock-task-after-terminal-truth-recovers')");
    expect(notebookTerminalSource).toContain("captureTerminalTrace(page, 'reopen-terminal-workspace-after-reload')");
    expect(notebookTerminalSource).toContain("captureTerminalTrace(page, 'end-one-terminal-session-without-disrupting-others')");
    expect(notebookTerminalSource).toContain("captureTerminalTrace(page, 'end-last-terminal-session-and-resume-agent-work')");
    expect(notebookTerminalSource).toContain("page.reload({ waitUntil: 'domcontentloaded' })");
    expect(notebookTerminalSource).toContain("message: 'task_terminal_sessions_active'");
    expect(notebookTerminalSource).toContain('notebook__task-terminal-status-strip');
    expect(notebookTerminalSource).toContain('End All Sessions');
    expect(notebookTerminalSource).toContain('Retry terminal status check');
    expect(notebookTerminalSource).not.toContain("toContainText('No such file or directory')");
    expect(notebookTerminalSource).not.toContain("toContainText('Terminal session closed.')");
    expect(notebookTerminalSource).not.toContain("captureTerminalTrace(page, 'reload-task-and-restore-terminal-truth')");
    expect(notebookTerminalSource).not.toContain('Terminal session still active');
    expect(notebookTerminalSource).not.toContain("captureTerminalTrace(page, 'show-hidden-terminal-session')");

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
    expect(membersSource).toContain("captureInviteFirstWorkTrace(memberPage, 'inspect-invite-truth')");
    expect(membersSource).toContain("captureInviteFirstWorkTrace(memberPage, 'continue-to-invited-workspace-login')");
    expect(membersSource).toContain("captureInviteFirstWorkTrace(memberPage, 'complete-workspace-login-and-accept')");
    expect(membersSource).toContain("capturePrivacyTrace(memberPage, 'verify-member-first-access')");
    expect(membersSource).toContain("capturePrivacyTrace(memberPage, 'verify-chat-privacy')");
    expect(membersSource).not.toContain('Invite Chat Isolation');
    expect(membersSource).not.toContain('OWNER_PRIVATE_MESSAGE_');
    expect(membersSource).not.toContain('choose-invited-workspace');
    expect(membersSource).not.toContain('enter-invited-workspace-login');
    expect(membersSource).not.toContain('workspace-select__list');

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

  it('keeps chat continuity focused on post-refresh recall instead of first-turn token echo', async () => {
    const story = loadCommittedStoryDefinitionByIdSync('chat-conversation-continuity');
    const runtimeRoot = story.runtimeData as Record<string, unknown> | undefined;
    const chatRuntime = runtimeRoot?.chat as Record<string, unknown> | undefined;
    const continuity = chatRuntime?.continuity as Record<string, unknown> | undefined;
    const chatSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-chat-llm-runner.spec.ts'), 'utf-8');
    const rememberPhasePattern =
      /const rememberedMessages = await waitForLatestAssistantContent\(\{\s*page,\s*projectId,\s*sessionId: agentBundle\.sessionId,\s*minMessages: 2,\s*\}\);/s;
    const recallPhasePattern =
      /const sessionMessages = await waitForLatestAssistantContent\(\{\s*page,\s*projectId,\s*sessionId: agentBundle\.sessionId,\s*requiredSubstring: runtime\.rememberToken,\s*minMessages: 4,\s*\}\);/s;

    expect(continuity?.rememberPrompt).toContain('Remember this token for our session: CHAT_CONTINUITY_OK.');
    expect(continuity?.rememberPrompt).not.toContain('Make sure your reply includes the token.');
    expect(continuity?.recallPrompt).toContain('Reply with exactly the token and nothing else.');
    expect(chatSource).toContain("hasText: runtime.rememberPrompt");
    expect(chatSource).toMatch(rememberPhasePattern);
    expect(chatSource).toMatch(recallPhasePattern);
    expect(chatSource).not.toContain("hasText: runtime.rememberToken }).first()).toBeVisible({ timeout: 240_000");
  });

  it('keeps notebook terminal recovery stories in the generated catalog with canonical source refs', async () => {
    const specs = await readGeneratedStorySpecs();
    const notebookTerminalStories = [
      loadCommittedStoryDefinitionByIdSync('notebook-terminal-reentry-recovery'),
      loadCommittedStoryDefinitionByIdSync('notebook-terminal-truth-unavailable-retry'),
      loadCommittedStoryDefinitionByIdSync('notebook-terminal-workspace-multi-session'),
    ];

    for (const story of notebookTerminalStories) {
      const spec = specs.find((entry) => entry.storyId === story.storyId);

      expect(story.family).toBe('notebook-terminal-workspace');
      expect(spec?.sourceRef).toBe(expectedSourceRefForStory(story));
      expect(spec?.stepIds).toEqual(story.steps.map((step) => step.stepId));
      expect(spec?.traceStepIds).toEqual(story.steps.map((step) => step.stepId));
    }
  });

  it('keeps notebook terminal recovery language aligned with broken-session product truth instead of a narrower failed-session label', async () => {
    const recoveryStory = loadCommittedStoryDefinitionByIdSync('notebook-terminal-reentry-recovery');
    const specs = await readGeneratedStorySpecs();
    const recoverySpec = specs.find((entry) => entry.storyId === 'notebook-terminal-reentry-recovery');

    expect(recoveryStory.goal).toContain('需要恢复');
    expect(recoveryStory.goal).not.toContain('failed terminal');
    expect(recoveryStory.narrative).toContain('需要恢复');
    expect(recoveryStory.steps.find((step) => step.stepId === 'surface-broken-terminal-session-inside-same-task')?.action).toContain(
      'needs recovery',
    );
    expect(
      recoveryStory.steps.find((step) => step.stepId === 'clear-broken-session-and-keep-task-owned')?.action,
    ).toContain('needs recovery');
    expect(recoverySpec?.goal).toContain('需要恢复');
    expect(recoverySpec?.goal).not.toContain('failed terminal');
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
