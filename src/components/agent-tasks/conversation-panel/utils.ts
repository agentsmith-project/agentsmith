import { classifyAgentTaskRealtimeFailure } from '@/lib/build-failure-explainability';

export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain === 0 ? `${minutes}m` : `${minutes}m ${remain}s`;
}

export function getConnectionBannerCopy(args: {
  t: (key: string) => string;
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  connectionErrorCode?: string | null;
  connectionErrorMessage?: string | null;
}) {
  const { t, connectionStatus, connectionErrorCode } = args;
  const connectionFailureKind = connectionStatus
    ? classifyAgentTaskRealtimeFailure(connectionStatus, connectionErrorCode)
    : null;

  const title = connectionFailureKind === 'connecting'
    ? t('realtime_status_connecting_title')
    : connectionFailureKind === 'reconnecting'
      ? t('realtime_status_reconnecting_title')
      : connectionFailureKind === 'disconnected'
        ? t('realtime_status_disconnected_title')
        : connectionFailureKind === 'ticket_unavailable'
          ? t('realtime_status_ticket_unavailable_title')
          : connectionFailureKind === 'ticket_unauthorized'
            ? t('realtime_status_ticket_unauthorized_title')
            : connectionFailureKind === 'ticket_rate_limited'
              ? t('realtime_status_ticket_rate_limited_title')
              : connectionFailureKind === 'stream_unavailable'
                ? t('realtime_status_stream_unavailable_title')
                : connectionFailureKind === 'stream_interrupted'
                  ? t('realtime_status_stream_interrupted_title')
                  : connectionFailureKind === 'stream_recovery_exhausted'
                    ? t('realtime_status_stream_recovery_exhausted_title')
                    : connectionFailureKind === 'ticket_network'
                      ? t('realtime_status_ticket_network_title')
                      : connectionFailureKind === 'reconcile_failed'
                        ? t('realtime_status_reconcile_failed_title')
                        : connectionFailureKind === 'error'
                          ? t('realtime_status_error_title')
                          : null;

  const description = connectionFailureKind === 'connecting'
    ? t('realtime_status_connecting_description')
    : connectionFailureKind === 'reconnecting'
      ? t('realtime_status_reconnecting_description')
      : connectionFailureKind === 'disconnected'
        ? t('realtime_status_disconnected_description')
        : connectionFailureKind === 'ticket_unavailable'
          ? t('realtime_status_ticket_unavailable_description')
          : connectionFailureKind === 'ticket_unauthorized'
            ? t('realtime_status_ticket_unauthorized_description')
            : connectionFailureKind === 'ticket_rate_limited'
              ? t('realtime_status_ticket_rate_limited_description')
              : connectionFailureKind === 'stream_unavailable'
                ? t('realtime_status_stream_unavailable_description')
                : connectionFailureKind === 'stream_interrupted'
                  ? t('realtime_status_stream_interrupted_description')
                  : connectionFailureKind === 'stream_recovery_exhausted'
                    ? t('realtime_status_stream_recovery_exhausted_description')
                    : connectionFailureKind === 'ticket_network'
                      ? t('realtime_status_ticket_network_description')
                      : connectionFailureKind === 'reconcile_failed'
                        ? t('realtime_status_reconcile_failed_description')
                        : connectionFailureKind === 'error'
                          ? t('realtime_status_error_description')
                          : null;

  return {
    connectionFailureKind,
    title,
    description,
  };
}
