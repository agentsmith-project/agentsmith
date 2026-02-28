import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from '@playwright/test';

async function keycloakLogin(page: import('@playwright/test').Page, locale: string, username: string, password: string) {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('login__keycloak-btn').click();

  const keycloakError = page.getByTestId('login__keycloak-error');
  if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
    throw new Error(`Keycloak login bootstrap failed: ${await keycloakError.textContent()}`);
  }

  await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
    timeout: 30_000,
  });
  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
  await page.locator('input#password, input[name="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 60_000 }),
    page.locator('#kc-login, button[type="submit"]').first().click(),
  ]);
  await page.getByTestId('workspace-select__card--ws_default').click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 30_000 });
}

async function getToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('agentsmith-auth');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
      return parsed.state?.token ?? null;
    } catch {
      return null;
    }
  });
  if (!token) {
    throw new Error('missing_auth_token');
  }
  return token;
}

type UpstreamMode = 'ok' | 'retryable_once_then_ok';

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

    try {
      await keycloakLogin(page, locale, username, password);
      const token = await getToken(page);
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

      const providerCreate = async (payload: Record<string, unknown>) => {
        const res = await page.request.post(
          `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/runtime/providers`,
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

      const quotaRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/quota/summary`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(quotaRes.ok()).toBeTruthy();

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
        note: 'Collected from @lane-real integration runtime proxy billing workflow.',
      });
    } finally {
      await new Promise<void>((resolve) => directUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => comboPrimaryUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => comboBackupUpstream.server.close(() => resolve()));
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
