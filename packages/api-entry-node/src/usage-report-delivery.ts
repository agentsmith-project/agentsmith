import { createHmac } from 'node:crypto';
import { appendUserNotification } from './me-notifications-store.js';
import type {
  UsageReportDeliveryErrorClass,
  UsageReportScheduleDeliveryResult,
  UsageReportScheduleRecord,
} from './audit-usage-store.js';

export type UsageReportDeliveryDispatchResult =
  | {
    ok: true;
    delivery_metadata?: Record<string, unknown>;
  }
  | {
    ok: false;
    error: string;
    error_class: UsageReportDeliveryErrorClass;
    delivery_metadata?: Record<string, unknown>;
  };

export type UsageReportDeliveryDispatchArgs = {
  workspaceId: string;
  projectId: string;
  schedule: UsageReportScheduleRecord;
  result: UsageReportScheduleDeliveryResult;
  trigger: 'scheduled' | 'manual' | 'retry' | 'test';
  recipientUserId?: string;
  reportBody: string;
  reportContentType: string;
};

export type UsageReportDeliveryDispatcher = (
  args: UsageReportDeliveryDispatchArgs,
) => Promise<UsageReportDeliveryDispatchResult>;

export type UsageReportDeliveryDispatcherOptions = {
  getCredentialSecret?: (
    workspaceId: string,
    projectId: string,
    credentialId: string,
  ) => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

function buildNotificationTitle(
  channel: UsageReportScheduleRecord['delivery_channel'],
  result: UsageReportScheduleDeliveryResult,
): string {
  if (channel === 'in_app') {
    return result.status === 'success' ? 'Usage report delivered' : 'Usage report delivery failed';
  }
  return 'Usage report delivery';
}

function buildNotificationBody(
  result: UsageReportScheduleDeliveryResult,
): string {
  return result.status === 'success'
    ? `Generated ${result.preview_filename}`
    : result.error ?? 'Usage report delivery failed';
}

function classifyWebhookHttpError(status: number): UsageReportDeliveryErrorClass {
  if (status === 401 || status === 403) return 'delivery_channel_auth';
  if (status >= 500) return 'delivery_channel_5xx';
  return 'delivery_channel_4xx';
}

function normalizeTimeoutSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(120, Math.floor(value ?? 10)));
}

function normalizeRetryAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.floor(value ?? 1)));
}

function normalizeRetryBackoffMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return 250;
  return Math.max(100, Math.min(5_000, Math.floor(value ?? 250)));
}

function shouldRetryDelivery(errorClass: UsageReportDeliveryErrorClass): boolean {
  return errorClass === 'delivery_channel_timeout'
    || errorClass === 'delivery_channel_network'
    || errorClass === 'delivery_channel_5xx';
}

function summarizeWebhookTarget(webhookUrl: string): Record<string, string> {
  try {
    const parsed = new URL(webhookUrl);
    return {
      webhook_target_protocol: parsed.protocol.replace(/:$/, ''),
      webhook_target_host: parsed.host,
      webhook_target_path: parsed.pathname || '/',
    };
  } catch {
    return {
      webhook_target_host: webhookUrl,
    };
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeResponseSnippet(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/("?(?:token|access_token|api_key|secret|password)"?\s*:\s*")([^"]+)"/gi, '$1[redacted]"')
    .replace(/(sk-[A-Za-z0-9_-]+)/g, '[redacted]')
    .replace(/(whsec-[A-Za-z0-9_-]+)/g, '[redacted]');
}

function pickResponseHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const key of ['content-type', 'x-request-id', 'x-trace-id', 'retry-after']) {
    const value = headers.get(key);
    if (value) captured[key] = value;
  }
  return captured;
}

async function readResponseSnippet(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return sanitizeResponseSnippet(trimmed).slice(0, 280);
  } catch {
    return undefined;
  }
}

export function createUsageReportDeliveryDispatcher(
  options?: UsageReportDeliveryDispatcherOptions,
): UsageReportDeliveryDispatcher {
  const fetchImpl = options?.fetchImpl ?? fetch;
  return async ({
    workspaceId,
    projectId,
    schedule,
    result,
    trigger,
    recipientUserId,
    reportBody,
    reportContentType,
  }: UsageReportDeliveryDispatchArgs): Promise<UsageReportDeliveryDispatchResult> => {
    if (schedule.delivery_channel === 'webhook') {
      const webhookUrl = schedule.delivery_config?.webhook_url?.trim();
      if (!webhookUrl) {
        return {
          ok: false,
          error: 'usage_report_webhook_url_missing',
          error_class: 'delivery_channel_4xx',
        };
      }
      const credentialRef = schedule.delivery_config?.credential_ref?.trim();
      const secretHeaderName = schedule.delivery_config?.secret_header_name?.trim();
      const signatureHeaderName = schedule.delivery_config?.signature_header_name?.trim();
      const timeoutSeconds = normalizeTimeoutSeconds(schedule.delivery_config?.timeout_seconds);
      const retryAttempts = normalizeRetryAttempts(schedule.delivery_config?.retry_attempts);
      const retryBackoffMs = normalizeRetryBackoffMs(schedule.delivery_config?.retry_backoff_ms);
      const deliveryMetadata: Record<string, unknown> = {
        dispatch_mode: 'webhook',
        timeout_seconds: timeoutSeconds,
        retry_attempts: retryAttempts,
        retry_backoff_ms: retryBackoffMs,
        ...summarizeWebhookTarget(webhookUrl),
      };
      let credentialSecret: string | null = null;
      if (credentialRef) {
        if (!secretHeaderName && !signatureHeaderName) {
          return {
            ok: false,
            error: 'usage_report_webhook_credential_binding_missing',
            error_class: 'delivery_channel_auth',
            delivery_metadata: {
              ...deliveryMetadata,
              credential_ref: credentialRef,
            },
          };
        }
        credentialSecret = await options?.getCredentialSecret?.(workspaceId, projectId, credentialRef) ?? null;
        if (!credentialSecret) {
          return {
            ok: false,
            error: 'usage_report_webhook_credential_missing',
            error_class: 'delivery_channel_auth',
            delivery_metadata: {
              ...deliveryMetadata,
              credential_ref: credentialRef,
              secret_header_name: secretHeaderName,
              signature_header_name: signatureHeaderName,
            },
          };
        }
        deliveryMetadata.credential_ref = credentialRef;
        if (secretHeaderName) deliveryMetadata.secret_header_name = secretHeaderName;
        if (signatureHeaderName) {
          deliveryMetadata.signature_mode = 'hmac_sha256';
          deliveryMetadata.signature_header_name = signatureHeaderName;
          deliveryMetadata.signature_timestamp_header_name = 'x-agentsmith-signature-timestamp';
        }
      }
      let lastFailure: UsageReportDeliveryDispatchResult | null = null;
      for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
        const headers: Record<string, string> = {
          'content-type': reportContentType,
          'x-agentsmith-report-schedule-id': schedule.id,
          'x-agentsmith-report-delivery-id': result.delivery_id,
          'x-agentsmith-report-trigger': trigger,
          'x-agentsmith-report-attempt': String(attempt),
        };
        if (credentialSecret && secretHeaderName) {
          headers[secretHeaderName] = credentialSecret;
        }
        if (credentialSecret && signatureHeaderName) {
          const timestamp = new Date().toISOString();
          const signatureBase = `${timestamp}.${reportBody}`;
          const signature = createHmac('sha256', credentialSecret).update(signatureBase).digest('hex');
          headers[signatureHeaderName] = `sha256=${signature}`;
          headers['x-agentsmith-signature-timestamp'] = timestamp;
        }
        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutSeconds * 1_000);
        const startedAt = Date.now();
        try {
          const response = await fetchImpl(webhookUrl, {
            method: 'POST',
            headers,
            body: reportBody,
            signal: abortController.signal,
          });
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const responseHeaders = pickResponseHeaders(response.headers);
          const responseSnippet = await readResponseSnippet(response.clone());
          if (!response.ok) {
            lastFailure = {
              ok: false,
              error: `usage_report_webhook_http_${response.status}`,
              error_class: classifyWebhookHttpError(response.status),
              delivery_metadata: {
                ...deliveryMetadata,
                response_status: response.status,
                attempt,
                duration_ms: durationMs,
                response_headers: responseHeaders,
                response_body_snippet: responseSnippet,
              },
            };
          } else {
            return {
              ok: true,
              delivery_metadata: {
                ...deliveryMetadata,
                response_status: response.status,
                attempt,
                duration_ms: durationMs,
                response_headers: responseHeaders,
                response_body_snippet: responseSnippet,
              },
            };
          }
        } catch (error) {
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          if (error instanceof Error && error.name === 'AbortError') {
            lastFailure = {
              ok: false,
              error: 'usage_report_webhook_timeout',
              error_class: 'delivery_channel_timeout',
              delivery_metadata: {
                ...deliveryMetadata,
                attempt,
                duration_ms: durationMs,
              },
            };
          } else {
            lastFailure = {
              ok: false,
              error: error instanceof Error ? error.message : 'usage_report_webhook_request_failed',
              error_class: 'delivery_channel_network',
              delivery_metadata: {
                ...deliveryMetadata,
                attempt,
                duration_ms: durationMs,
              },
            };
          };
        }
        if (!lastFailure || attempt >= retryAttempts || !shouldRetryDelivery(lastFailure.error_class)) {
          break;
        }
        await sleep(retryBackoffMs * attempt);
      }
      return lastFailure ?? {
        ok: false,
        error: 'usage_report_webhook_request_failed',
        error_class: 'system_error',
        delivery_metadata: deliveryMetadata,
      };
    }

    if (schedule.delivery_channel !== 'in_app') {
      return {
        ok: false,
        error: `usage_report_delivery_channel_unsupported:${schedule.delivery_channel}`,
        error_class: 'system_error',
      };
    }

    if (!recipientUserId) {
      return {
        ok: true,
        delivery_metadata: {
          dispatch_mode: 'stored_only',
        },
      };
    }

    const notification = appendUserNotification(recipientUserId, {
      type: result.status === 'success' ? 'usage_report_delivery' : 'usage_report_delivery_failed',
      title: buildNotificationTitle(schedule.delivery_channel, result),
      body: buildNotificationBody(result),
      link_url: `/workspaces/${workspaceId}/projects/${projectId}/usage`,
    });

    return {
      ok: true,
      delivery_metadata: {
        dispatch_mode: 'user_notification',
        notification_id: notification.id,
      },
    };
  };
}
