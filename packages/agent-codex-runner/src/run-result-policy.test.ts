import { describe, expect, it } from 'vitest';
import { resolveRunnerSuccessPolicy } from './run-result-policy.js';

describe('resolveRunnerSuccessPolicy', () => {
  it('accepts successful runs that produced visible output', () => {
    expect(resolveRunnerSuccessPolicy({
      visibleAgentChars: 12,
      artifactCount: 0,
      commandCount: 0,
    })).toEqual({ ok: true });
  });

  it('rejects successful runs that produced no visible output', () => {
    expect(resolveRunnerSuccessPolicy({
      visibleAgentChars: 0,
      artifactCount: 2,
      commandCount: 0,
    })).toEqual({
      ok: false,
      errorCode: 'AGENT_EMPTY_OUTPUT',
      errorMessage: 'agent_completed_without_visible_output',
    });
  });
});
