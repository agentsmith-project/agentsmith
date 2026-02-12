import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';

function startOpenAICompatibleTaskUpstream(): Promise<{
  server: Server;
  baseUrl: string;
  getLastPath: () => string;
  getLastBody: () => unknown;
}> {
  let lastPath = '';
  let lastBody: unknown = null;
  const server = http.createServer((req, res) => {
    void (async () => {
      lastPath = req.url ?? '';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      lastBody = text ? JSON.parse(text) : {};

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('/videos/generations/') && req.url?.endsWith('/cancel')) {
        res.end(JSON.stringify({ id: 'job_1', status: 'cancelled' }));
        return;
      }
      if (req.url?.includes('/videos/generations/')) {
        res.end(JSON.stringify({ id: 'job_1', status: 'processing' }));
        return;
      }
      if (req.url?.includes('/videos/generations')) {
        res.end(JSON.stringify({ id: 'job_1', status: 'queued' }));
        return;
      }
      if (req.url?.includes('/images/generations')) {
        res.end(JSON.stringify({ data: [{ url: 'https://example.com/image.png' }] }));
        return;
      }
      if (req.url?.includes('/rerank')) {
        res.end(JSON.stringify({ data: [{ index: 0, score: 0.99 }] }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    })();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        getLastPath: () => lastPath,
        getLastBody: () => lastBody,
      });
    });
  });
}

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
    const raw = window.localStorage.getItem('mbos-auth');
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

test.describe('integration endpoint capabilities', () => {
  test('supports rerank/image/video task routes', async ({ page }) => {
    test.setTimeout(180_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE || 'http://localhost:20010';

    const upstream = await startOpenAICompatibleTaskUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const token = await getToken(page);

      const createProjectRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: `it-endpoint-cap-${Date.now()}`,
            visibility: 'private',
            join_policy: 'approval_required',
          },
        },
      );
      expect(createProjectRes.ok()).toBeTruthy();
      const project = (await createProjectRes.json()) as { id: string };
      const projectId = project.id;

      const credentialRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: 'it-endpoint-key',
            type: 'api_key',
            value: 'sk-it',
          },
        },
      );
      expect(credentialRes.ok()).toBeTruthy();
      const credential = (await credentialRes.json()) as { id: string };

      const endpointRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: 'it-capability-endpoint',
            openai_model: 'deepseek-chat',
            type: 'custom',
            protocol: 'openai_compatible',
            provider_family: 'custom',
            base_url: upstream.baseUrl,
            credential_ref: credential.id,
            capabilities: [
              { type: 'rerank', enabled: true, default_model_id: 'qwen-reranker' },
              { type: 'image_generation', enabled: true, default_model_id: 'gpt-image-1' },
              { type: 'video_generation', enabled: true, default_model_id: 'sora' },
            ],
            models: [
              { capability: 'rerank', model_id: 'qwen-reranker' },
              { capability: 'image_generation', model_id: 'gpt-image-1' },
              { capability: 'video_generation', model_id: 'sora' },
            ],
            defaults: {
              rerank_model_id: 'qwen-reranker',
              image_model_id: 'gpt-image-1',
              video_model_id: 'sora',
            },
          },
        },
      );
      expect(endpointRes.ok()).toBeTruthy();
      const endpoint = (await endpointRes.json()) as { id: string };

      const rerankRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/rerank`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: { query: 'hello', documents: ['a', 'b'] },
        },
      );
      expect(rerankRes.ok()).toBeTruthy();
      expect(upstream.getLastPath()).toContain('/rerank');
      const rerankBody = upstream.getLastBody() as { model?: string };
      expect(rerankBody.model).toBe('qwen-reranker');

      const imageRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/images/generations`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: { prompt: 'blue sky' },
        },
      );
      expect(imageRes.ok()).toBeTruthy();
      expect(upstream.getLastPath()).toContain('/images/generations');
      const imageBody = upstream.getLastBody() as { model?: string };
      expect(imageBody.model).toBe('gpt-image-1');

      const videoCreateRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/videos/generations`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: { prompt: 'city drive' },
        },
      );
      expect(videoCreateRes.ok()).toBeTruthy();
      expect(upstream.getLastPath()).toContain('/videos/generations');

      const videoPollRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/videos/generations/job_1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(videoPollRes.ok()).toBeTruthy();
      expect(upstream.getLastPath()).toContain('/videos/generations/job_1');

      const videoCancelRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/videos/generations/job_1/cancel`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {},
        },
      );
      expect(videoCancelRes.ok()).toBeTruthy();
      expect(upstream.getLastPath()).toContain('/videos/generations/job_1/cancel');
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });
});

