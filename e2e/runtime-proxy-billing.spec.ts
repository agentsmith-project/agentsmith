import { test, expect, goToProject, WS_ID, PROJECT_ID } from './fixtures/test-base';

test.describe('runtime proxy billing (mock lane)', () => {
  test('supports direct alias combo and usage metrics in browser flow', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const result = await authedPage.evaluate(async ({ wsId, projectId }) => {
      const base = `/api/v1/workspaces/${wsId}/projects/${projectId}`;
      const parseBody = (text: string) => {
        if (!text) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      };
      const post = async (path: string, payload: unknown) => {
        const res = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        return {
          status: res.status,
          body: parseBody(text),
        };
      };
      const patch = async (path: string, payload: unknown) => {
        const res = await fetch(`${base}${path}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        return {
          status: res.status,
          body: parseBody(text),
        };
      };
      const get = async (path: string) => {
        const res = await fetch(`${base}${path}`, { method: 'GET' });
        const text = await res.text();
        return {
          status: res.status,
          body: parseBody(text),
        };
      };

      await post('/runtime/providers', {
        provider: 'openai',
        auth_mode: 'api_key',
        base_url: 'https://ok.mock/v1',
        credential_ref: 'cred_direct',
      });
      await post('/runtime/providers', {
        provider: 'primaryfail',
        auth_mode: 'api_key',
        base_url: 'https://retryable.mock/v1',
        credential_ref: 'cred_primary',
      });
      await post('/runtime/providers', {
        provider: 'secondaryok',
        auth_mode: 'api_key',
        base_url: 'https://ok2.mock/v1',
        credential_ref: 'cred_backup',
      });

      await patch('/runtime/pricing', {
        openai: {
          'gpt-4o': { input: 2, output: 10 },
        },
      });

      await post('/runtime/routing/aliases', {
        alias: 'assistant-main',
        target_provider: 'openai',
        target_model: 'gpt-4o',
      });
      await post('/runtime/routing/combos', {
        name: 'prod-chat',
        targets: [
          { provider: 'primaryfail', model: 'model-a' },
          { provider: 'secondaryok', model: 'model-b' },
        ],
        fallback_policy: {
          max_hops: 1,
          retryable_error_classes: ['provider_retryable'],
        },
      });

      const direct = await post('/llm/chat/completions', {
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const alias = await post('/llm/chat/completions', {
        model: 'assistant-main',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const combo = await post('/llm/chat/completions', {
        model: 'combo:prod-chat',
        messages: [{ role: 'user', content: 'hello' }],
      });

      const end = new Date();
      const start = new Date(end.getTime() - 10 * 60 * 1000);
      const usageTimeseries = await get(
        `/usage/timeseries?start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}&granularity=day&metric=cost&resource_type=endpoint`,
      );
      const quotaSummary = await get('/quota/summary');

      return { direct, alias, combo, usageTimeseries, quotaSummary };
    }, { wsId: WS_ID, projectId: PROJECT_ID });

    expect(result.direct.status).toBe(200);
    expect((result.direct.body as { runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number } }).runtime?.provider).toBe('openai');
    expect((result.direct.body as { runtime?: { resolved_model?: string } }).runtime?.resolved_model).toBe('gpt-4o');
    expect((result.direct.body as { runtime?: { fallback_hops?: number } }).runtime?.fallback_hops).toBe(0);

    expect(result.alias.status).toBe(200);
    expect((result.alias.body as { runtime?: { provider?: string; resolved_model?: string } }).runtime?.provider).toBe('openai');
    expect((result.alias.body as { runtime?: { resolved_model?: string } }).runtime?.resolved_model).toBe('gpt-4o');

    expect(result.combo.status).toBe(200);
    expect((result.combo.body as { runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number } }).runtime?.provider).toBe('secondaryok');
    expect((result.combo.body as { runtime?: { resolved_model?: string } }).runtime?.resolved_model).toBe('model-b');
    expect((result.combo.body as { runtime?: { fallback_hops?: number } }).runtime?.fallback_hops).toBe(1);

    expect(result.usageTimeseries.status).toBe(200);
    expect(result.quotaSummary.status).toBe(200);
  });
});
