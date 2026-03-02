import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';

function toIso(input: Date): string {
  return input.toISOString();
}

export function buildBuildDiagnosticsOpsQuery(now = new Date()): string {
  const end = now;
  const start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
  return buildSharedOpsFilterQuery({
    start_time: toIso(start),
    end_time: toIso(end),
    result: 'error',
  });
}

export function buildAgentDiagnosticsLink(basePath: string, agentId?: string | null): string {
  if (!agentId) {
    return `${basePath}/agents`;
  }
  return `${basePath}/agents?agent=${encodeURIComponent(agentId)}`;
}
