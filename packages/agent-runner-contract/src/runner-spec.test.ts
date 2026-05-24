import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AGENT_TASK_RUNNER_SPEC,
  isAgentTaskRunnerSpec,
} from './runner-spec.js';

describe('agent task runner spec', () => {
  it('defines the stable task-only runner spec without workload discriminants', () => {
    expect(AGENT_TASK_RUNNER_SPEC).toEqual({
      app_family: 'agent_task_runner',
      protocol_version: '1.0',
      context_model: 'task',
      workspace_policy: 'persistent_task_workspace',
      supports_terminal: true,
    });
    expect(AGENT_TASK_RUNNER_SPEC).not.toHaveProperty('interaction_kind');
  });

  it('matches only the fully formed task runner spec', () => {
    expect(isAgentTaskRunnerSpec(AGENT_TASK_RUNNER_SPEC)).toBe(true);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, supports_terminal: false })).toBe(false);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, context_model: 'notebook' })).toBe(false);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, interaction_kind: 'notebook' })).toBe(false);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, workload: 'chat' })).toBe(false);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, workload: 'notebook' })).toBe(false);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, chat: true })).toBe(false);
    expect(isAgentTaskRunnerSpec({ ...AGENT_TASK_RUNNER_SPEC, notebook: true })).toBe(false);
    expect(isAgentTaskRunnerSpec({ app_family: 'agent_task_runner' })).toBe(false);
    expect(isAgentTaskRunnerSpec(null)).toBe(false);
  });

  it('does not publish legacy runner spec matching aliases', () => {
    const runnerSpecSource = readFileSync(
      path.join(process.cwd(), 'packages/agent-runner-contract/src/runner-spec.ts'),
      'utf8',
    );

    expect(runnerSpecSource).not.toContain('isMatchingRunnerSpec');
    expect(runnerSpecSource).not.toContain('CHAT_RUNNER_SPEC');
    expect(runnerSpecSource).not.toContain('NOTEBOOK_RUNNER_SPEC');
  });
});
