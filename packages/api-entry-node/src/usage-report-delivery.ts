import { appendUserNotification } from './me-notifications-store.js';
import type {
  UsageReportScheduleDeliveryChannel,
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
    error_class: 'delivery_channel' | 'system_error';
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

function buildNotificationTitle(
  channel: UsageReportScheduleDeliveryChannel,
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

export function createUsageReportDeliveryDispatcher(): UsageReportDeliveryDispatcher {
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
          error_class: 'delivery_channel',
        };
      }
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': reportContentType,
            'x-agentsmith-report-schedule-id': schedule.id,
            'x-agentsmith-report-delivery-id': result.delivery_id,
            'x-agentsmith-report-trigger': trigger,
          },
          body: reportBody,
        });
        if (!response.ok) {
          return {
            ok: false,
            error: `usage_report_webhook_http_${response.status}`,
            error_class: 'delivery_channel',
            delivery_metadata: {
              dispatch_mode: 'webhook',
              webhook_url: webhookUrl,
              response_status: response.status,
            },
          };
        }
        return {
          ok: true,
          delivery_metadata: {
            dispatch_mode: 'webhook',
            webhook_url: webhookUrl,
            response_status: response.status,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'usage_report_webhook_request_failed',
          error_class: 'delivery_channel',
          delivery_metadata: {
            dispatch_mode: 'webhook',
            webhook_url: webhookUrl,
          },
        };
      }
    }

    if (schedule.delivery_channel !== 'in_app') {
      return {
        ok: false,
        error: `usage_report_delivery_channel_unsupported:${schedule.delivery_channel}`,
        error_class: 'delivery_channel',
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
