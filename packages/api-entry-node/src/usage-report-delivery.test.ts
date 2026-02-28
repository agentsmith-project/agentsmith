import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createUsageReportDeliveryDispatcher } from './usage-report-delivery.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

function startWebhookServer(statusCode = 200): Promise<{
  url: string;
  getRequest: () => { body: string; headers: http.IncomingHttpHeaders };
}> {
  let lastBody = '';
  let lastHeaders: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      lastBody = Buffer.concat(chunks).toString('utf-8');
      lastHeaders = req.headers;
      res.statusCode = statusCode;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: statusCode >= 200 && statusCode < 300 }));
    })();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/hook`,
        getRequest: () => ({ body: lastBody, headers: lastHeaders }),
      });
    });
  });
}

describe('usage-report-delivery', () => {
  it('dispatches webhook payload successfully', async () => {
    const hook = await startWebhookServer(200);
    const dispatch = createUsageReportDeliveryDispatcher();

    const result = await dispatch({
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
        delivery_config: { webhook_url: hook.url },
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
    });

    expect(result.ok).toBe(true);
    expect(result.delivery_metadata).toEqual(
      expect.objectContaining({
        dispatch_mode: 'webhook',
        response_status: 200,
      }),
    );
    expect(hook.getRequest().body).toBe('{"ok":true}');
    expect(hook.getRequest().headers['x-agentsmith-report-trigger']).toBe('manual');
  });

  it('returns delivery_channel failure on webhook http error', async () => {
    const hook = await startWebhookServer(503);
    const dispatch = createUsageReportDeliveryDispatcher();

    const result = await dispatch({
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
        delivery_config: { webhook_url: hook.url },
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
      trigger: 'scheduled',
      reportBody: '{"ok":true}',
      reportContentType: 'application/json; charset=utf-8',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error_class: 'delivery_channel',
      }),
    );
  });
});
