import { describe, expect, it } from 'vitest';
import {
  CHAT_RUNNER_SPEC,
  NOTEBOOK_RUNNER_SPEC,
  isMatchingRunnerSpec,
} from './runner-spec.js';

describe('runner specs', () => {
  it('defines stable notebook and chat runner specs', () => {
    expect(NOTEBOOK_RUNNER_SPEC).toMatchObject({
      interaction_kind: 'notebook',
      app_family: 'codex_runner',
      context_model: 'cli_session',
      workspace_policy: 'persistent_task_workspace',
      supports_terminal: true,
    });
    expect(CHAT_RUNNER_SPEC).toMatchObject({
      interaction_kind: 'chat',
      app_family: 'llm_runner',
      context_model: 'explicit_dialogue',
      workspace_policy: 'ephemeral_session_dir',
      supports_terminal: false,
    });
  });

  it('matches only fully formed specs of the expected interaction kind', () => {
    expect(isMatchingRunnerSpec('chat', CHAT_RUNNER_SPEC)).toBe(true);
    expect(isMatchingRunnerSpec('notebook', NOTEBOOK_RUNNER_SPEC)).toBe(true);
    expect(isMatchingRunnerSpec('chat', NOTEBOOK_RUNNER_SPEC)).toBe(false);
    expect(isMatchingRunnerSpec('notebook', CHAT_RUNNER_SPEC)).toBe(false);
    expect(isMatchingRunnerSpec('chat', { interaction_kind: 'chat' })).toBe(false);
    expect(isMatchingRunnerSpec('notebook', {
      ...NOTEBOOK_RUNNER_SPEC,
      supports_terminal: false,
    })).toBe(false);
  });
});
