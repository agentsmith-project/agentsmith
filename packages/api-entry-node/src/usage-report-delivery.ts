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
      const timeoutSeconds = normalizeTimeoutSeconds(schedule.delivery_config?.timeout_seconds);
      const deliveryMetadata: Record<string, unknown> = {
        dispatch_mode: 'webhook',
        webhook_url: webhookUrl,
        timeout_seconds: timeoutSeconds,
      };
      const headers: Record<string, string> = {
        'content-type': reportContentType,
        'x-agentsmith-report-schedule-id': schedule.id,
        'x-agentsmith-report-delivery-id': result.delivery_id,
        'x-agentsmith-report-trigger': trigger,
      };
      if (credentialRef) {
        if (!secretHeaderName) {
          return {
            ok: false,
            error: 'usage_report_webhook_secret_header_missing',
            error_class: 'delivery_channel_auth',
            delivery_metadata: {
              ...deliveryMetadata,
              credential_ref: credentialRef,
            },
          };
        }
        const secret = await options?.getCredentialSecret?.(workspaceId, projectId, credentialRef);
        if (!secret) {
          return {
            ok: false,
            error: 'usage_report_webhook_credential_missing',
            error_class: 'delivery_channel_auth',
            delivery_metadata: {
              ...deliveryMetadata,
              credential_ref: credentialRef,
              secret_header_name: secretHeaderName,
            },
          };
        }
        headers[secretHeaderName] = secret;
        deliveryMetadata.credential_ref = credentialRef;
        deliveryMetadata.secret_header_name = secretHeaderName;
      }
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutSeconds * 1_000);
      try {
        const response = await fetchImpl(webhookUrl, {
          method: 'POST',
          headers,
          body: reportBody,
          signal: abortController.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          return {
            ok: false,
            error: `usage_report_webhook_http_${response.status}`,
            error_class: classifyWebhookHttpError(response.status),
            delivery_metadata: {
              ...deliveryMetadata,
              response_status: response.status,
            },
          };
        }
        return {
          ok: true,
          delivery_metadata: {
            ...deliveryMetadata,
            response_status: response.status,
          },
        };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof Error && error.name === 'AbortError') {
          return {
            ok: false,
            error: 'usage_report_webhook_timeout',
            error_class: 'delivery_channel_timeout',
            delivery_metadata: deliveryMetadata,
          };
        }
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'usage_report_webhook_request_failed',
          error_class: 'delivery_channel_network',
          delivery_metadata: deliveryMetadata,
        };
      }
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
