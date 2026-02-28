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
  recipientUserId?: string;
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
    recipientUserId,
  }: UsageReportDeliveryDispatchArgs): Promise<UsageReportDeliveryDispatchResult> => {
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
