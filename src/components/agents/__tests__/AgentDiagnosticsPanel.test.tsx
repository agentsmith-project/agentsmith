import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AgentDiagnosticsPanel } from '../AgentDiagnosticsPanel';

const messages = {
  agents: {
    detail_diagnostics: 'Diagnostics',
    detail_diagnostics_empty: 'No diagnostics available.',
    diagnostics_backoff: 'Backing off',
    diagnostics_last_error_at: 'Last error recorded at {value}',
    diagnostics_runner_spec_mismatch_title: 'Runner app does not match this agent',
    diagnostics_runner_spec_mismatch_description:
      'Reconnect the matching chat or notebook runner app for this agent before retrying.',
    diagnostics_queue_depth: 'Queue Depth',
    diagnostics_restarts: 'Restarts',
    diagnostics_cpu_percent: 'CPU',
    diagnostics_memory_mb: 'Memory',
    diagnostics_raw_error: 'Raw error',
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

describe('AgentDiagnosticsPanel', () => {
  it('renders empty state when diagnostics are unavailable', () => {
    render(<AgentDiagnosticsPanel diagnostics={null} />);

    expect(screen.getByText('No diagnostics available.')).toBeInTheDocument();
  });

  it('renders a friendly runner spec mismatch explanation and raw diagnostics details', () => {
    render(
      <AgentDiagnosticsPanel
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

    expect(screen.getByText('Runner app does not match this agent')).toBeInTheDocument();
    expect(
      screen.getByText('Reconnect the matching chat or notebook runner app for this agent before retrying.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Raw error')).toBeInTheDocument();
    expect(screen.getByText('agent_runner_spec_mismatch')).toBeInTheDocument();
    expect(screen.getByText('Last error recorded at 2026-04-09T17:18:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('Backing off: 30s')).toBeInTheDocument();
    expect(screen.getByText('Queue Depth: 2')).toBeInTheDocument();
    expect(screen.getByText('Restarts: 1')).toBeInTheDocument();
    expect(screen.getByText('CPU: 11%')).toBeInTheDocument();
    expect(screen.getByText('Memory: 256 MB')).toBeInTheDocument();
  });
});
