export interface RunnerSuccessPolicyInput {
  visibleAgentChars: number;
  artifactCount: number;
  commandCount: number;
}

export interface RunnerSuccessPolicyResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export function resolveRunnerSuccessPolicy(input: RunnerSuccessPolicyInput): RunnerSuccessPolicyResult {
  if (input.visibleAgentChars > 0) {
    return { ok: true };
  }
  return {
    ok: false,
    errorCode: 'AGENT_EMPTY_OUTPUT',
    errorMessage: 'agent_completed_without_visible_output',
  };
}
