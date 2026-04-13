import type { AddressInfo } from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const USAGE_SELF_SCOPE_STORY = loadStoryDefinitionSync(
  path.resolve(process.cwd(), 'e2e/stories/backend-real/usage-self-scope-review.story.md'),
);
const USAGE_SELF_SCOPE_BINDING = buildTraceStoryBinding(USAGE_SELF_SCOPE_STORY);

type UsageSelfScopeRuntime = {
  projectNamePrefix: string;
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  model: string;
  expectedReplyText: string;
};

function requireUsageSelfScopeRuntime(): UsageSelfScopeRuntime {
  const runtimeRoot = USAGE_SELF_SCOPE_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.usageSelfScope as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_usage_self_scope_runtime');
  }

  for (const field of [
    'projectNamePrefix',
    'credentialNamePrefix',
    'endpointNamePrefix',
    'model',
    'expectedReplyText',
  ] as const) {
    if (typeof runtime[field] !== 'string' || runtime[field].trim().length === 0) {
      throw new Error(`missing_usage_self_scope_runtime:${field}`);
    }
  }

  return runtime as unknown as UsageSelfScopeRuntime;
}

async function startAnthropicCompatibleUpstream(replyText: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
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
        const parsed = body.trim().length > 0
          ? JSON.parse(body) as { stream?: boolean }
          : {};
        if (parsed.stream) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.setHeader('cache-control', 'no-cache');
          res.setHeader('connection', 'keep-alive');
          res.write('event: message_start\n');
          res.write('data: {"type":"message_start","message":{"id":"msg_usage_self_scope"}}\n\n');
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
          id: 'msg_usage_self_scope',
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
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function joinProjectNow(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
  const joinButton = page.getByTestId(`projects__join-project-btn--${projectId}`);
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
  await joinButton.click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}(/|$)`), {
    timeout: 30_000,
  });
}

async function sendMemberEndpointTraffic(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  model: string;
  expectedReplyText: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/endpoints/${args.endpointId}/proxy/anthropic/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      data: {
        model: args.model,
        max_tokens: 64,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Reply exactly: ${args.expectedReplyText}` }] }],
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`usage_self_scope_endpoint_request_failed:${response.status()}:${await response.text()}`);
  }
  await expect(response.text()).resolves.toContain(args.expectedReplyText);
}

async function waitForUsageFacts(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/usage/facts?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}&page=1&page_size=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.ok()) {
      const payload = (await response.json()) as {
        items?: Array<{ resource_id?: string; requests?: number }>;
      };
      const usageForEndpoint = (payload.items ?? []).find((item) => item.resource_id === args.endpointId);
      if ((usageForEndpoint?.requests ?? 0) > 0) {
        return;
      }
    }
    await args.page.waitForTimeout(2_000);
  }

  throw new Error('usage_self_scope_usage_not_ready');
}

test.describe('@lane-real usage self scope review', () => {
  test('member reviews personal usage after generating one real endpoint request', async ({ page }) => {
    test.setTimeout(600_000);
    const runtime = requireUsageSelfScopeRuntime();
    const workspaceId = 'ws_default';
    const upstream = await startAnthropicCompatibleUpstream(runtime.expectedReplyText);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-usage-self-scope',
      storyId: USAGE_SELF_SCOPE_STORY.storyId,
      title: USAGE_SELF_SCOPE_STORY.title,
      actor: USAGE_SELF_SCOPE_STORY.actor,
      route: USAGE_SELF_SCOPE_STORY.entryRoute,
      specFile: 'e2e/integration-usage-self-scope.spec.ts',
      browser: 'chromium',
      goal: USAGE_SELF_SCOPE_STORY.goal,
      preconditions: [...(USAGE_SELF_SCOPE_STORY.preconditions ?? [])],
      seedData: [...(USAGE_SELF_SCOPE_STORY.seedData ?? [])],
      storyBinding: USAGE_SELF_SCOPE_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await ensureIntegrationKeycloakUsers();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, runtime.projectNamePrefix, {
        visibility: 'public',
        joinPolicy: 'open',
      });
      const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, credentialName, 'sk-usage-self-scope');
      const endpointName = `${runtime.endpointNamePrefix} ${Date.now()}`;
      const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
        endpointName,
        endpointModel: runtime.model,
        upstreamBaseUrl: upstream.baseUrl,
        credentialName,
        upstreamProtocol: 'anthropic_messages',
      });

      await keycloakLoginToWorkspace(
        page,
        workspaceId,
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );
      await joinProjectNow(page, workspaceId, projectId);
      await sendMemberEndpointTraffic({
        page,
        workspaceId,
        projectId,
        endpointId,
        model: runtime.model,
        expectedReplyText: runtime.expectedReplyText,
      });
      trace.note({
        stepId: 'generate-self-usage',
        action: 'Generate personal endpoint usage',
        target: 'endpoint proxy request',
        route: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}`,
        request: {
          method: 'POST',
          url: `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic/messages`,
          summary: 'member endpoint request to generate self-scoped usage',
        },
        response: {
          status: 200,
          summary: runtime.expectedReplyText,
        },
        assertion: 'member generated one real endpoint request before opening usage review',
        note: "usage story starts from the member's own request, not from owner governance views.",
      });

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/usage`);
      await expect(page.getByTestId('usage__view')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('usage__work-surface')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'open-usage-review' });

      await expect(page.getByTestId('usage__my-scope-badge')).toHaveText(/my usage|我的用量/i, { timeout: 30_000 });
      await expect(page.getByTestId('usage__scope-note')).toContainText(/only your requests|仅显示你自己的请求/i, { timeout: 30_000 });
      await trace.capture(page, { stepId: 'review-self-scope-summary' });

      await waitForUsageFacts({
        page,
        workspaceId,
        projectId,
        endpointId,
      });
      await expect(page.getByTestId('usage__selected-endpoint')).toHaveText(endpointName, { timeout: 30_000 });
      await expect(page.getByTestId('usage__limit-row').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('usage__trend')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'review-endpoint-usage' });

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
      await upstream.stop();
    }
  });
});
