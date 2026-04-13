import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  ensureIntegrationKeycloakUsers,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  getContextEntryViaApi,
  keycloakLoginToWorkspace,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { openPersonalContextFromUserMenu, saveContextEntryViaUi } from './integration-context-ui-support';

const API_KEY_ENDPOINT_STORY = loadStoryDefinitionSync('api-key-to-endpoint-consumption');
const API_KEY_ENDPOINT_BINDING = buildTraceStoryBinding(API_KEY_ENDPOINT_STORY);
const PERSONAL_SELF_SERVICE_STORY = loadStoryDefinitionSync('personal-self-service-lifecycle');
const PERSONAL_SELF_SERVICE_BINDING = buildTraceStoryBinding(PERSONAL_SELF_SERVICE_STORY);

type ApiKeyEndpointRuntime = {
  projectName: string;
  endpointName: string;
  credentialName: string;
  apiKeyLabel: string;
  apiKeyTtlDays: string;
  model: string;
  consumeProtocol: 'openai' | 'anthropic';
  expectedReplyText: string;
};

type PersonalSelfServiceRuntime = {
  projectNamePrefix: string;
  endpointNamePrefix: string;
  credentialNamePrefix: string;
  profileDisplayName: string;
  profileBio: string;
  apiKeyLabelPrefix: string;
  apiKeyTtlDays: string;
  connectionDisplayNamePrefix: string;
  connectionCustomDomainSuffix: string;
  connectionToken: string;
  connectionNote: string;
  personalContextKey: string;
  workspacePersonalContextValue: string;
  projectPersonalContextValue: string;
  model: string;
  expectedReplyText: string;
};

function resolveApiKeyEndpointStep(stepId: string) {
  const step = API_KEY_ENDPOINT_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_api_key_endpoint_step:${stepId}`);
  }
  return step;
}

function resolvePersonalSelfServiceStep(stepId: string) {
  const step = PERSONAL_SELF_SERVICE_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_personal_self_service_step:${stepId}`);
  }
  return step;
}

function requireApiKeyEndpointRuntime(): ApiKeyEndpointRuntime {
  const runtimeRoot = API_KEY_ENDPOINT_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.apiKeyEndpointConsumption as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_api_key_endpoint_runtime_data');
  }
  for (const key of [
    'projectName',
    'endpointName',
    'credentialName',
    'apiKeyLabel',
    'apiKeyTtlDays',
    'model',
    'consumeProtocol',
    'expectedReplyText',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_api_key_endpoint_runtime_data:${key}`);
    }
  }
  return runtime as unknown as ApiKeyEndpointRuntime;
}

function requirePersonalSelfServiceRuntime(): PersonalSelfServiceRuntime {
  const runtimeRoot = PERSONAL_SELF_SERVICE_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.personalSelfServiceLifecycle as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_personal_self_service_runtime_data');
  }
  for (const key of [
    'projectNamePrefix',
    'endpointNamePrefix',
    'credentialNamePrefix',
    'profileDisplayName',
    'profileBio',
    'apiKeyLabelPrefix',
    'apiKeyTtlDays',
    'connectionDisplayNamePrefix',
    'connectionCustomDomainSuffix',
    'connectionToken',
    'connectionNote',
    'personalContextKey',
    'workspacePersonalContextValue',
    'projectPersonalContextValue',
    'model',
    'expectedReplyText',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_personal_self_service_runtime_data:${key}`);
    }
  }
  return runtime as unknown as PersonalSelfServiceRuntime;
}

async function getProjectPersonalContextViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  key: string;
}): Promise<{ scope?: string; key?: string; content?: string }> {
  const authToken = await readStoredAuthToken(args.page);
  const params = new URLSearchParams({
    scope: 'project_member',
    workspace_id: args.workspaceId,
    project_id: args.projectId,
    key: args.key,
  });
  const response = await args.page.request.get(`${API_BASE}/api/v1/context?${params.toString()}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ scope?: string; key?: string; content?: string }>;
}

async function startAnthropicCompatibleStreamingUpstream(replyText: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  let server: Server;
  server = http.createServer((req, res) => {
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
        res.end(
          JSON.stringify({
            id: 'msg_gateway_it',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: replyText }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 4 },
          }),
        );
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

async function createPersonalApiKey(
  page: Page,
  input: { label: string; ttlDays: string },
): Promise<string> {
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

async function updatePersonalProfile(
  page: Page,
  input: { workspaceId: string; projectId: string; displayName: string; bio: string },
): Promise<void> {
  await page.goto(`/${LOCALE}/user/profile?workspace=${input.workspaceId}&project=${input.projectId}`);
  await expect(page.getByTestId('profile__form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('profile__display-name').fill(input.displayName);
  await page.getByTestId('profile__bio').fill(input.bio);
  const saveResponse = page.waitForResponse((res) =>
    res.request().method() === 'PATCH' && res.url().includes('/api/v1/me/profile'),
  );
  await page.getByTestId('profile__save-btn').click();
  const response = await saveResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('profile__display-name')).toHaveValue(input.displayName, { timeout: 30_000 });
  await expect(page.getByTestId('profile__bio')).toHaveValue(input.bio, { timeout: 30_000 });

  const authToken = await readStoredAuthToken(page);
  expect(authToken).toBeTruthy();
  const persistedProfileResponse = await page.request.get(`${API_BASE}/api/v1/me/profile`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(persistedProfileResponse.ok()).toBeTruthy();
  const persistedProfile = (await persistedProfileResponse.json()) as { display_name?: string | null; bio?: string | null };
  expect(persistedProfile.display_name).toBe(input.displayName);
  expect(persistedProfile.bio).toBe(input.bio);
}

async function createPersonalConnection(
  page: Page,
  input: { displayName: string; customDomain: string; note: string; token: string },
): Promise<void> {
  await page.goto(`/${LOCALE}/user/third-party-accounts`);
  await expect(page.getByTestId('third-party-accounts__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('third-party-accounts__create-btn').click();
  const sheet = page.getByTestId('third-party-accounts__sheet');
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await sheet.getByTestId('third-party-accounts__provider-select').selectOption('custom');
  await expect(sheet.getByTestId('third-party-accounts__custom-domain')).toBeVisible({ timeout: 10_000 });
  await sheet.getByTestId('third-party-accounts__custom-domain').fill(input.customDomain);
  await sheet.getByTestId('third-party-accounts__display-name').fill(input.displayName);
  await sheet.getByTestId('third-party-accounts__note').fill(input.note);
  const baseUrlSecretToggle = sheet.getByTestId('third-party-accounts__field-secret-0');
  if (await baseUrlSecretToggle.isChecked()) {
    await baseUrlSecretToggle.uncheck();
  }
  await sheet.getByTestId('third-party-accounts__field-key-0').fill('base_url');
  await sheet.getByTestId('third-party-accounts__field-value-0').fill(`https://${input.customDomain}`);
  await sheet.getByTestId('third-party-accounts__field-description-0').fill('Base URL');
  await sheet.getByTestId('third-party-accounts__add-field').click();
  await sheet.getByTestId('third-party-accounts__field-key-1').fill('token');
  await sheet.getByTestId('third-party-accounts__field-value-1').fill(input.token);
  await sheet.getByTestId('third-party-accounts__field-description-1').fill('Access token');
  const createResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' && res.url().endsWith('/api/v1/me/external-connections'),
  );
  await sheet.getByTestId('third-party-accounts__submit-btn').click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByText(input.displayName)).toBeVisible({ timeout: 30_000 });
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

test.describe('@lane-real personal api key endpoint access', () => {
  test('user can create personal API key and use one endpoint through canonical openai/anthropic base urls', async ({ page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const upstreamApiKey = 'gateway-upstream-test-key';
    const runtime = requireApiKeyEndpointRuntime();
    const upstream = await startAnthropicCompatibleStreamingUpstream(runtime.expectedReplyText);

    try {
      await ensureIntegrationKeycloakUsers();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, runtime.projectName, {
        visibility: 'public',
        joinPolicy: 'open',
      });

      const endpointCredentialName = `${runtime.credentialName} ${Date.now()}`;
      const endpointName = `${runtime.endpointName} ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, endpointCredentialName, upstreamApiKey);
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
        suite: 'integration-api-key-gateway',
        storyId: API_KEY_ENDPOINT_STORY.storyId,
        title: API_KEY_ENDPOINT_STORY.title,
        actor: API_KEY_ENDPOINT_STORY.actor,
        route: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`,
        specFile: 'e2e/integration-api-key-gateway.spec.ts',
        browser: 'chromium',
        goal: API_KEY_ENDPOINT_STORY.goal,
        preconditions: [...(API_KEY_ENDPOINT_STORY.preconditions ?? [])],
        seedData: [...(API_KEY_ENDPOINT_STORY.seedData ?? [])],
        storyBinding: API_KEY_ENDPOINT_BINDING,
      });
      const captureTrace = async (stepId: string): Promise<void> => {
        const storyStep = resolveApiKeyEndpointStep(stepId);
        await trace.capture(page, {
          stepId,
          action: storyStep.action,
          target: storyStep.target,
          note: storyStep.note ?? storyStep.expectedFeedback,
        });
      };
      let outcome: 'pass' | 'fail' = 'fail';

      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD);
      await joinProjectNow(page, workspaceId, projectId);

      try {
        await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
        await page.getByTestId('use-guide__endpoint-select').click();
        await expect(page.getByRole('option', { name: endpointName })).toBeVisible({ timeout: 10_000 });
        await page.getByRole('option', { name: endpointName }).click();
        await expect(page.getByTestId('use-guide__openai-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/openai`);
        await page.getByTestId('use-guide__tab-anthropic').click();
        await expect(page.getByTestId('use-guide__anthropic-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic`);
        await captureTrace('review-use-guide');

        const apiKey = await createPersonalApiKey(page, {
          label: `${runtime.apiKeyLabel} ${Date.now()}`,
          ttlDays: runtime.apiKeyTtlDays,
        });
        await captureTrace('create-personal-api-key');

        const meResponse = await page.request.get(`${API_BASE}/api/v1/me/profile`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        expect(meResponse.ok()).toBeTruthy();

        if (runtime.consumeProtocol === 'anthropic') {
          const anthropicResponse = await page.request.post(
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
          if (!anthropicResponse.ok()) {
            throw new Error(`anthropic_endpoint_request_failed:${anthropicResponse.status()}:${await anthropicResponse.text()}`);
          }
          await expect(anthropicResponse.text()).resolves.toContain(runtime.expectedReplyText);
        } else {
          const openAiResponse = await page.request.post(
            `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              data: {
                model: runtime.model,
                input: `Reply exactly: ${runtime.expectedReplyText}`,
              },
            },
          );
          if (!openAiResponse.ok()) {
            throw new Error(`openai_endpoint_request_failed:${openAiResponse.status()}:${await openAiResponse.text()}`);
          }
          await expect(openAiResponse.text()).resolves.toContain(runtime.expectedReplyText);
        }

        await captureTrace('consume-endpoint');
        outcome = 'pass';
      } finally {
        await trace.finish({ outcome });
      }
    } finally {
      await upstream.stop();
    }
  });

  test('member configures personal identity and access into a ready state', async ({ page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const upstreamApiKey = 'gateway-upstream-test-key';
    const runtime = requirePersonalSelfServiceRuntime();
    const runId = Date.now();
    const profileDisplayName = `${runtime.profileDisplayName} ${runId}`;
    const profileBio = `${runtime.profileBio} [${runId}]`;
    const connectionDisplayName = `${runtime.connectionDisplayNamePrefix} ${runId}`;
    const connectionCustomDomain = `${runId}.${runtime.connectionCustomDomainSuffix}`;
    const apiKeyLabel = `${runtime.apiKeyLabelPrefix} ${runId}`;
    const endpointCredentialName = `${runtime.credentialNamePrefix} ${runId}`;
    const endpointName = `${runtime.endpointNamePrefix} ${runId}`;
    const projectName = `${runtime.projectNamePrefix} ${runId}`;
    const upstream = await startAnthropicCompatibleStreamingUpstream(runtime.expectedReplyText);

    try {
      await ensureIntegrationKeycloakUsers();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, projectName, {
        visibility: 'public',
        joinPolicy: 'open',
      });
      await createCredentialViaUi(page, workspaceId, projectId, endpointCredentialName, upstreamApiKey);
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
        suite: 'integration-api-key-gateway',
        storyId: PERSONAL_SELF_SERVICE_STORY.storyId,
        title: PERSONAL_SELF_SERVICE_STORY.title,
        actor: PERSONAL_SELF_SERVICE_STORY.actor,
        route: `/${LOCALE}/user/profile?workspace=${workspaceId}&project=${projectId}`,
        specFile: 'e2e/integration-api-key-gateway.spec.ts',
        browser: 'chromium',
        goal: PERSONAL_SELF_SERVICE_STORY.goal,
        preconditions: [...(PERSONAL_SELF_SERVICE_STORY.preconditions ?? [])],
        seedData: [...(PERSONAL_SELF_SERVICE_STORY.seedData ?? [])],
        storyBinding: PERSONAL_SELF_SERVICE_BINDING,
      });
      const captureSelfServiceTrace = async (stepId: string): Promise<void> => {
        const storyStep = resolvePersonalSelfServiceStep(stepId);
        await trace.capture(page, {
          stepId,
          action: storyStep.action,
          target: storyStep.target,
          note: storyStep.note ?? storyStep.expectedFeedback,
        });
      };
      let outcome: 'pass' | 'fail' = 'fail';

      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD);
      await joinProjectNow(page, workspaceId, projectId);

      try {
        const personalContextKey = `${runtime.personalContextKey}.${runId}`;
        const workspacePersonalContextValue = `${runtime.workspacePersonalContextValue} [${runId}]`;
        const projectPersonalContextValue = `${runtime.projectPersonalContextValue} [${runId}]`;

        await updatePersonalProfile(page, {
          workspaceId,
          projectId,
          displayName: profileDisplayName,
          bio: profileBio,
        });
        await captureSelfServiceTrace('update-personal-profile');

        await createPersonalConnection(page, {
          displayName: connectionDisplayName,
          customDomain: connectionCustomDomain,
          note: runtime.connectionNote,
          token: runtime.connectionToken,
        });
        await captureSelfServiceTrace('create-personal-connection');

        const apiKey = await createPersonalApiKey(page, {
          label: apiKeyLabel,
          ttlDays: runtime.apiKeyTtlDays,
        });
        await captureSelfServiceTrace('create-personal-api-key');

        await openPersonalContextFromUserMenu({
          page,
          entryPagePath: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview`,
          menuItemTestId: 'user-menu__workspace-personal-context',
          expectedPath: new RegExp(`/workspaces/${workspaceId}/context$`),
        });
        await captureSelfServiceTrace('open-workspace-personal-context');
        await saveContextEntryViaUi({
          page,
          key: personalContextKey,
          value: workspacePersonalContextValue,
        });
        await captureSelfServiceTrace('save-workspace-personal-context');

        const workspaceContext = await getContextEntryViaApi({
          page,
          scope: 'member',
          workspaceId,
          key: personalContextKey,
        });
        expect(workspaceContext.body).toEqual(expect.objectContaining({
          scope: 'member',
          key: personalContextKey,
          content: workspacePersonalContextValue,
        }));

        await openPersonalContextFromUserMenu({
          page,
          entryPagePath: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview`,
          menuItemTestId: 'user-menu__project-personal-context',
          expectedPath: new RegExp(`/workspaces/${workspaceId}/projects/${projectId}/my-context$`),
        });
        await captureSelfServiceTrace('open-project-personal-context');
        await saveContextEntryViaUi({
          page,
          key: personalContextKey,
          value: projectPersonalContextValue,
        });
        await captureSelfServiceTrace('save-project-personal-context');

        const projectContext = await getProjectPersonalContextViaApi({
          page,
          workspaceId,
          projectId,
          key: personalContextKey,
        });
        expect(projectContext).toEqual(expect.objectContaining({
          scope: 'project_member',
          key: personalContextKey,
          content: projectPersonalContextValue,
        }));

        await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
        await expect(page.getByTestId('use-guide__status-context')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('use-guide__status-context')).toContainText('project entries are ready');
        await expect(page.getByTestId('use-guide__status-context')).toContainText('workspace defaults');
        await expect(page.getByTestId('use-guide__link-workspace-context')).toHaveAttribute('href', `/${LOCALE}/workspaces/${workspaceId}/context`);
        await expect(page.getByTestId('use-guide__link-project-context')).toHaveAttribute('href', `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/my-context`);
        await page.getByTestId('use-guide__endpoint-select').click();
        await expect(page.getByRole('option', { name: endpointName })).toBeVisible({ timeout: 10_000 });
        await page.getByRole('option', { name: endpointName }).click();
        await expect(page.getByTestId('use-guide__openai-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/openai`);
        await page.getByTestId('use-guide__tab-anthropic').click();
        await expect(page.getByTestId('use-guide__anthropic-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic`);
        await captureSelfServiceTrace('review-project-access-guide');

        const meResponse = await page.request.get(`${API_BASE}/api/v1/me/profile`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!meResponse.ok()) {
          throw new Error(`personal_profile_request_failed:${meResponse.status()}:${await meResponse.text()}`);
        }
        const meProfile = (await meResponse.json()) as { display_name?: string | null; bio?: string | null };
        expect(meProfile.display_name).toBe(profileDisplayName);
        expect(meProfile.bio).toBe(profileBio);

        const anthropicResponse = await page.request.post(
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
        if (!anthropicResponse.ok()) {
          throw new Error(`personal_access_request_failed:${anthropicResponse.status()}:${await anthropicResponse.text()}`);
        }
        await expect(anthropicResponse.text()).resolves.toContain(runtime.expectedReplyText);
        await expect(page.getByTestId('use-guide__status-context')).toContainText('project entries are ready');
        await captureSelfServiceTrace('verify-personal-access-ready');
        outcome = 'pass';
      } finally {
        await trace.finish({ outcome });
      }
    } finally {
      await upstream.stop();
    }
  });
});
