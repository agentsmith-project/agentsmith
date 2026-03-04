import http, { type Server } from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

function b64url(buffer: Buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function keycloakLogin(page: Page, baseUrl: string, locale: string, username: string, password: string) {
  const keycloakBase = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
  const realm = process.env.KEYCLOAK_REALM ?? 'mbos';
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(24));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = `${baseUrl.replace(/\/+$/, '')}/${locale}/login/callback`;
  const authUrl = new URL(`${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/auth`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const usernameInput = page.locator('input#username, input[name="username"], input[name="email"]').first();
  const passwordInput = page.locator('input#password, input[name="password"]').first();
  const submitButton = page.locator('#kc-login, button[type="submit"]').first();
  const callbackUrlPattern = new RegExp(`/${locale}/login/callback\\?`);
  const deadline = Date.now() + 30_000;
  let authState: 'callback' | 'login_form' | null = null;
  while (Date.now() < deadline) {
    if (callbackUrlPattern.test(page.url())) {
      authState = 'callback';
      break;
    }
    if (await usernameInput.isVisible().catch(() => false)) {
      authState = 'login_form';
      break;
    }
    await page.waitForTimeout(250);
  }

  if (authState === 'login_form') {
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await Promise.all([
      page.waitForURL(callbackUrlPattern, { timeout: 120_000 }),
      submitButton.click(),
    ]);
  } else if (authState !== 'callback') {
    throw new Error(`auth_state_unresolved current_url=${page.url()}`);
  }

  const callbackUrl = new URL(page.url());
  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    throw new Error('auth_code_missing');
  }

  const tokenResponse = await fetch(`${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    throw new Error(`auth_code_exchange_failed_http_${tokenResponse.status}`);
  }
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
  const accessToken = tokenPayload.access_token?.trim();
  if (!accessToken) {
    throw new Error('auth_code_exchange_missing_access_token');
  }
  return accessToken;
}

type UpstreamMode = 'ok' | 'retryable_once_then_ok';

type WebhookCapture = {
  attempt: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type RuntimeReleaseEvidence = {
  source: 'artifact';
  generated_at: string;
  guardrails: {
    target: string;
    release_readiness: 'ready' | 'blocked';
    blockers: string[];
    warnings: string[];
    planned_attempts: number;
  };
  pricing_version_coverage: {
    total_usage_facts: number;
    covered_usage_facts: number;
    missing_usage_facts: number;
    missing_price_facts: number;
    coverage_ratio: number;
  };
  release_candidate?: {
    route_type: 'alias' | 'combo';
    route_key: string;
    release_status: 'draft' | 'published' | 'archived';
    rollout_mode?: 'full' | 'canary';
    canary_percent?: number | null;
    approvals_complete: boolean;
    published_at?: string | null;
  };
  note?: string;
};

type UsageReportEvidence = {
  source: 'artifact';
  generated_at: string;
  release_readiness: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
  active_schedules: number;
  required_schedules: number;
  successful_deliveries_last_7d: number;
  failed_deliveries_last_7d: number;
  unacknowledged_required_deliveries: number;
  runner_health?: {
    enabled: boolean;
    last_status: 'idle' | 'success' | 'failed';
  };
  note?: string;
};

async function startOpenAICompatibleUpstream(mode: UpstreamMode): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      requestCount += 1;
      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      if (mode === 'retryable_once_then_ok' && requestCount === 1) {
        res.statusCode = 429;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'rate_limited' } }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: `chatcmpl_it_${requestCount}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
          },
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    getRequestCount: () => requestCount,
  };
}

async function startUsageReportWebhookTarget(): Promise<{
  server: Server;
  url: string;
  captures: () => WebhookCapture[];
}> {
  const received: WebhookCapture[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString('utf-8');
      const attempt = received.length + 1;
      received.push({
        attempt,
        headers: req.headers,
        body,
      });
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', `webhook-${attempt}`);
      if (attempt === 1) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'temporary_unavailable' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, attempt }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}/usage-report-hook`,
    captures: () => received.slice(),
  };
}

test.describe('@lane-real integration runtime proxy billing', () => {
  test('covers direct/alias/combo routing and usage-cost endpoints', async ({ page }) => {
    test.setTimeout(180_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE || 'http://localhost:20010';

    const directUpstream = await startOpenAICompatibleUpstream('ok');
    const comboPrimaryUpstream = await startOpenAICompatibleUpstream('retryable_once_then_ok');
    const comboBackupUpstream = await startOpenAICompatibleUpstream('ok');
    const usageWebhookTarget = await startUsageReportWebhookTarget();

    try {
      const token = await keycloakLogin(
        page,
        process.env.BASE_URL ?? 'http://localhost:3001',
        locale,
        username,
        password,
      );
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const createProjectRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects`,
        {
          headers,
          data: {
            name: `it-runtime-${Date.now()}`,
            visibility: 'private',
            join_policy: 'approval_required',
          },
        },
      );
      expect(createProjectRes.ok()).toBeTruthy();
      const project = (await createProjectRes.json()) as { id: string };
      const projectId = project.id;

      const createCredential = async (name: string, value: string) => {
        const res = await page.request.post(
          `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
          { headers, data: { name, type: 'api_key', value } },
        );
        expect(res.ok()).toBeTruthy();
        return (await res.json()) as { id: string };
      };

      const directCred = await createCredential('it-runtime-direct-key', 'sk-it-direct');
      const primaryCred = await createCredential('it-runtime-primary-key', 'sk-it-primary');
      const backupCred = await createCredential('it-runtime-backup-key', 'sk-it-backup');
      const usageWebhookCred = await createCredential('it-usage-webhook-secret', 'whsec-it-usage');

      const providerCreate = async (payload: Record<string, unknown>) => {
        const res = await page.request.post(
          `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/providers`,
          { headers, data: payload },
        );
        expect(res.status()).toBe(201);
      };

      const modelCreate = async (payload: Record<string, unknown>) => {
        const res = await page.request.post(
          `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/models`,
          { headers, data: payload },
        );
        expect(res.status()).toBe(201);
      };

      await providerCreate({
        provider: 'openai',
        auth_mode: 'api_key',
        base_url: directUpstream.baseUrl,
        credential_ref: directCred.id,
      });
      await providerCreate({
        provider: 'primaryfail',
        auth_mode: 'api_key',
        base_url: comboPrimaryUpstream.baseUrl,
        credential_ref: primaryCred.id,
      });
      await providerCreate({
        provider: 'secondaryok',
        auth_mode: 'api_key',
        base_url: comboBackupUpstream.baseUrl,
        credential_ref: backupCred.id,
      });

      await modelCreate({
        provider: 'openai',
        model_id: 'gpt-4o',
        capabilities: ['chat'],
      });
      await modelCreate({
        provider: 'primaryfail',
        model_id: 'model-a',
        capabilities: ['chat'],
      });
      await modelCreate({
        provider: 'secondaryok',
        model_id: 'model-b',
        capabilities: ['chat'],
      });

      const pricingRes = await page.request.patch(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/pricing`,
        {
          headers,
          data: {
            openai: {
              'gpt-4o': {
                input: 2,
                output: 10,
              },
            },
            primaryfail: {
              'model-a': {
                input: 3,
                output: 12,
              },
            },
            secondaryok: {
              'model-b': {
                input: 4,
                output: 14,
              },
            },
          },
        },
      );
      expect(pricingRes.ok()).toBeTruthy();

      const aliasRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/routing/aliases`,
        {
          headers,
          data: {
            alias: 'assistant-main',
            target_provider: 'openai',
            target_model: 'gpt-4o',
          },
        },
      );
      expect(aliasRes.status()).toBe(201);

      const comboRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/routing/combos`,
        {
          headers,
          data: {
            name: 'prod-chat',
            targets: [
              { provider: 'primaryfail', model: 'model-a' },
              { provider: 'secondaryok', model: 'model-b' },
            ],
            fallback_policy: {
              max_hops: 1,
              retryable_error_classes: ['provider_retryable'],
            },
          },
        },
      );
      expect(comboRes.status()).toBe(201);

      const publishComboRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/routing/combos/prod-chat/publish`,
        {
          headers,
          data: {
            approval_checklist: {
              owner_verified: true,
              observability_verified: true,
              rollback_verified: true,
            },
            rollout_policy: {
              mode: 'full',
            },
          },
        },
      );
      expect(publishComboRes.ok()).toBeTruthy();

      const publishedComboRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/routing/combos/prod-chat`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(publishedComboRes.ok()).toBeTruthy();
      const publishedCombo = (await publishedComboRes.json()) as {
        release?: {
          status?: 'draft' | 'published' | 'archived';
          rollout_policy?: { mode?: 'full' | 'canary'; canary_percent?: number };
          approval_checklist?: {
            owner_verified?: boolean;
            observability_verified?: boolean;
            rollback_verified?: boolean;
          };
          published_at?: string;
        };
      };

      const unifiedChat = async (model: string) => page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/llm/chat/completions`,
        {
          headers,
          data: {
            model,
            messages: [{ role: 'user', content: 'hello' }],
          },
        },
      );

      const directChatRes = await unifiedChat('openai/gpt-4o');
      expect(directChatRes.status()).toBe(200);
      const directPayload = (await directChatRes.json()) as {
        runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number };
      };
      expect(directPayload.runtime?.provider).toBe('openai');
      expect(directPayload.runtime?.resolved_model).toBe('gpt-4o');
      expect(directPayload.runtime?.fallback_hops).toBe(0);

      const aliasChatRes = await unifiedChat('assistant-main');
      expect(aliasChatRes.status()).toBe(200);
      const aliasPayload = (await aliasChatRes.json()) as {
        runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number };
      };
      expect(aliasPayload.runtime?.provider).toBe('openai');
      expect(aliasPayload.runtime?.resolved_model).toBe('gpt-4o');
      expect(aliasPayload.runtime?.fallback_hops).toBe(0);

      const comboChatRes = await unifiedChat('combo:prod-chat');
      expect(comboChatRes.status()).toBe(200);
      const comboPayload = (await comboChatRes.json()) as {
        runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number };
      };
      expect(comboPayload.runtime?.provider).toBe('secondaryok');
      expect(comboPayload.runtime?.resolved_model).toBe('model-b');
      expect(comboPayload.runtime?.fallback_hops).toBe(1);

      expect(directUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
      expect(comboPrimaryUpstream.getRequestCount()).toBe(1);
      expect(comboBackupUpstream.getRequestCount()).toBe(1);

      const end = new Date();
      const start = new Date(end.getTime() - 10 * 60 * 1000);

      const usageRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            resource_type: 'endpoint',
            page: '1',
            page_size: '50',
          },
        },
      );
      expect(usageRes.ok()).toBeTruthy();
      const usagePayload = (await usageRes.json()) as { total?: number };
      expect((usagePayload.total ?? 0) > 0).toBe(true);

      const usageFactsRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/facts`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            resource_type: 'endpoint',
            page: '1',
            page_size: '200',
          },
        },
      );
      expect(usageFactsRes.ok()).toBeTruthy();
      const usageFactsPayload = (await usageFactsRes.json()) as {
        items?: Array<{
          runtime?: {
            pricing_version?: string | null;
            missing_price?: boolean;
          };
        }>;
      };

      const timeseriesRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/timeseries`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            granularity: 'day',
            metric: 'cost',
            resource_type: 'endpoint',
          },
        },
      );
      expect(timeseriesRes.ok()).toBeTruthy();
      const timeseriesPayload = (await timeseriesRes.json()) as {
        total_cost?: number;
        data_points?: Array<{ estimated_cost?: number }>;
      };
      expect((timeseriesPayload.data_points ?? []).length).toBeGreaterThan(0);
      expect(timeseriesPayload.total_cost ?? 0).toBeGreaterThan(0);

      const runtimeObsRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/runtime-observability`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            start_time: start.toISOString(),
            end_time: end.toISOString(),
          },
        },
      );
      expect(runtimeObsRes.ok()).toBeTruthy();
      const runtimeObsPayload = (await runtimeObsRes.json()) as {
        total_requests?: number;
        total_errors?: number;
        error_rate?: number;
        fallback_hops_histogram?: Record<string, number>;
        error_class_counts?: {
          provider_retryable?: number;
          provider_non_retryable?: number;
          system_error?: number;
        };
      };
      expect(runtimeObsPayload.total_requests ?? 0).toBeGreaterThan(0);
      expect(runtimeObsPayload.total_errors ?? 0).toBeGreaterThanOrEqual(0);
      expect(runtimeObsPayload.error_rate ?? 0).toBeGreaterThanOrEqual(0);
      expect(runtimeObsPayload.error_rate ?? 0).toBeLessThanOrEqual(1);
      expect((runtimeObsPayload.fallback_hops_histogram ?? {})['0'] ?? 0).toBeGreaterThanOrEqual(0);
      expect(runtimeObsPayload.error_class_counts?.provider_retryable ?? 0).toBeGreaterThanOrEqual(0);
      expect(runtimeObsPayload.error_class_counts?.provider_non_retryable ?? 0).toBeGreaterThanOrEqual(0);
      expect(runtimeObsPayload.error_class_counts?.system_error ?? 0).toBeGreaterThanOrEqual(0);

      const limitsRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/limits/summary`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(limitsRes.ok()).toBeTruthy();

      const createScheduleRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-schedules`,
        {
          headers,
          data: {
            name: 'Release Evidence Digest',
            cadence: 'daily',
            status: 'active',
            format: 'json',
            time_window: 'last_7d',
            delivery_channel: 'in_app',
            release_evidence_required: true,
            empty_result_policy: 'deliver',
            filters: {
              provider: 'secondaryok',
            },
          },
        },
      );
      expect(createScheduleRes.status()).toBe(201);
      const schedule = (await createScheduleRes.json()) as { id: string };

      const runScheduleRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-schedules/${schedule.id}/run-now`,
        { headers },
      );
      expect(runScheduleRes.ok()).toBeTruthy();
      const runSchedulePayload = (await runScheduleRes.json()) as { delivery_id?: string; status?: 'success' | 'failed' };
      expect(runSchedulePayload.status).toBe('success');
      expect(typeof runSchedulePayload.delivery_id).toBe('string');

      const acknowledgeRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-schedules/${schedule.id}/deliveries/${runSchedulePayload.delivery_id}/acknowledge`,
        { headers },
      );
      expect(acknowledgeRes.ok()).toBeTruthy();

      const runnerSweepRes = await page.request.post(
        `${apiBase}/api/v1/internal/usage-report-runner/run-due`,
        { headers },
      );
      expect(runnerSweepRes.ok()).toBeTruthy();

      const createWebhookScheduleRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-schedules`,
        {
          headers,
          data: {
            name: 'Webhook Delivery Audit',
            cadence: 'daily',
            status: 'active',
            format: 'json',
            time_window: 'last_7d',
            delivery_channel: 'webhook',
            delivery_config: {
              webhook_url: usageWebhookTarget.url,
              credential_ref: usageWebhookCred.id,
              secret_header_name: 'x-webhook-secret',
              signature_header_name: 'x-agentsmith-signature',
              timeout_seconds: 5,
              retry_attempts: 2,
              retry_backoff_ms: 100,
            },
            release_evidence_required: false,
            empty_result_policy: 'deliver',
            filters: {
              provider: 'secondaryok',
            },
          },
        },
      );
      expect(createWebhookScheduleRes.status()).toBe(201);
      const webhookSchedule = (await createWebhookScheduleRes.json()) as { id: string };

      const runWebhookScheduleRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-schedules/${webhookSchedule.id}/run-now`,
        { headers },
      );
      expect(runWebhookScheduleRes.ok()).toBeTruthy();
      const runWebhookSchedulePayload = (await runWebhookScheduleRes.json()) as {
        delivery_id?: string;
        status?: 'success' | 'failed';
        delivery_metadata?: Record<string, unknown>;
      };
      expect(runWebhookSchedulePayload.status).toBe('success');
      expect(runWebhookSchedulePayload.delivery_metadata).toEqual(expect.objectContaining({
        dispatch_mode: 'webhook',
        webhook_target_host: expect.stringContaining('127.0.0.1'),
        response_status: 200,
        attempt: 2,
      }));

      const webhookCaptures = usageWebhookTarget.captures();
      expect(webhookCaptures).toHaveLength(2);
      expect(webhookCaptures[0]?.headers['x-agentsmith-report-attempt']).toBe('1');
      expect(webhookCaptures[1]?.headers['x-agentsmith-report-attempt']).toBe('2');
      expect(webhookCaptures[1]?.headers['x-webhook-secret']).toBe('whsec-it-usage');
      expect(String(webhookCaptures[1]?.headers['x-agentsmith-signature'] ?? '')).toContain('sha256=');

      const listSchedulesRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-schedules`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(listSchedulesRes.ok()).toBeTruthy();
      const listedSchedules = (await listSchedulesRes.json()) as { items?: Array<{
        id: string;
        recent_deliveries?: Array<{ id: string; delivery_metadata?: Record<string, unknown> }>;
      }> };
      const webhookListed = listedSchedules.items?.find((item) => item.id === webhookSchedule.id);
      expect(webhookListed?.recent_deliveries?.[0]?.delivery_metadata).toEqual(expect.objectContaining({
        response_status: 200,
        response_body_snippet: '{"ok":true,"attempt":2}',
        response_headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-request-id': 'webhook-2',
        }),
      }));

      const usageReportEvidenceRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/usage/report-evidence`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(usageReportEvidenceRes.ok()).toBeTruthy();
      const usageReportEvidence = (await usageReportEvidenceRes.json()) as UsageReportEvidence;
      expect(usageReportEvidence.release_readiness).toBe('ready');
      expect(usageReportEvidence.unacknowledged_required_deliveries).toBe(0);
      expect(usageReportEvidence.runner_health).toBeDefined();

      const dryRunRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/routing/dry-run`,
        {
          headers,
          data: {
            model: 'combo:prod-chat',
          },
        },
      );
      expect(dryRunRes.ok()).toBeTruthy();
      const dryRunPayload = (await dryRunRes.json()) as {
        attempts?: Array<unknown>;
        guardrails?: {
          release_readiness?: 'ready' | 'blocked';
          blockers?: string[];
          warnings?: string[];
        };
      };

      maybeWriteRuntimeReleaseEvidence(process.env.RUNTIME_RELEASE_EVIDENCE_PATH, {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        guardrails: {
          target: 'combo:prod-chat',
          release_readiness: dryRunPayload.guardrails?.release_readiness ?? 'blocked',
          blockers: Array.isArray(dryRunPayload.guardrails?.blockers) ? dryRunPayload.guardrails.blockers : [],
          warnings: Array.isArray(dryRunPayload.guardrails?.warnings) ? dryRunPayload.guardrails.warnings : [],
          planned_attempts: Array.isArray(dryRunPayload.attempts) ? dryRunPayload.attempts.length : 0,
        },
        pricing_version_coverage: buildPricingCoverage(usageFactsPayload.items ?? []),
        release_candidate: {
          route_type: 'combo',
          route_key: 'prod-chat',
          release_status: publishedCombo.release?.status ?? 'draft',
          rollout_mode: publishedCombo.release?.rollout_policy?.mode,
          canary_percent: publishedCombo.release?.rollout_policy?.canary_percent ?? null,
          approvals_complete: publishedCombo.release?.approval_checklist?.owner_verified === true
            && publishedCombo.release?.approval_checklist?.observability_verified === true
            && publishedCombo.release?.approval_checklist?.rollback_verified === true,
          published_at: publishedCombo.release?.published_at ?? null,
        },
        note: 'Collected from @lane-real integration runtime proxy billing workflow.',
      });
      maybeWriteUsageReportEvidence(process.env.USAGE_REPORT_EVIDENCE_PATH, {
        ...usageReportEvidence,
        note: 'Collected from @lane-real integration runtime proxy billing workflow.',
      });
    } finally {
      await new Promise<void>((resolve) => directUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => comboPrimaryUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => comboBackupUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => usageWebhookTarget.server.close(() => resolve()));
    }
  });
});

function buildPricingCoverage(items: Array<{ runtime?: { pricing_version?: string | null; missing_price?: boolean } }>) {
  const totalUsageFacts = items.length;
  const coveredUsageFacts = items.filter((item) => typeof item.runtime?.pricing_version === 'string' && item.runtime.pricing_version.length > 0).length;
  const missingPriceFacts = items.filter((item) => item.runtime?.missing_price === true).length;
  const missingUsageFacts = Math.max(totalUsageFacts - coveredUsageFacts, 0);

  return {
    total_usage_facts: totalUsageFacts,
    covered_usage_facts: coveredUsageFacts,
    missing_usage_facts: missingUsageFacts,
    missing_price_facts: missingPriceFacts,
    coverage_ratio: totalUsageFacts > 0 ? coveredUsageFacts / totalUsageFacts : 0,
  };
}

function maybeWriteRuntimeReleaseEvidence(pathValue: string | undefined, evidence: RuntimeReleaseEvidence) {
  if (!pathValue) return;
  mkdirSync(dirname(pathValue), { recursive: true });
  writeFileSync(pathValue, JSON.stringify(evidence, null, 2), 'utf-8');
}

function maybeWriteUsageReportEvidence(pathValue: string | undefined, evidence: UsageReportEvidence) {
  if (!pathValue) return;
  mkdirSync(dirname(pathValue), { recursive: true });
  writeFileSync(pathValue, JSON.stringify(evidence, null, 2), 'utf-8');
}
