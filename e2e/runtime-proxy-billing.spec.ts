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
      const runtimeObservability = await get(
        `/usage/runtime-observability?start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}`,
      );
      const limitsSummary = await get('/limits/summary');

      return { direct, alias, combo, usageTimeseries, runtimeObservability, limitsSummary };
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
    expect(result.runtimeObservability.status).toBe(200);
    const runtimeObs = result.runtimeObservability.body as {
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
    expect(runtimeObs.total_requests ?? 0).toBeGreaterThan(0);
    expect(runtimeObs.total_errors ?? 0).toBeGreaterThanOrEqual(0);
    expect(runtimeObs.error_rate ?? 0).toBeGreaterThanOrEqual(0);
    expect(runtimeObs.error_rate ?? 0).toBeLessThanOrEqual(1);
    expect((runtimeObs.fallback_hops_histogram ?? {})['0'] ?? 0).toBeGreaterThanOrEqual(0);
    expect(runtimeObs.error_class_counts?.provider_retryable ?? 0).toBeGreaterThanOrEqual(0);
    expect(runtimeObs.error_class_counts?.provider_non_retryable ?? 0).toBeGreaterThanOrEqual(0);
    expect(runtimeObs.error_class_counts?.system_error ?? 0).toBeGreaterThanOrEqual(0);
    expect(result.limitsSummary.status).toBe(200);
  });

  test('supports runtime release workflow from planning to usage detail', async ({ authedPage }) => {
    const suffix = `${Date.now()}`;
    const comboName = `prod-chat-${suffix}`;
    await goToProject(authedPage, 'runtime-control-plane');
    await expect(authedPage.getByTestId('settings-runtime__panel')).toBeVisible({ timeout: 10000 });

    await authedPage.getByTestId('settings-runtime__provider-name').fill('openai');
    await authedPage.getByTestId('settings-runtime__provider-base-url').fill('https://api.openai.com/v1');
    await authedPage.getByTestId('settings-runtime__provider-credential-ref').fill('cred_openai');
    await authedPage.getByTestId('settings-runtime__provider-create').click();

    await authedPage.getByTestId('settings-runtime__provider-name').fill('primaryfail');
    await authedPage.getByTestId('settings-runtime__provider-base-url').fill('https://retryable.mock/v1');
    await authedPage.getByTestId('settings-runtime__provider-credential-ref').fill('cred_primary');
    await authedPage.getByTestId('settings-runtime__provider-create').click();

    await authedPage.getByTestId('settings-runtime__provider-name').fill('secondaryok');
    await authedPage.getByTestId('settings-runtime__provider-base-url').fill('https://ok2.mock/v1');
    await authedPage.getByTestId('settings-runtime__provider-credential-ref').fill('cred_secondary');
    await authedPage.getByTestId('settings-runtime__provider-create').click();

    await authedPage.getByTestId('settings-runtime__model-provider').fill('openai');
    await authedPage.getByTestId('settings-runtime__model-id').fill('gpt-4o');
    await authedPage.getByTestId('settings-runtime__model-capabilities').fill('chat');
    await authedPage.getByTestId('settings-runtime__model-create').click();

    await authedPage.getByTestId('settings-runtime__model-provider').fill('primaryfail');
    await authedPage.getByTestId('settings-runtime__model-id').fill('model-a');
    await authedPage.getByTestId('settings-runtime__model-capabilities').fill('chat');
    await authedPage.getByTestId('settings-runtime__model-create').click();

    await authedPage.getByTestId('settings-runtime__model-provider').fill('secondaryok');
    await authedPage.getByTestId('settings-runtime__model-id').fill('model-b');
    await authedPage.getByTestId('settings-runtime__model-capabilities').fill('chat');
    await authedPage.getByTestId('settings-runtime__model-create').click();

    await authedPage.getByTestId('settings-runtime__pricing-json').fill(JSON.stringify({
      openai: { 'gpt-4o': { input: 2, output: 10 } },
      primaryfail: { 'model-a': { input: 3, output: 12 } },
      secondaryok: { 'model-b': { input: 2, output: 8 } },
    }, null, 2));
    await authedPage.getByTestId('settings-runtime__pricing-save').click();

    await authedPage.getByTestId('settings-runtime__combo-json').fill(JSON.stringify({
      name: comboName,
      targets: [
        { provider: 'primaryfail', model: 'model-a' },
        { provider: 'secondaryok', model: 'model-b' },
      ],
      fallback_policy: {
        max_hops: 1,
        retryable_error_classes: ['provider_retryable'],
      },
    }, null, 2));
    await authedPage.getByTestId('settings-runtime__combo-create').click();

    await authedPage.getByTestId('settings-runtime__dry-run-model').fill(`combo:${comboName}`);
    await authedPage.getByTestId('settings-runtime__dry-run-run').click();
    await expect(authedPage.getByTestId('settings-runtime__dry-run-attempt-0')).toBeVisible();
    await expect(authedPage.getByTestId('settings-runtime__dry-run-attempt-1')).toBeVisible();
    await expect(authedPage.getByTestId('settings-runtime__dry-run-guardrails')).toContainText(/Ready/i);

    await authedPage.getByTestId('settings-runtime__compare-baseline').fill('openai/gpt-4o');
    await authedPage.getByTestId('settings-runtime__compare-candidate').fill(`combo:${comboName}`);
    await authedPage.getByTestId('settings-runtime__compare-run').click();
    await expect(authedPage.getByTestId('settings-runtime__compare-baseline-card')).toBeVisible();
    await expect(authedPage.getByTestId('settings-runtime__compare-candidate-card')).toBeVisible();
    await expect(authedPage.getByTestId('settings-runtime__compare-delta')).toContainText('$');

    await authedPage.getByTestId('settings-runtime__probe-model').fill(`combo:${comboName}`);
    await authedPage.getByTestId('settings-runtime__probe-prompt').fill('Summarize the recovery path.');
    await authedPage.getByTestId('settings-runtime__probe-run').click();
    await expect(authedPage.getByTestId('settings-runtime__probe-status')).toContainText(/Recovered/i);
    await expect(authedPage.getByTestId('settings-runtime__probe-attempt-0')).toBeVisible();
    await expect(authedPage.getByTestId('settings-runtime__probe-attempt-1')).toBeVisible();

    await goToProject(authedPage, 'usage');
    const firstRow = authedPage.locator('[data-testid="usage__table__row"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.scrollIntoViewIfNeeded();
    await firstRow.dispatchEvent('click');

    await expect(authedPage.getByTestId('usage__detail-summary__cost')).toBeVisible();
    await expect(authedPage.getByTestId('usage__detail-summary__recovered')).toBeVisible();
    await expect(authedPage.locator('[data-testid^="usage__detail-fact-"]').first()).toBeVisible();
    await expect(authedPage.locator('[data-testid^="usage__detail-timeline-"]').first()).toBeVisible();
  });
});
