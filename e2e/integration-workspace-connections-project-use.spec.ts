import http from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  keycloakLoginToWorkspace,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  LOCALE,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_CONNECTIONS_STORY = loadStoryDefinitionSync('workspace-connections-to-project-use');
const WORKSPACE_CONNECTIONS_BINDING = buildTraceStoryBinding(WORKSPACE_CONNECTIONS_STORY);

type WorkspaceConnectionsRuntime = {
  projectNamePrefix: string;
  endpointNamePrefix: string;
  credentialNamePrefix: string;
  model: string;
  apiKeyLabelPrefix: string;
  apiKeyTtlDays: string;
  consumeProtocol: 'anthropic';
  expectedReplyText: string;
};

function requireWorkspaceConnectionsRuntime(): WorkspaceConnectionsRuntime {
  const runtimeRoot = WORKSPACE_CONNECTIONS_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.workspaceConnectionsToProjectUse as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_workspace_connections_to_project_use_runtime_data');
  }
  for (const key of [
    'projectNamePrefix',
    'endpointNamePrefix',
    'credentialNamePrefix',
    'model',
    'apiKeyLabelPrefix',
    'apiKeyTtlDays',
    'consumeProtocol',
    'expectedReplyText',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_workspace_connections_to_project_use_runtime_data:${key}`);
    }
  }
  if (runtime.consumeProtocol !== 'anthropic') {
    throw new Error('missing_workspace_connections_to_project_use_runtime_data:consumeProtocol');
  }
  return runtime as unknown as WorkspaceConnectionsRuntime;
}

async function startAnthropicCompatibleStreamingUpstream(replyText: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'POST' && requestUrl.pathname.endsWith('/messages')) {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          req.on('error', reject);
        });
        const parsed = body.trim().length > 0 ? JSON.parse(body) as { stream?: boolean } : {};
        if (parsed.stream) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.setHeader('cache-control', 'no-cache');
          res.setHeader('connection', 'keep-alive');
          res.write('event: message_start\n');
          res.write('data: {"type":"message_start","message":{"id":"msg_gateway_it"}}\n\n');
          res.write('event: content_block_delta\n');
          res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: replyText } })}\n\n`);
          res.write('event: message_stop\n');
          res.write('data: {"type":"message_stop"}\n\n');
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'msg_gateway_it',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: replyText }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 4 },
        }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('unable_to_start_anthropic_upstream');
  }
  const port = address.port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function createPersonalApiKey(page: Page, input: { label: string; ttlDays: string }): Promise<string> {
  await page.goto(`/${LOCALE}/user/api-keys`);
  await expect(page.getByTestId('api-keys__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('api-keys__create-btn').click();
  const dialog = page.getByTestId('api-keys__create-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const inputs = dialog.locator('input');
  await inputs.nth(0).fill(input.label);
  await inputs.nth(1).fill(input.ttlDays);
  await dialog.getByRole('button', { name: /create/i }).click();
  const createdDialog = page.getByTestId('api-keys__key-created-dialog');
  await expect(createdDialog).toBeVisible({ timeout: 30_000 });
  const keyValue = (await createdDialog.locator('code').textContent())?.trim() || '';
  expect(keyValue).toContain('asku_');
  await createdDialog.getByRole('button', { name: /confirm/i }).click();
  return keyValue;
}

async function joinProjectNow(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
  const joinButton = page.getByTestId(`projects__join-project-btn--${projectId}`);
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
  await joinButton.click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}(/|$)`), { timeout: 30_000 });
}

async function createProjectAndEndpoint(page: Page, runtime: WorkspaceConnectionsRuntime, upstreamBaseUrl: string): Promise<{ workspaceId: string; projectId: string; endpointName: string; endpointId: string }> {
  const workspaceId = 'ws_default';
  const projectName = `${runtime.projectNamePrefix} ${Date.now()}`;
  await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
  const { projectId } = await createProjectInWorkspace(page, workspaceId, projectName, {
    visibility: 'public',
    joinPolicy: 'open',
  });
  const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
  const endpointName = `${runtime.endpointNamePrefix} ${Date.now()}`;
  await createCredentialViaUi(page, workspaceId, projectId, credentialName, 'gateway-upstream-test-key');
  const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
    endpointName,
    endpointModel: runtime.model,
    upstreamBaseUrl,
    credentialName,
    upstreamProtocol: 'anthropic_messages',
  });
  return { workspaceId, projectId, endpointName, endpointId };
}

test.describe('@lane-real integration workspace connections project use', () => {
  test('workspace connections gives a clear handoff into first project use-guide consumption', async ({ page }) => {
    test.setTimeout(600_000);
    const runtime = requireWorkspaceConnectionsRuntime();
    const upstream = await startAnthropicCompatibleStreamingUpstream(runtime.expectedReplyText);
    const { workspaceId, projectId, endpointName, endpointId } = await createProjectAndEndpoint(page, runtime, upstream.baseUrl);
    await ensureIntegrationKeycloakUsers();

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-connections-project-use',
      storyId: WORKSPACE_CONNECTIONS_STORY.storyId,
      title: WORKSPACE_CONNECTIONS_STORY.title,
      actor: WORKSPACE_CONNECTIONS_STORY.actor,
      route: `/${LOCALE}/workspaces/${workspaceId}/connections`,
      specFile: 'e2e/integration-workspace-connections-project-use.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_CONNECTIONS_STORY.goal,
      preconditions: [...(WORKSPACE_CONNECTIONS_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_CONNECTIONS_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_CONNECTIONS_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD);
      await joinProjectNow(page, workspaceId, projectId);

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/connections`);
      await expect(page.getByTestId('workspace-connections__feishu-connect')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'review-workspace-connections',
        action: 'Review workspace connections',
        target: 'workspace-connections__next-step',
        note: '工作区连接页必须清楚告诉用户下一步可以进入项目使用，而不是停在连接状态上。',
      });

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
      await expect(page.getByTestId('use-guide__page')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'open-project-use-guide',
        action: 'Open project use guide',
        target: 'use-guide__page',
        note: 'use-guide 应该承接成员进入项目后的第一次消费入口。',
      });
      await trace.capture(page, {
        stepId: 'verify-project-use-ready',
        action: 'Verify project use ready',
        target: 'use-guide__endpoint-select',
        note: '用户应能从连接页顺滑进入 use-guide，并看到可消费的 endpoint。',
      });

      await page.getByTestId('use-guide__endpoint-select').click();
      await page.getByRole('option', { name: endpointName }).click();
      await expect(page.getByTestId('use-guide__gateway-base-url')).toContainText(
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy`,
      );

      const apiKey = await createPersonalApiKey(page, {
        label: `${runtime.apiKeyLabelPrefix} ${Date.now()}`,
        ttlDays: runtime.apiKeyTtlDays,
      });
      await trace.capture(page, {
        stepId: 'create-personal-api-key',
        action: 'Create personal API key',
        target: 'api-keys__create-btn',
        note: '个人 API key 是成员第一次真实消费的一部分。',
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic/messages`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          data: {
            model: runtime.model,
            max_tokens: 64,
            messages: [{ role: 'user', content: [{ type: 'text', text: `Reply exactly: ${runtime.expectedReplyText}` }] }],
          },
        },
      );
      expect(response.ok()).toBeTruthy();
      await expect(response.text()).resolves.toContain(runtime.expectedReplyText);
      await trace.capture(page, {
        stepId: 'consume-project-endpoint',
        action: 'Consume project endpoint',
        target: 'use-guide__gateway-base-url',
        note: 'workspace connections 的 handoff 必须真的把成员带到一次成功调用，而不是只停在链接页。',
      });
      await trace.capture(page, {
        stepId: 'verify-first-consumption',
        action: 'Verify first consumption',
        target: 'use-guide__gateway-base-url',
        note: '第一次消费返回预期结果，说明 workspace connections 真的把人带到了可用的 project use。',
      });
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
      await upstream.stop();
    }
  });
});
