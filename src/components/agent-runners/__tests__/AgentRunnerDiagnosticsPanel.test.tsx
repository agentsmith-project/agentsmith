import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AgentRunnerDiagnosticsPanel } from '../AgentRunnerDiagnosticsPanel';

const messages = {
  agent_runners: {
    detail_diagnostics: 'Diagnostics',
    detail_diagnostics_empty: 'No diagnostics available.',
    diagnostics_backoff: 'Backing off',
    diagnostics_last_error_at: 'Last error recorded at {value}',
    diagnostics_status_label: 'Operational status',
    diagnostics_connection_issue_title: 'Connection needs attention',
    diagnostics_connection_issue_description: 'Check the runner connection, then retry the connection check.',
    diagnostics_access_issue_title: 'Action is not currently allowed',
    diagnostics_access_issue_description: 'Review access for this Developer runner before retrying.',
    diagnostics_general_issue_title: 'Diagnostics need attention',
    diagnostics_general_issue_description: 'Review the runner setup, then retry the check.',
    diagnostics_runner_spec_mismatch_title: 'Runner app does not match this configuration',
    diagnostics_runner_spec_mismatch_description:
      'Reconnect a matching task runner before retrying.',
    diagnostics_queue_depth: 'Queue Depth',
    diagnostics_restarts: 'Restarts',
    diagnostics_cpu_percent: 'CPU',
    diagnostics_memory_mb: 'Memory',
  },
};

function resolveTranslation(path: string, values?: Record<string, string | number>) {
  const keys = path.split('.');
  let current: unknown = messages;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) return path;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== 'string') return path;
  return Object.entries(values ?? {}).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    current,
  );
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string | number>) =>
    resolveTranslation(`${namespace}.${key}`, values),
}));

describe('AgentRunnerDiagnosticsPanel', () => {
  it('renders empty state when diagnostics are unavailable', () => {
    render(<AgentRunnerDiagnosticsPanel diagnostics={null} />);

    expect(screen.getByText('No diagnostics available.')).toBeInTheDocument();
  });

  it('renders a friendly runner spec mismatch explanation and operational details', () => {
    render(
      <AgentRunnerDiagnosticsPanel
        diagnostics={{
          last_error: 'agent_runner_spec_mismatch',
          last_error_at: '2026-04-09T17:18:00.000Z',
          retry_backoff_sec: 30,
          queue_depth: 2,
          restarts: 1,
          cpu_percent: 11,
          memory_mb: 256,
        }}
      />,
    );

    expect(screen.getByText('Runner app does not match this configuration')).toBeInTheDocument();
    expect(
      screen.getByText('Reconnect a matching task runner before retrying.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Operational status')).toBeInTheDocument();
    expect(screen.queryByText('Raw error')).not.toBeInTheDocument();
    expect(screen.queryByText('agent_runner_spec_mismatch')).not.toBeInTheDocument();
    expect(screen.getByText('Last error recorded at 2026-04-09T17:18:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('Backing off: 30s')).toBeInTheDocument();
    expect(screen.getByText('Queue Depth: 2')).toBeInTheDocument();
    expect(screen.getByText('Restarts: 1')).toBeInTheDocument();
    expect(screen.getByText('CPU: 11%')).toBeInTheDocument();
    expect(screen.getByText('Memory: 256 MB')).toBeInTheDocument();
  });

  it('maps implementation-shaped diagnostics codes to safe operational copy', () => {
    render(
      <AgentRunnerDiagnosticsPanel
        diagnostics={{
          last_error: 'agent_runner_runtime_unavailable',
          last_error_at: '2026-04-09T17:18:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Connection needs attention')).toBeInTheDocument();
    expect(screen.getByText('Check the runner connection, then retry the connection check.')).toBeInTheDocument();
    expect(screen.queryByText('agent_runner_runtime_unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw error')).not.toBeInTheDocument();
  });
});
