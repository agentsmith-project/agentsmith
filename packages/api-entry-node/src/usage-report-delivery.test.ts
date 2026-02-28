import { describe, expect, it, vi } from 'vitest';
import { createUsageReportDeliveryDispatcher } from './usage-report-delivery.js';
import type { UsageReportDeliveryDispatchArgs } from './usage-report-delivery.js';

function buildDispatchArgs(
  overrides?: Partial<UsageReportDeliveryDispatchArgs>,
): UsageReportDeliveryDispatchArgs {
  return {
    workspaceId: 'ws_1',
    projectId: 'proj_1',
    schedule: {
      id: 'usage_schedule_1',
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      name: 'Webhook Schedule',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'webhook',
      delivery_config: { webhook_url: 'https://example.internal/hook', timeout_seconds: 10 },
      release_evidence_required: false,
      empty_result_policy: 'deliver',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      next_run_at: '2026-03-02T00:00:00.000Z',
    },
    result: {
      delivery_id: 'delivery_1',
      schedule_id: 'usage_schedule_1',
      delivery_channel: 'webhook',
      generated_at: '2026-03-01T00:00:00.000Z',
      preview_filename: 'usage-report.json',
      content_type: 'application/json; charset=utf-8',
      status: 'success',
      summary: { requests: 4, errors: 0 },
    },
    trigger: 'manual',
    reportBody: '{"ok":true}',
    reportContentType: 'application/json; charset=utf-8',
    ...overrides,
  };
}

describe('usage-report-delivery', () => {
  it('dispatches webhook payload successfully with credential header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const getCredentialSecret = vi.fn().mockResolvedValue('secret_token');
    const dispatch = createUsageReportDeliveryDispatcher({
      fetchImpl,
      getCredentialSecret,
    });

    const result = await dispatch(buildDispatchArgs({
      schedule: {
        ...buildDispatchArgs().schedule,
        delivery_config: {
          webhook_url: 'https://example.internal/hook',
          credential_ref: 'cred_webhook',
          secret_header_name: 'x-webhook-secret',
          signature_header_name: 'x-webhook-signature',
          timeout_seconds: 15,
          retry_attempts: 2,
          retry_backoff_ms: 300,
        },
      },
    }));

    expect(result.ok).toBe(true);
    expect(getCredentialSecret).toHaveBeenCalledWith('ws_1', 'proj_1', 'cred_webhook');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(expect.objectContaining({
      'content-type': 'application/json; charset=utf-8',
      'x-agentsmith-report-trigger': 'manual',
      'x-webhook-secret': 'secret_token',
      'x-webhook-signature': expect.stringMatching(/^sha256=/),
      'x-agentsmith-signature-timestamp': expect.any(String),
    }));
    expect(result.delivery_metadata).toEqual(expect.objectContaining({
      dispatch_mode: 'webhook',
      webhook_target_protocol: 'https',
      webhook_target_host: 'example.internal',
      webhook_target_path: '/hook',
      credential_ref: 'cred_webhook',
      secret_header_name: 'x-webhook-secret',
      signature_mode: 'hmac_sha256',
      signature_header_name: 'x-webhook-signature',
      timeout_seconds: 15,
      retry_attempts: 2,
      retry_backoff_ms: 300,
      response_status: 200,
      duration_ms: expect.any(Number),
      response_body_snippet: '{"ok":true}',
      response_headers: expect.objectContaining({
        'content-type': 'application/json',
      }),
    }));
  });

  it('classifies webhook auth failure when credential secret is missing', async () => {
    const dispatch = createUsageReportDeliveryDispatcher({
      getCredentialSecret: vi.fn().mockResolvedValue(null),
      fetchImpl: vi.fn(),
    });

    const result = await dispatch(buildDispatchArgs({
      schedule: {
        ...buildDispatchArgs().schedule,
        delivery_config: {
          webhook_url: 'https://example.internal/hook',
          credential_ref: 'cred_missing',
          secret_header_name: 'x-webhook-secret',
        },
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_class: 'delivery_channel_auth',
      error: 'usage_report_webhook_credential_missing',
    }));
  });

  it('classifies webhook timeout failures', async () => {
    const fetchImpl = vi.fn((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });
    const dispatch = createUsageReportDeliveryDispatcher({ fetchImpl });

    const result = await dispatch(buildDispatchArgs({
      schedule: {
        ...buildDispatchArgs().schedule,
        delivery_config: {
          webhook_url: 'https://example.internal/hook',
          timeout_seconds: 1,
        },
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_class: 'delivery_channel_timeout',
      error: 'usage_report_webhook_timeout',
    }));
  });

  it('retries retryable webhook failures before succeeding', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('fail', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const dispatch = createUsageReportDeliveryDispatcher({ fetchImpl });

    const result = await dispatch(buildDispatchArgs({
      schedule: {
        ...buildDispatchArgs().schedule,
        delivery_config: {
          webhook_url: 'https://example.internal/hook',
          retry_attempts: 2,
          retry_backoff_ms: 100,
        },
      },
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      delivery_metadata: expect.objectContaining({
        attempt: 2,
        retry_attempts: 2,
      }),
    }));
  });

  it('classifies webhook http failures by status family', async () => {
    const cases: Array<{ status: number; errorClass: string }> = [
      { status: 401, errorClass: 'delivery_channel_auth' },
      { status: 422, errorClass: 'delivery_channel_4xx' },
      { status: 503, errorClass: 'delivery_channel_5xx' },
    ];

    for (const testCase of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('fail', { status: testCase.status }));
      const dispatch = createUsageReportDeliveryDispatcher({ fetchImpl });
      const result = await dispatch(buildDispatchArgs());
      expect(result).toEqual(expect.objectContaining({
        ok: false,
        error_class: testCase.errorClass,
        error: `usage_report_webhook_http_${testCase.status}`,
      }));
    }
  });

  it('classifies webhook network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const dispatch = createUsageReportDeliveryDispatcher({ fetchImpl });

    const result = await dispatch(buildDispatchArgs());

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error_class: 'delivery_channel_network',
      error: 'connect ECONNREFUSED',
    }));
  });
});
