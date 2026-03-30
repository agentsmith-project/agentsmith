import { describe, expect, it } from 'vitest';
import {
  evaluateNotebookExecutionSnapshot,
  summarizeNotebookMessages,
  summarizeNotebookPod,
  summarizeNotebookTraces,
} from '../../../../e2e/notebook-execution-outcome';

describe('evaluateNotebookExecutionSnapshot', () => {
  it('accepts assistant token success', () => {
    const result = evaluateNotebookExecutionSnapshot({
      token: 'TOKEN_OK',
      messages: [{ role: 'agent', content: 'done TOKEN_OK report.md' }],
      traces: [],
      minAgentMessages: 1,
    });
    expect(result.success).toBe(true);
    expect(result.failure).toBe(false);
  });

  it('accepts artifact fallback success', () => {
    const result = evaluateNotebookExecutionSnapshot({
      token: 'TOKEN_OK',
      messages: [],
      traces: [],
      artifactContent: 'artifact contains TOKEN_OK',
    });
    expect(result.success).toBe(true);
    expect(result.artifactHasToken).toBe(true);
  });

  it('fails fast on terminal trace failure', () => {
    const result = evaluateNotebookExecutionSnapshot({
      token: 'TOKEN_OK',
      messages: [],
      traces: [
        {
          category: 'error',
          status: 'error',
          name: 'execution.terminal',
          summary: 'execution terminal synthesized: AGENT_UPSTREAM_ERROR',
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.failure).toBe(true);
    expect(result.reason).toBe('terminal_trace_failure');
  });

  it('fails when a seen workload pod exits without success', () => {
    const result = evaluateNotebookExecutionSnapshot({
      token: 'TOKEN_OK',
      messages: [],
      traces: [],
      task: { run_state: 'running' },
      podSeenBefore: true,
      pod: { name: 'pod-1', phase: 'Failed', exitCode: 143 },
    });
    expect(result.failure).toBe(true);
    expect(result.reason).toBe('workload_pod_exited_without_success_signal');
  });

  it('fails when the task goes idle after a seen pod without success signals', () => {
    const result = evaluateNotebookExecutionSnapshot({
      token: 'TOKEN_OK',
      messages: [{ role: 'user', content: 'run it' }],
      traces: [{ category: 'progress', status: 'running', name: 'codex.command', summary: 'running command' }],
      task: { run_state: 'idle' },
      podSeenBefore: true,
      pod: null,
    });
    expect(result.failure).toBe(true);
    expect(result.reason).toBe('task_idle_without_success_signal');
  });
});

describe('notebook outcome summaries', () => {
  it('summarizes recent messages, traces, and pod state', () => {
    expect(summarizeNotebookMessages([{ role: 'agent', content: 'hello world' }])).toEqual(['agent: hello world']);
    expect(
      summarizeNotebookTraces([{ category: 'progress', status: 'running', name: 'codex.command', summary: 'running tests' }]),
    ).toEqual(['progress/running codex.command: running tests']);
    expect(summarizeNotebookPod({ name: 'pod-1', phase: 'Failed', reason: 'Error', exitCode: 143 })).toBe(
      'pod=pod-1 phase=Failed reason=Error exit_code=143',
    );
  });
});
