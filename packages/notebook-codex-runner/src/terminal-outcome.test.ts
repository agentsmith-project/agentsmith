import { describe, expect, it } from 'vitest';
import { resolveCodexTerminalOutcome } from './terminal-outcome.js';

describe('resolveCodexTerminalOutcome', () => {
  it('returns cancelled when cancel requested even if process exits with code 0', () => {
    const outcome = resolveCodexTerminalOutcome({
      cancelRequested: true,
      code: 0,
      signal: null,
    });
    expect(outcome.finalStatus).toBe('cancelled');
    expect(outcome.codexTraceStatus).toBe('cancelled');
    expect(outcome.errorCode).toBe('AGENT_CANCELLED');
  });

  it('returns success when process exits with code 0 and no cancel requested', () => {
    const outcome = resolveCodexTerminalOutcome({
      cancelRequested: false,
      code: 0,
      signal: null,
    });
    expect(outcome.finalStatus).toBe('success');
    expect(outcome.errorCode).toBeNull();
  });

  it('returns cancelled when process exits by signal without cancel flag', () => {
    const outcome = resolveCodexTerminalOutcome({
      cancelRequested: false,
      code: null,
      signal: 'SIGTERM',
    });
    expect(outcome.finalStatus).toBe('cancelled');
    expect(outcome.errorCode).toBe('AGENT_CANCELLED');
  });

  it('returns error for non-zero exit without signal', () => {
    const outcome = resolveCodexTerminalOutcome({
      cancelRequested: false,
      code: 2,
      signal: null,
    });
    expect(outcome.finalStatus).toBe('error');
    expect(outcome.errorCode).toBe('AGENT_UPSTREAM_ERROR');
  });
});
