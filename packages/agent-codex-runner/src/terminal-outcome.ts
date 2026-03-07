export type CodexTerminalOutcomeInput = {
  cancelRequested: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
};

export type CodexTerminalOutcome = {
  finalStatus: 'success' | 'error' | 'cancelled';
  codexTraceStatus: 'success' | 'error' | 'cancelled';
  errorCode: 'AGENT_CANCELLED' | 'AGENT_UPSTREAM_ERROR' | null;
  errorMessage: string | null;
};

export function resolveCodexTerminalOutcome(input: CodexTerminalOutcomeInput): CodexTerminalOutcome {
  const { cancelRequested, code, signal } = input;
  if (cancelRequested) {
    return {
      finalStatus: 'cancelled',
      codexTraceStatus: 'cancelled',
      errorCode: 'AGENT_CANCELLED',
      errorMessage: signal ? `codex_terminated_${signal}` : 'codex_cancelled_by_request',
    };
  }
  if (code === 0) {
    return {
      finalStatus: 'success',
      codexTraceStatus: 'success',
      errorCode: null,
      errorMessage: null,
    };
  }
  if (signal) {
    return {
      finalStatus: 'cancelled',
      codexTraceStatus: 'cancelled',
      errorCode: 'AGENT_CANCELLED',
      errorMessage: `codex_terminated_${signal}`,
    };
  }
  return {
    finalStatus: 'error',
    codexTraceStatus: 'error',
    errorCode: 'AGENT_UPSTREAM_ERROR',
    errorMessage: `codex_exit_code_${String(code ?? 'unknown')}`,
  };
}
