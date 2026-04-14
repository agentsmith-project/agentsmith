"use client";

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function normalizeRecoveryCount(
  options: {
    count: number;
    recoveryCount?: number;
    hasRecovery?: boolean;
  },
): number {
  const count = Math.max(0, options.count);
  if (typeof options.recoveryCount === "number" && Number.isFinite(options.recoveryCount)) {
    return Math.min(count, Math.max(0, options.recoveryCount));
  }
  return options.hasRecovery ? count : 0;
}

export function getTerminalSessionSummaryLabel(
  t: Translate,
  options: {
    count: number;
    recoveryCount?: number;
    hasRecovery?: boolean;
  },
): string {
  const recoveryCount = normalizeRecoveryCount(options);
  if (recoveryCount <= 0) {
    return t("terminal_status_strip_active", { count: options.count });
  }
  if (recoveryCount >= options.count) {
    return t("terminal_status_strip_recovery", { count: options.count });
  }
  return t("terminal_status_strip_mixed", {
    count: options.count,
    recoveryCount,
  });
}
