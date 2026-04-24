import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createChatSessionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createInternalChatAgent,
  createProjectInWorkspace,
  ensureInternalChatRunnerImage,
  INTERNAL_CHAT_AGENT_IMAGE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  keycloakLoginToWorkspace,
  openChatSession,
  sanitizeWorkloadId,
  waitForWorkloadPodDeleted,
  waitForWorkloadPodIdentity,
} from './integration-real-helpers';
import { startOpenAICompatibleUpstreamWith } from './integration-chat-local-upstream';
import {
  createInternalChatIsolationProbe,
  sessionHasInternalChatIsolationReply,
  type InternalChatIsolationProbe,
} from './internal-chat-isolation-probe';
import { readStoredAuthToken } from './integration-workspace-access';

const INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS = 240_000;
const INTERNAL_CHAT_TERMINATE_SETTLE_TIMEOUT_MS = 180_000;

type ChatSessionDetail = {
  id?: string;
  execution_status?: string;
  stop_mode?: string;
  can_escalate?: boolean;
  termination_state?: 'terminating' | null;
};

type ChatSessionStreamsPayload = {
  items?: Array<{
    stream_id?: string;
    status?: 'running' | 'stopping' | 'terminating';
    started_at?: string;
  }>;
  total?: number;
};

type ChatSessionStopPayload = {
  success?: boolean;
  session_id?: string;
  state?: 'stopping' | 'terminating' | 'not_found_or_finished';
  status?: 'stopping' | 'terminating' | 'not_found_or_finished';
  stop_mode?: 'cancel' | 'terminate';
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

type ChatSessionTruth = {
  executionStatus: string | null;
  stopMode: string | null;
  canEscalate: boolean | null;
  terminationState: string | null;
  activeStreamCount: number;
  activeStreamStatuses: string[];
  stuck: boolean;
};

function requireInternalSandboxNamespace(): string {
  if (!process.env.SANDBOX_MANAGER_URL?.trim()) {
    throw new Error('missing_SANDBOX_MANAGER_URL');
  }
  if (!process.env.SANDBOX_SERVICE_KEY?.trim()) {
    throw new Error('missing_SANDBOX_SERVICE_KEY');
  }
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  if (!namespace) {
    throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  }
  return namespace;
}

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

async function readChatSessionDetail(args: {
  token: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}): Promise<ChatSessionDetail> {
  const response = await fetch(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions/${args.sessionId}`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`read_chat_session_detail_failed:${response.status}:${body}`);
  }
  return (await response.json()) as ChatSessionDetail;
}

async function listChatSessionStreams(args: {
  token: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}): Promise<ChatSessionStreamsPayload['items']> {
  const response = await fetch(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions/${args.sessionId}/streams`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`list_chat_session_streams_failed:${response.status}:${body}`);
  }
  const payload = (await response.json()) as ChatSessionStreamsPayload;
  return payload.items ?? [];
}

async function postChatSessionStop(args: {
  token: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  mode: 'cancel' | 'terminate';
}): Promise<{ status: number; payload: ChatSessionStopPayload }> {
  const response = await fetch(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions/${args.sessionId}/stop`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: args.mode,
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as ChatSessionStopPayload | null;
  return {
    status: response.status,
    payload: payload ?? {},
  };
}

async function startChatSessionStream(args: {
  token: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  content: string;
  signal?: AbortSignal;
}): Promise<Response> {
  return fetch(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions/${args.sessionId}/messages/stream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          role: 'user',
          content: args.content,
        },
      }),
      signal: args.signal,
    },
  );
}

async function readChatSessionTruth(args: {
  token: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}): Promise<ChatSessionTruth> {
  const isFinalChatExecutionStatus = (status: string | null): boolean =>
    status === 'completed' || status === 'stopped' || status === 'failed';
  const isChatSessionTerminatingTruth = (session: ChatSessionDetail): boolean => {
    if (session.termination_state === 'terminating') return true;
    if (isFinalChatExecutionStatus(session.execution_status ?? null)) return false;
    if (session.stop_mode === 'cancel') return false;
    return (
      session.execution_status === 'terminating'
      || session.stop_mode === 'terminate'
    );
  };
  const [session, streams] = await Promise.all([
    readChatSessionDetail(args),
    listChatSessionStreams(args),
  ]);
  const executionStatus = session.execution_status ?? null;
  const activeStreamStatuses = streams
    .map((item) => item.status ?? null)
    .filter((status): status is 'running' | 'stopping' | 'terminating' => status !== null);
  const executionActive =
    executionStatus === 'running'
    || executionStatus === 'stopping'
    || executionStatus === 'terminating'
    || isChatSessionTerminatingTruth(session);
  const stuck =
    executionActive
    || activeStreamStatuses.some((status) => status === 'running' || status === 'stopping' || status === 'terminating')
    || session.termination_state === 'terminating';
  return {
    executionStatus,
    stopMode: session.stop_mode ?? null,
    canEscalate: session.can_escalate ?? null,
    terminationState: session.termination_state ?? null,
    activeStreamCount: activeStreamStatuses.length,
    activeStreamStatuses,
    stuck,
  };
}

async function runChatStreamTurn(
  page: Page,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  content: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/stream`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        input: {
          role: 'user',
          content,
        },
      },
      ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function listSessionMessages(
  page: Page,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<Array<{ role?: string; content?: string }>> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { items?: Array<{ role?: string; content?: string }> };
  return payload.items ?? [];
}

async function waitForAssistantIsolationReply(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  probe: InternalChatIsolationProbe;
}): Promise<Array<{ role?: string; content?: string }>> {
  let latest: Array<{ role?: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        latest = await listSessionMessages(args.page, args.workspaceId, args.projectId, args.sessionId);
        return sessionHasInternalChatIsolationReply(latest, args.probe);
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return latest;
}

async function waitForChatComposerReady(page: Page): Promise<void> {
  const composer = page.getByTestId('chat__composer').locator('textarea');
  const sendButton = page.getByTestId('chat__send-btn');
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEnabled({ timeout: 60_000 });
  await expect(sendButton).toBeVisible({ timeout: 30_000 });
}

async function waitForAssistantReplySubstring(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  substring: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const messages = await listSessionMessages(args.page, args.workspaceId, args.projectId, args.sessionId);
        return messages.some((message) => message.role === 'assistant' && message.content?.includes(args.substring));
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

test.describe('@lane-real internal chat runner integration', () => {
  test('starts a distinct internal chat pod per session and keeps session transcripts isolated across sessions', async ({ page }) => {
    test.setTimeout(720_000);
    const namespace = requireInternalSandboxNamespace();
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Internal Chat Runner');
    const credentialName = `Internal Chat Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Internal Chat Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const image = await ensureInternalChatRunnerImage();
    expect(image).toBe(INTERNAL_CHAT_AGENT_IMAGE);

    const internalAgent = await createInternalChatAgent(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'internal-chat',
      image,
      idleTimeoutSec: 300,
      maxLifetimeSec: 1800,
    });

    const sessionOne = await createChatSessionViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `internal-chat-session-one-${Date.now()}`,
      externalAgentId: internalAgent.agentId,
    });
    const sessionOneProbe = createInternalChatIsolationProbe('session-one');
    await runChatStreamTurn(
      page,
      'ws_default',
      projectId,
      sessionOne.id,
      sessionOneProbe.prompt,
      { timeoutMs: INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS },
    );
    const sessionOneMessages = await waitForAssistantIsolationReply({
      page,
      workspaceId: 'ws_default',
      projectId,
      sessionId: sessionOne.id,
      probe: sessionOneProbe,
    });

    const workloadIdOne = sanitizeWorkloadId(sessionOne.id);
    const podOne = await waitForWorkloadPodIdentity({ namespace, workloadId: workloadIdOne, timeoutMs: 180_000 });

    const sessionTwo = await createChatSessionViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `internal-chat-session-two-${Date.now()}`,
      externalAgentId: internalAgent.agentId,
    });
    const sessionTwoProbe = createInternalChatIsolationProbe('session-two');
    await runChatStreamTurn(
      page,
      'ws_default',
      projectId,
      sessionTwo.id,
      sessionTwoProbe.prompt,
      { timeoutMs: INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS },
    );
    const sessionTwoMessages = await waitForAssistantIsolationReply({
      page,
      workspaceId: 'ws_default',
      projectId,
      sessionId: sessionTwo.id,
      probe: sessionTwoProbe,
    });

    const workloadIdTwo = sanitizeWorkloadId(sessionTwo.id);
    const podTwo = await waitForWorkloadPodIdentity({ namespace, workloadId: workloadIdTwo, timeoutMs: 180_000 });
    expect(podTwo.uid).not.toBe(podOne.uid);
    expect(podTwo.name).not.toBe(podOne.name);

    expect(sessionHasInternalChatIsolationReply(sessionOneMessages, sessionOneProbe)).toBe(true);
    expect(sessionHasInternalChatIsolationReply(sessionOneMessages, sessionTwoProbe)).toBe(false);
    expect(sessionHasInternalChatIsolationReply(sessionTwoMessages, sessionTwoProbe)).toBe(true);
    expect(sessionHasInternalChatIsolationReply(sessionTwoMessages, sessionOneProbe)).toBe(false);
  });

  test('terminate stop tears down the internal chat pod and clears backend-real stream truth without leaving recovery state stuck', async ({ page }) => {
    test.setTimeout(720_000);
    const namespace = requireInternalSandboxNamespace();
    const slowUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'slow upstream reply should never fully arrive before terminate',
      holdResponseOpen: true,
    });
    const streamAbortController = new AbortController();
    let streamSettled = false;

    try {
      await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Internal Chat Terminate Recovery');
      const credentialName = `Internal Chat Terminate Credential ${Date.now()}`;
      await createCredentialViaUi(page, 'ws_default', projectId, credentialName, 'integration-local-upstream-key');
      const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
        endpointName: `Internal Chat Terminate Endpoint ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: slowUpstream.baseUrl,
        credentialName,
        upstreamProtocol: 'openai_chat_completions',
      });
      const image = await ensureInternalChatRunnerImage();
      expect(image).toBe(INTERNAL_CHAT_AGENT_IMAGE);

      const internalAgent = await createInternalChatAgent(page, {
        workspaceId: 'ws_default',
        projectId,
        endpointId,
        title: 'internal-chat-terminate',
        image,
        idleTimeoutSec: 300,
        maxLifetimeSec: 1800,
      });

      const session = await createChatSessionViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `internal-chat-terminate-${Date.now()}`,
        externalAgentId: internalAgent.agentId,
      });
      const token = await readStoredAuthToken(page);
      expect(token).toBeTruthy();

      let streamOutcome:
        | { ok: true; status: number; body: string }
        | { ok: false; status: number; error: string }
        | null = null;
      const streamPromise = startChatSessionStream({
        token: token!,
        workspaceId: 'ws_default',
        projectId,
        sessionId: session.id,
        content: `terminate internal stream ${Date.now()}`,
        signal: streamAbortController.signal,
      })
        .then(async (response) => {
          const body = await response.text().catch((error) => (
            `stream_text_read_failed:${error instanceof Error ? error.message : String(error)}`
          ));
          streamOutcome = { ok: true, status: response.status, body };
          return streamOutcome;
        })
        .catch((error) => {
          streamOutcome = {
            ok: false,
            status: 0,
            error: error instanceof Error ? error.message : String(error),
          };
          return streamOutcome;
        })
        .finally(() => {
          streamSettled = true;
        });

      await expect
        .poll(() => slowUpstream.getRequestCount(), {
          timeout: INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS,
          intervals: [500, 1_000, 2_000, 5_000],
        })
        .toBeGreaterThanOrEqual(1);

      const workloadId = sanitizeWorkloadId(session.id);
      await waitForWorkloadPodIdentity({
        namespace,
        workloadId,
        timeoutMs: INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS,
      });

      let latestRunningTruth: Awaited<ReturnType<typeof readChatSessionTruth>> | null = null;
      await expect
        .poll(
          async () => {
            latestRunningTruth = await readChatSessionTruth({
              token: token!,
              workspaceId: 'ws_default',
              projectId,
              sessionId: session.id,
            });
            return latestRunningTruth.executionStatus === 'running' || latestRunningTruth.activeStreamCount > 0;
          },
          { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toBe(true);

      const stop = await postChatSessionStop({
        token: token!,
        workspaceId: 'ws_default',
        projectId,
        sessionId: session.id,
        mode: 'terminate',
      });
      expect(stop.status).toBe(202);
      expect(stop.payload).toMatchObject({
        success: true,
        session_id: session.id,
        state: 'terminating',
        status: 'terminating',
        stop_mode: 'terminate',
        can_escalate: false,
      });

      await waitForWorkloadPodDeleted({
        namespace,
        workloadId,
        timeoutMs: INTERNAL_CHAT_TERMINATE_SETTLE_TIMEOUT_MS,
      });

      await expect
        .poll(() => slowUpstream.getAbortedRequestCount(), {
          timeout: 60_000,
          intervals: [500, 1_000, 2_000, 5_000],
        })
        .toBeGreaterThanOrEqual(1);
      slowUpstream.releasePendingResponses();

      let latestFinalTruth: Awaited<ReturnType<typeof readChatSessionTruth>> | null = null;
      await expect
        .poll(
          async () => {
            latestFinalTruth = await readChatSessionTruth({
              token: token!,
              workspaceId: 'ws_default',
              projectId,
              sessionId: session.id,
            });
            return (
              latestFinalTruth.stuck === false
              && latestFinalTruth.activeStreamCount === 0
              && latestFinalTruth.canEscalate !== true
            );
          },
          {
            timeout: INTERNAL_CHAT_TERMINATE_SETTLE_TIMEOUT_MS,
            intervals: [1_000, 2_000, 5_000, 10_000],
          },
        )
        .toBe(true);
      expect(latestFinalTruth?.terminationState).not.toBe('terminating');

      const repeatedTerminate = await postChatSessionStop({
        token: token!,
        workspaceId: 'ws_default',
        projectId,
        sessionId: session.id,
        mode: 'terminate',
      });
      expect(repeatedTerminate.status).toBe(202);
      expect(repeatedTerminate.payload).toMatchObject({
        success: true,
        session_id: session.id,
        state: 'not_found_or_finished',
        status: 'not_found_or_finished',
        stop_mode: 'terminate',
        can_escalate: false,
      });

      let latestRepeatTruth: Awaited<ReturnType<typeof readChatSessionTruth>> | null = null;
      await expect
        .poll(
          async () => {
            latestRepeatTruth = await readChatSessionTruth({
              token: token!,
              workspaceId: 'ws_default',
              projectId,
              sessionId: session.id,
            });
            return (
              latestRepeatTruth.stuck === false
              && latestRepeatTruth.activeStreamCount === 0
              && latestRepeatTruth.canEscalate !== true
            );
          },
          { timeout: 30_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toBe(true);
      expect(latestRepeatTruth?.terminationState).not.toBe('terminating');

      const healthyReply = `internal chat recovered ${Date.now()}`;
      const recoveryPrompt = `reply with exactly: ${healthyReply}`;
      slowUpstream.setHoldResponseOpen(false);
      slowUpstream.setReplyText(healthyReply);

      await openChatSession(page, 'ws_default', projectId, session.title);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openChatSession(page, 'ws_default', projectId, session.title);
      await waitForChatComposerReady(page);

      const composer = page.getByTestId('chat__composer').locator('textarea');
      const sendButton = page.getByTestId('chat__send-btn');
      const priorRequestCount = slowUpstream.getRequestCount();
      await composer.fill(recoveryPrompt);
      await expect(sendButton).toBeEnabled({ timeout: 60_000 });
      await sendButton.click();
      await expect(page.getByTestId('chat__message').filter({ hasText: healthyReply }).first()).toBeVisible({
        timeout: 240_000,
      });
      await waitForAssistantReplySubstring({
        page,
        workspaceId: 'ws_default',
        projectId,
        sessionId: session.id,
        substring: healthyReply,
      });
      await expect
        .poll(() => slowUpstream.getRequestCount(), {
          timeout: 60_000,
          intervals: [500, 1_000, 2_000, 5_000],
        })
        .toBeGreaterThan(priorRequestCount);
      await waitForChatComposerReady(page);

      await expect
        .poll(() => streamOutcome !== null, {
          timeout: 60_000,
          intervals: [500, 1_000, 2_000, 5_000],
        })
        .toBe(true);
      const settledStream = await streamPromise;
      if (settledStream.ok) {
        expect(settledStream.status).toBe(200);
        expect(settledStream.body).toMatch(/event: (done|error)|message_status|stopped|cancel/i);
      } else {
        expect(settledStream.error).toBeTruthy();
      }
    } finally {
      if (!streamSettled) {
        streamAbortController.abort();
      }
      slowUpstream.releasePendingResponses();
      await new Promise<void>((resolve) => slowUpstream.server.close(() => resolve()));
    }
  });
});
