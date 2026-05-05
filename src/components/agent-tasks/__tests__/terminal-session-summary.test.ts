import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { getTerminalSessionSummaryLabel } from '../terminal-session-summary';
import enUsMessages from '@/messages/en-US.json';

function t(key: string, values?: Record<string, string | number>) {
  if (key === 'terminal_status_strip_active') {
    const count = Number(values?.count ?? 0);
    return count === 1
      ? '1 terminal session is using this task'
      : `${count} terminal sessions are using this task`;
  }
  if (key === 'terminal_status_strip_recovery') {
    const count = Number(values?.count ?? 0);
    return count === 1
      ? '1 terminal session on this task needs recovery'
      : `${count} terminal sessions on this task need recovery`;
  }
  if (key === 'terminal_status_strip_mixed') {
    const count = Number(values?.count ?? 0);
    const recoveryCount = Number(values?.recoveryCount ?? 0);
    return `${count} terminal sessions are using this task, ${recoveryCount} ${recoveryCount === 1 ? 'needs' : 'need'} recovery`;
  }
  return key;
}

describe('getTerminalSessionSummaryLabel', () => {
  it('keeps active occupancy wording when no session needs recovery', () => {
    expect(
      getTerminalSessionSummaryLabel(t, {
        count: 2,
        recoveryCount: 0,
      }),
    ).toBe('2 terminal sessions are using this task');
  });

  it('keeps recovery-only wording when every session needs recovery', () => {
    expect(
      getTerminalSessionSummaryLabel(t, {
        count: 2,
        recoveryCount: 2,
      }),
    ).toBe('2 terminal sessions on this task need recovery');
  });

  it('uses mixed occupancy wording when active and recovery sessions coexist', () => {
    expect(
      getTerminalSessionSummaryLabel(t, {
        count: 2,
        recoveryCount: 1,
      }),
    ).toBe('2 terminal sessions are using this task, 1 needs recovery');
  });

  it('keeps the real en-US mixed summary grammar aligned with the recovery count', () => {
    const formatter = new IntlMessageFormat(
      enUsMessages.agent_tasks.task.terminal_status_strip_mixed,
      'en-US',
    );

    expect(
      formatter.format({
        count: 3,
        recoveryCount: 1,
      }),
    ).toBe('3 terminal sessions are using this task, 1 needs recovery');
    expect(
      formatter.format({
        count: 3,
        recoveryCount: 2,
      }),
    ).toBe('3 terminal sessions are using this task, 2 need recovery');
  });
});
