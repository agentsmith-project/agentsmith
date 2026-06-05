import { describe, expect, it } from 'vitest';
import {
  evaluateAgentTaskExecutionSnapshot,
  summarizeAgentTaskActivity,
  summarizeAgentTaskPod,
  summarizeAgentTaskTraces,
} from '../../../../e2e/agent-task-execution-outcome';

describe('evaluateAgentTaskExecutionSnapshot', () => {
  it('accepts runner output token success', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      activity: [{ kind: 'runner_output', actor: 'runner', content: 'done TOKEN_OK report.md' }],
      traces: [],
      minRunnerOutputs: 1,
    });
    expect(result.success).toBe(true);
    expect(result.failure).toBe(false);
  });

  it('accepts artifact fallback success', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      activity: [],
      traces: [],
      artifactContent: 'artifact contains TOKEN_OK',
    });
    expect(result.success).toBe(true);
    expect(result.artifactHasToken).toBe(true);
  });

  it('fails fast on terminal trace failure', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      activity: [],
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

  it('keeps waiting on non-terminal codex command failures while the task is still running', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      activity: [{ kind: 'runner_output', actor: 'runner', content: '' }],
      traces: [
        {
          category: 'error',
          phase: 'end',
          status: 'error',
          name: 'codex.command',
          summary: 'Command failed (exit 1)',
        },
      ],
      task: { run_state: 'running' },
    });
    expect(result.success).toBe(false);
    expect(result.failure).toBe(false);
    expect(result.reason).toBe(null);
    expect(result.latestTraceSummary).toBe('Command failed (exit 1)');
  });

  it('fails when a seen workload pod exits without success', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      activity: [],
      traces: [],
      task: { run_state: 'running' },
      podSeenBefore: true,
      pod: { name: 'pod-1', phase: 'Failed', exitCode: 143 },
    });
    expect(result.failure).toBe(true);
    expect(result.reason).toBe('workload_pod_exited_without_success_signal');
  });

  it('fails when the task goes idle after a seen pod without success signals', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      activity: [{ kind: 'user_intent', actor: 'user', content: 'run it' }],
      traces: [{ category: 'progress', status: 'running', name: 'codex.command', summary: 'running command' }],
      task: { run_state: 'idle' },
      podSeenBefore: true,
      pod: null,
    });
    expect(result.failure).toBe(true);
    expect(result.reason).toBe('task_idle_without_success_signal');
  });

  it('ignores prior-round terminal traces when scoped to the current runner output activity', () => {
    const result = evaluateAgentTaskExecutionSnapshot({
      token: 'TOKEN_OK',
      runnerOutputActivityId: 'activity_runner_current',
      activity: [
        { id: 'activity_runner_previous', kind: 'runner_output', actor: 'runner', content: 'Execution failed. AGENT_CANCELLED' },
        { id: 'activity_user_current', kind: 'user_intent', actor: 'user', content: 'try again' },
        { id: 'activity_runner_current', kind: 'runner_output', actor: 'runner', content: '' },
      ],
      traces: [
        {
          message_id: 'activity_runner_previous',
          category: 'error',
          status: 'cancelled',
          name: 'execution.terminal',
          summary: 'Execution failed. AGENT_CANCELLED',
        },
        {
          message_id: 'activity_runner_current',
          category: 'progress',
          status: 'running',
          name: 'codex.command',
          summary: 'running on the replacement pod',
        },
      ],
      task: { run_state: 'running' },
      podSeenBefore: true,
      pod: { name: 'pod-2', phase: 'Running' },
    });

    expect(result.success).toBe(false);
    expect(result.failure).toBe(false);
    expect(result.reason).toBe(null);
  });
});

describe('agent task outcome summaries', () => {
  it('summarizes recent activity, traces, and pod state', () => {
    expect(summarizeAgentTaskActivity([{ kind: 'runner_output', actor: 'runner', content: 'hello world' }])).toEqual([
      'runner/runner_output: hello world',
    ]);
    expect(
      summarizeAgentTaskTraces([{ category: 'progress', status: 'running', name: 'codex.command', summary: 'running tests' }]),
    ).toEqual(['progress/running codex.command: running tests']);
    expect(summarizeAgentTaskTraces([{
      category: 'error',
      status: 'error',
      name: 'execution.terminal',
      summary: 'execution terminal synthesized: AGENT_SANDBOX_UNAVAILABLE',
      details: {
        error_diagnostic: {
          sandbox_diagnostics: {
            theme: 'runtime_pending_readiness',
            workloadId: 'task-1',
            steps: [
              {
                operation: 'get_pod_status',
                outcome: 'success',
                requestId: 'asbcp_req_status',
                workloadId: 'task-1',
                phase: 'offline',
              },
              {
                operation: 'create_or_ensure_pod',
                outcome: 'error',
                requestId: 'asbcp_req_create',
                workloadId: 'task-1',
                status: 503,
                code: 'AGENT_SANDBOX_UNAVAILABLE',
              },
            ],
          },
        },
      },
    }])).toEqual([
      'error/error execution.terminal: execution terminal synthesized: AGENT_SANDBOX_UNAVAILABLE runtime_diagnostics: theme=runtime_pending_readiness workload_id=task-1 steps=get_pod_status:success:request_id=asbcp_req_status:workload_id=task-1:phase=offline | create_or_ensure_pod:error:request_id=asbcp_req_create:workload_id=task-1:status=503:code=AGENT_SANDBOX_UNAVAILABLE',
    ]);
    expect(summarizeAgentTaskPod({ name: 'pod-1', phase: 'Failed', reason: 'Error', exitCode: 143 })).toBe(
      'pod=pod-1 phase=Failed reason=Error exit_code=143',
    );
  });
});
