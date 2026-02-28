import type { JsonDocStorePort } from '@mbos/ports';
import {
  runDueUsageReportSchedulesAcrossProjects,
  type UsageReportRunnerSweepResult,
} from './audit-usage-store.js';
import { createUsageReportDeliveryDispatcher } from './usage-report-delivery.js';

export type UsageReportRunnerStatus = {
  enabled: boolean;
  interval_ms: number;
  running: boolean;
  run_count: number;
  last_started_at?: string;
  last_completed_at?: string;
  last_status: 'idle' | 'success' | 'failed';
  last_error?: string;
  last_result?: UsageReportRunnerSweepResult;
};

export type UsageReportRunnerOptions = {
  enabled?: boolean;
  intervalMs?: number;
  now?: () => string;
};

export type UsageReportRunnerController = {
  getStatus: () => UsageReportRunnerStatus;
  runOnce: (reason?: 'manual' | 'scheduled') => Promise<UsageReportRunnerSweepResult>;
  stop: () => void;
};

function defaultNow(): string {
  return new Date().toISOString();
}

export function createUsageReportRunner(
  docStore: JsonDocStorePort,
  options?: UsageReportRunnerOptions,
): UsageReportRunnerController {
  const enabled = options?.enabled === true;
  const intervalMs = Math.max(1_000, options?.intervalMs ?? 60_000);
  const now = options?.now ?? defaultNow;

  const status: UsageReportRunnerStatus = {
    enabled,
    interval_ms: intervalMs,
    running: false,
    run_count: 0,
    last_status: 'idle',
  };
  const deliveryDispatch = createUsageReportDeliveryDispatcher();

  const runOnce = async (_reason?: 'manual' | 'scheduled'): Promise<UsageReportRunnerSweepResult> => {
    if (status.running) {
      const error = new Error('usage_report_runner_busy');
      status.last_status = 'failed';
      status.last_error = error.message;
      throw error;
    }
    status.running = true;
    status.last_started_at = now();
    status.last_error = undefined;
    try {
      const result = await runDueUsageReportSchedulesAcrossProjects(docStore, {
        now: status.last_started_at,
        deliveryDispatch,
      });
      status.run_count += 1;
      status.last_completed_at = now();
      status.last_status = 'success';
      status.last_result = result;
      return result;
    } catch (error) {
      status.run_count += 1;
      status.last_completed_at = now();
      status.last_status = 'failed';
      status.last_error = error instanceof Error ? error.message : 'unknown_error';
      throw error;
    } finally {
      status.running = false;
    }
  };

  const timer = enabled
    ? setInterval(() => {
      void runOnce('scheduled').catch(() => {
        // status is already updated in runOnce; keep interval alive.
      });
    }, intervalMs)
    : null;

  return {
    getStatus: () => ({ ...status }),
    runOnce,
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
