import { expect, test, type Page } from '@playwright/test';
import {
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

const USE_GUIDE_STORY = loadStoryDefinitionSync('use-guide-first-consumption');
const USE_GUIDE_BINDING = buildTraceStoryBinding(USE_GUIDE_STORY);

type UseGuideRuntime = {
  projectNamePrefix: string;
  endpointNamePrefix: string;
  credentialNamePrefix: string;
  apiKeyLabelPrefix: string;
  apiKeyTtlDays: string;
  model: string;
  consumeProtocol: 'openai' | 'anthropic';
  expectedReplyText: string;
};

function requireUseGuideRuntime(): UseGuideRuntime {
  const runtimeRoot = USE_GUIDE_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.useGuideFirstConsumption as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_use_guide_first_consumption_runtime_data');
  }
  for (const key of [
    'projectNamePrefix',
    'endpointNamePrefix',
    'credentialNamePrefix',
    'apiKeyLabelPrefix',
    'apiKeyTtlDays',
    'model',
    'consumeProtocol',
    'expectedReplyText',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_use_guide_first_consumption_runtime_data:${key}`);
    }
  }
  if (runtime.consumeProtocol !== 'openai' && runtime.consumeProtocol !== 'anthropic') {
    throw new Error('missing_use_guide_first_consumption_runtime_data:consumeProtocol');
  }
  return runtime as unknown as UseGuideRuntime;
}

async function startAnthropicCompatibleStreamingUpstream(replyText: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const http = await import('node:http');
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

async function joinProjectNow(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
  const joinButton = page.getByTestId(`projects__join-project-btn--${projectId}`);
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
  await joinButton.click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}(/|$)`), { timeout: 30_000 });
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

test.describe('@lane-real integration use-guide first consumption', () => {
  test('project member can learn the guide, create a key, and successfully consume the first endpoint', async ({ page }) => {
    test.setTimeout(600_000);
    const runtime = requireUseGuideRuntime();
    const upstream = await startAnthropicCompatibleStreamingUpstream(runtime.expectedReplyText);
    const workspaceId = 'ws_default';
    try {
      await ensureIntegrationKeycloakUsers();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const projectName = `${runtime.projectNamePrefix} ${Date.now()}`;
      const { projectId } = await createProjectInWorkspace(page, workspaceId, projectName, {
        visibility: 'public',
        joinPolicy: 'open',
      });
      const endpointCredentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
      const endpointName = `${runtime.endpointNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, endpointCredentialName, 'gateway-upstream-test-key');
      const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
        endpointName,
        endpointModel: runtime.model,
        upstreamBaseUrl: upstream.baseUrl,
        credentialName: endpointCredentialName,
        upstreamProtocol: 'anthropic_messages',
      });

      const trace = await createUxTraceBundleWriter({
        outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
        lane: 'backend-real',
        suite: 'integration-use-guide-first-consumption',
        storyId: USE_GUIDE_STORY.storyId,
        title: USE_GUIDE_STORY.title,
        actor: USE_GUIDE_STORY.actor,
        route: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`,
        specFile: 'e2e/integration-use-guide-first-consumption.spec.ts',
        browser: 'chromium',
        goal: USE_GUIDE_STORY.goal,
        preconditions: [...(USE_GUIDE_STORY.preconditions ?? [])],
        seedData: [...(USE_GUIDE_STORY.seedData ?? [])],
        storyBinding: USE_GUIDE_BINDING,
      });
      let outcome: 'pass' | 'fail' = 'fail';

      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD);
      await joinProjectNow(page, workspaceId, projectId);

      try {
        await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
        await expect(page.getByTestId('use-guide__page')).toBeVisible({ timeout: 30_000 });
        await trace.capture(page, {
          stepId: 'open-use-guide',
          action: 'Open use guide',
          target: 'use-guide__page',
          note: 'use-guide 应该先把用户带到真实可用入口，而不是停在说明页。',
        });

        await page.getByTestId('use-guide__endpoint-select').click();
        await page.getByRole('option', { name: endpointName }).click();
        await expect(page.getByTestId('use-guide__gateway-base-url')).toContainText(
          `/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy`,
        );
        await trace.capture(page, {
          stepId: 'choose-first-usable-endpoint',
          action: 'Choose first usable endpoint',
          target: 'use-guide__endpoint-select',
          note: '成员应该先确认一个真正可用的 endpoint。',
        });

        const apiKey = await createPersonalApiKey(page, {
          label: `${runtime.apiKeyLabelPrefix} ${Date.now()}`,
          ttlDays: runtime.apiKeyTtlDays,
        });
        await trace.capture(page, {
          stepId: 'create-personal-api-key',
          action: 'Create personal API key',
          target: 'api-keys__create-btn',
          note: '个人 API key 是 first consumption 的一部分。',
        });

        const anthropicResponse = await page.request.post(
          `${process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000'}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic/messages`,
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
        expect(anthropicResponse.ok()).toBeTruthy();
        await expect(anthropicResponse.text()).resolves.toContain(runtime.expectedReplyText);
        await trace.capture(page, {
          stepId: 'consume-project-endpoint',
          action: 'Consume project endpoint',
          target: 'use-guide__gateway-base-url',
          note: 'use-guide 应该把成员带到可成功消费的 gateway base URL。',
        });
        await trace.capture(page, {
          stepId: 'verify-first-consumption',
          action: 'Verify first consumption',
          target: 'use-guide__gateway-base-url',
          note: '第一次消费需要真正成功，而不是只展示文案。',
        });
        outcome = 'pass';
      } finally {
        await trace.finish({ outcome, finishedAt: new Date().toISOString() });
      }
    } finally {
      await upstream.stop();
    }
  });
});
