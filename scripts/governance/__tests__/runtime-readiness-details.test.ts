import { describe, expect, it } from 'vitest';

import {
  buildRuntimeReadinessDetails,
  parseK8sPodsFromText,
  parseRuntimeReadinessSignals,
} from '../runtime-readiness-details.mjs';

describe('runtime readiness details evidence', () => {
  it('records API, pod manager, and ASBCP call summaries for sandbox unavailable failures', () => {
    const diagnostic = {
      diagnostic: {
        request_id: 'api_req_create_task',
        workload_id: 'task-restore-1',
        phase: 'offline',
        status: 503,
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        operation: 'create_task_workspace',
        retryable: true,
        pod_manager: {
          workload_id: 'task-restore-1',
          pod_manager_summary: {
            latest_operation: 'create_or_ensure_pod',
            latest_outcome: 'error',
            latest_phase: 'offline',
            latest_status_code: 503,
            latest_error_code: 'AGENT_SANDBOX_UNAVAILABLE',
          },
          api_trace: [
            {
              operation: 'get_pod_status',
              outcome: 'success',
              request_id: 'api_req_status',
              workload_id: 'task-restore-1',
              phase: 'offline',
            },
          ],
          asbcp_call_summaries: [
            {
              operation: 'create/status',
              outcome: 'error',
              request_id: 'asbcp_req_create',
              workload_id: 'task-restore-1',
              phase: 'offline',
              status_code: 503,
              error_code: 'AGENT_SANDBOX_UNAVAILABLE',
              asbcp_code: 'AGENT_SANDBOX_UNAVAILABLE',
              retryable: true,
            },
          ],
          steps: [
            {
              operation: 'create_or_ensure_pod',
              outcome: 'error',
              request_id: 'pod_mgr_create',
              workload_id: 'task-restore-1',
              phase: 'offline',
              status: 503,
              code: 'AGENT_SANDBOX_UNAVAILABLE',
              retryable: true,
            },
          ],
        },
      },
    };

    const signals = parseRuntimeReadinessSignals([{
      path: '/tmp/api.log',
      content: `runtime_pending_readiness_failure ${JSON.stringify(diagnostic)}\n`,
    }]);

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'api',
          call: 'create_task_workspace',
          request_id: 'api_req_create_task',
          workload_id: 'task-restore-1',
          phase: 'offline',
          status_code: '503',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
          retryable: 'true',
        }),
        expect.objectContaining({
          source: 'api',
          call: 'get_pod_status',
          request_id: 'api_req_status',
          workload_id: 'task-restore-1',
          phase: 'offline',
        }),
        expect.objectContaining({
          source: 'pod_manager',
          call: 'create_or_ensure_pod',
          outcome: 'error',
          request_id: 'pod_mgr_create',
          workload_id: 'task-restore-1',
          phase: 'offline',
          status_code: '503',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        }),
        expect.objectContaining({
          source: 'asbcp_create_status',
          call: 'create/status',
          outcome: 'error',
          request_id: 'asbcp_req_create',
          workload_id: 'task-restore-1',
          phase: 'offline',
          status_code: '503',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
          asbcp_code: 'AGENT_SANDBOX_UNAVAILABLE',
        }),
      ]),
    );
  });

  it('keeps the runtime readiness report schema stable while exposing call_summaries', () => {
    const report = buildRuntimeReadinessDetails({
      generatedAt: '2026-06-05T12:00:00.000Z',
      podStatusText: [
        'pod=task-restore-1',
        'phase=Pending',
        'conditions=PodScheduled:False:Unschedulable;',
        '---',
      ].join('\n'),
      logFiles: [{
        path: '/tmp/asbcp.log',
        content: 'ASBCP create/status request_id=asbcp_req_status workload_id=task-restore-1 phase=pending status_code=409 error_code=release_pending\n',
      }],
    });

    expect(report).toMatchObject({
      schema_version: 'agentsmith.runtime-readiness-details/v1',
      theme: 'runtime_pending_readiness',
      generated_at: '2026-06-05T12:00:00.000Z',
    });
    expect(report.call_summaries).toEqual(report.signals);
    expect(report.call_summaries).toEqual([
      expect.objectContaining({
        source: 'asbcp_create_status',
        call: 'create/status',
        request_id: 'asbcp_req_status',
        workload_id: 'task-restore-1',
        phase: 'pending',
        status_code: '409',
        error_code: 'release_pending',
      }),
    ]);
    expect(report.k8s_pods).toEqual([
      {
        pod: 'task-restore-1',
        phase: 'Pending',
        conditions: 'PodScheduled:False:Unschedulable;',
      },
    ]);
  });

  it('parses kubernetes pod status text without requiring kubectl in unit tests', () => {
    expect(parseK8sPodsFromText('pod=runner-1\nphase=Running\n---\npod=runner-2\nphase=Failed\n')).toEqual([
      { pod: 'runner-1', phase: 'Running' },
      { pod: 'runner-2', phase: 'Failed' },
    ]);
  });
});
