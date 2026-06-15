import { describe, expect, it } from 'vitest';

import {
  buildRuntimeReadinessDetails,
  parseK8sPodsFromText,
  parseRuntimeReadinessSignals,
  RUNTIME_READINESS_POLICY,
} from '../runtime-readiness-details.mjs';

describe('runtime readiness details evidence', () => {
  it('defines convergence rules for each runtime surface and non-terminal state', () => {
    const requiredSurfaces = [
      'files',
      'agent_task_sandbox',
      'afscp_workspace_binding',
      'read_export',
    ] as const;
    const requiredStates = ['pending', 'releasing', 'offline', 'not_found'] as const;

    for (const surface of requiredSurfaces) {
      const rules = RUNTIME_READINESS_POLICY.state_convergence[surface];
      expect(rules, `${surface} convergence rules`).toBeTruthy();
      for (const state of requiredStates) {
        expect(rules[state], `${surface}.${state}`).toEqual(expect.stringMatching(/\S/u));
      }
    }
  });

  it('keeps runtime readiness observation intervals increasing after consecutive waits', () => {
    const intervals = RUNTIME_READINESS_POLICY.interval_ms;

    expect(RUNTIME_READINESS_POLICY.backoff).toBe('increasing_after_consecutive_non_terminal');
    expect(intervals.length).toBeGreaterThanOrEqual(3);
    expect(new Set(intervals).size).toBe(intervals.length);
    for (let index = 1; index < intervals.length; index += 1) {
      expect(intervals[index]).toBeGreaterThan(intervals[index - 1]);
    }
  });

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
            readiness_reason: 'workspace_pvc_unbound',
            readiness_message: 'workspace PVC is not bound yet',
            retry_after: 5,
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
            readiness_reason: 'Insufficient cpu',
            readiness_message: '0/1 nodes are available: Insufficient cpu',
            retry_after: 11,
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
            readinessReason: 'Insufficient cpu',
            readinessMessage: '0/1 nodes are available: Insufficient cpu',
            retryAfter: 11,
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
          readiness_reason: 'workspace_pvc_unbound',
          readiness_message: 'workspace PVC is not bound yet',
          retry_after: '5',
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
          readiness_reason: 'Insufficient cpu',
          readiness_message: '0/1 nodes are available: Insufficient cpu',
          retry_after: '11',
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
          readiness_reason: 'Insufficient cpu',
          readiness_message: '0/1 nodes are available: Insufficient cpu',
          retry_after: '11',
        }),
      ]),
    );
  });

  it('records K8s scheduling readiness reason markers in runtime readiness details', () => {
    const report = buildRuntimeReadinessDetails({
      generatedAt: '2026-06-13T12:00:00.000Z',
      podStatusText: [
        'pod=task-unschedulable',
        'phase=Pending',
        'conditions=PodScheduled:False:Unschedulable;',
        '---',
      ].join('\n'),
      logFiles: [{
        path: '/tmp/k8s-events.txt',
        content: 'Warning FailedScheduling pod/task-unschedulable 0/1 nodes are available: Insufficient cpu\n',
      }],
    });

    expect(report.call_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'k8s_event',
        call: 'schedule_pod',
        phase: 'unknown',
        error_code: 'FailedScheduling',
        readiness_reason: 'Insufficient cpu',
      }),
    ]));
    expect(report.failure).toEqual(expect.objectContaining({
      source: 'k8s_event',
      error_code: 'FailedScheduling',
      readiness_reason: 'Insufficient cpu',
    }));
    expect(report.k8s_pods).toEqual([
      {
        pod: 'task-unschedulable',
        phase: 'Pending',
        conditions: 'PodScheduled:False:Unschedulable;',
      },
    ]);
  });

  it('derives complete owner call summaries from release-incomplete runtime failure diagnostics', () => {
    const report = buildRuntimeReadinessDetails({
      generatedAt: '2026-06-15T07:32:14.554Z',
      podStatusText: '',
      logFiles: [
        {
          path: '/tmp/api.log',
          content: [
            '{"time":"2026-06-15T07:31:53.407844895Z","level":"INFO","message":"request handled","event":"afscp.request","correlation_id":"38481df2-3c4e-415a-8945-9766e0c48bea","method":"POST","operation_id":"releaseWorkloadMountBinding","path":"/internal/v1/workload-mount-bindings/wmb_52b2c56169c8fedde309:release","route":"/internal/v1/workload-mount-bindings/{mountBindingId}:release","status":202}',
            '[files] runtime_pending_readiness_failure {"event":"runtime_pending_readiness_failure","theme":"runtime_pending_readiness","scope":"file_library_runtime_access_release","diagnostic":{"theme":"runtime_pending_readiness","workspace_id":"ws_default","project_id":"proj_1781508527084_59878","file_library_id":"flib_f11aff0e07ff","task_id":"task_476aa53b08af467da0b03fce2a5a1a78","workload_id":"task-476aa53b08af467da0b03fce2a5a1a78","request_id":"release:begin:unspecified","operation":"delete_workspace_binding","error_code":"AGENT_SANDBOX_RELEASE_INCOMPLETE","mapped_error_code":"FILE_LIBRARY_RETRYABLE_INFRASTRUCTURE_CONFLICT","mapped_message":"file_library_retryable_infrastructure_conflict","status":409,"retryable":true}}',
          ].join('\n'),
        },
        {
          path: '/tmp/asbcp.log',
          content: '2026/06/15 07:31:56 workspacebinding/wmb_52b2c56169c8fedde309: AFSCP mount reference unavailable before release: workspace=ws_default project=proj_1781508527084_59878 request_id=ca3a6987-f5c2-4ba0-9c02-befa21691354 correlation_id=ca3a6987-f5c2-4ba0-9c02-befa21691354 error=workspace binding release fact write failed\n',
        },
      ],
    });

    expect(report.call_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'api',
        call: 'releaseWorkloadMountBinding',
        request_id: '38481df2-3c4e-415a-8945-9766e0c48bea',
        status_code: '202',
      }),
      expect.objectContaining({
        source: 'api',
        call: 'delete_workspace_binding',
        request_id: 'release:begin:unspecified',
        workload_id: 'task-476aa53b08af467da0b03fce2a5a1a78',
        phase: 'unknown',
        status_code: '409',
        error_code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      }),
      expect.objectContaining({
        source: 'pod_manager',
        call: 'delete_workspace_binding',
        request_id: 'release:begin:unspecified',
        workload_id: 'task-476aa53b08af467da0b03fce2a5a1a78',
        phase: 'unknown',
        status_code: '409',
        error_code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
        evidence: 'derived_from_runtime_failure_diagnostic',
      }),
      expect.objectContaining({
        source: 'asbcp_create_status',
        call: 'delete_workspace_binding',
        request_id: 'release:begin:unspecified',
        workload_id: 'task-476aa53b08af467da0b03fce2a5a1a78',
        phase: 'unknown',
        status_code: '409',
        error_code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
        evidence: 'derived_from_runtime_failure_diagnostic',
      }),
    ]));
    expect(report.failure).toEqual(expect.objectContaining({
      source: 'asbcp_create_status',
      error_code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      phase: 'unknown',
    }));
    expect(report.pod_manager_summary).toEqual(expect.objectContaining({
      source: 'pod_manager',
      error_code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
    }));
  });

  it('keeps upstream errors with sandbox diagnostics visible as runtime readiness evidence', () => {
    const diagnostic = {
      event: 'runtime_pending_readiness_failure',
      diagnostic: {
        code: 'AGENT_UPSTREAM_ERROR',
        request_id: 'req_upstream_with_sandbox',
        sandbox_diagnostics: {
          theme: 'runtime_pending_readiness',
          workloadId: 'task-upstream-sandbox',
          pod_manager_summary: {
            latest_operation: 'create_or_ensure_pod',
            latest_outcome: 'error',
            latest_request_id: 'asbcp_req_upstream_sandbox',
            latest_status_code: 503,
            latest_error_code: 'AGENT_SANDBOX_UNAVAILABLE',
            latest_asbcp_code: 'pod_unschedulable',
            latest_readiness_reason: 'Insufficient cpu',
            latest_readiness_message: '0/1 nodes are available: Insufficient cpu',
            latest_retry_after: 13,
          },
          steps: [
            {
              operation: 'create_or_ensure_pod',
              outcome: 'error',
              requestId: 'asbcp_req_upstream_sandbox',
              workloadId: 'task-upstream-sandbox',
              status: 503,
              code: 'AGENT_SANDBOX_UNAVAILABLE',
              asbcpCode: 'pod_unschedulable',
              readinessReason: 'Insufficient cpu',
              readinessMessage: '0/1 nodes are available: Insufficient cpu',
              retryAfter: 13,
            },
          ],
        },
      },
    };

    const report = buildRuntimeReadinessDetails({
      generatedAt: '2026-06-13T12:05:00.000Z',
      podStatusText: '',
      logFiles: [{
        path: '/tmp/api.log',
        content: `runtime_pending_readiness_failure ${JSON.stringify(diagnostic)}\n`,
      }],
    });

    expect(report.call_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'pod_manager',
        call: 'create_or_ensure_pod',
        request_id: 'asbcp_req_upstream_sandbox',
        workload_id: 'task-upstream-sandbox',
        status_code: '503',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        asbcp_code: 'pod_unschedulable',
        readiness_reason: 'Insufficient cpu',
        readiness_message: '0/1 nodes are available: Insufficient cpu',
        retry_after: '13',
      }),
    ]));
    expect(report.failure).toEqual(expect.objectContaining({
      error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      readiness_reason: 'Insufficient cpu',
    }));
  });

  it('derives pod manager summary request id from request_ids when no step record is present', () => {
    const diagnostic = {
      diagnostic: {
        request_id: 'api_req_restore',
        workload_id: 'task-restore-summary',
        phase: 'offline',
        status: 503,
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        operation: 'create_task_workspace',
        pod_manager: {
          workload_id: 'task-restore-summary',
          pod_manager_summary: {
            workload_id: 'task-restore-summary',
            operations: ['readyz', 'get_pod_status', 'create_or_ensure_pod'],
            request_ids: ['pod_mgr_readyz', 'pod_mgr_status', 'pod_mgr_create'],
            latest_operation: 'create_or_ensure_pod',
            latest_outcome: 'error',
            latest_phase: 'offline',
            latest_status_code: 503,
            latest_error_code: 'AGENT_SANDBOX_UNAVAILABLE',
          },
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
          source: 'pod_manager',
          call: 'create_or_ensure_pod',
          request_id: 'pod_mgr_create',
          workload_id: 'task-restore-summary',
          phase: 'offline',
          status_code: '503',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        }),
      ]),
    );
  });

  it('parses sandbox startup timeout envelopes with top-level API and pod manager diagnostics', () => {
    const diagnostic = {
      event: 'runtime_pending_readiness_failure',
      theme: 'runtime_pending_readiness',
      api: {
        task_id: 'task_startup_timeout',
        run_id: 'run_startup_timeout',
        error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      },
      pod_manager: {
        workloadId: 'task-startup-timeout',
        api_trace: [
          {
            operation: 'wait_for_running_status',
            outcome: 'success',
            request_id: 'req_status_pending',
            workload_id: 'task-startup-timeout',
            phase: 'Pending',
          },
          {
            operation: 'wait_for_running',
            outcome: 'error',
            workload_id: 'task-startup-timeout',
            error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
          },
        ],
        pod_manager_summary: {
          workload_id: 'task-startup-timeout',
          request_ids: ['req_status_pending'],
          latest_operation: 'wait_for_running',
          latest_outcome: 'error',
          latest_phase: 'Pending',
          latest_error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        },
        asbcp_call_summaries: [
          {
            operation: 'wait_for_running',
            outcome: 'error',
            workload_id: 'task-startup-timeout',
            error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
          },
        ],
      },
      diagnostic: {
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_startup_timeout',
      },
    };

    const report = buildRuntimeReadinessDetails({
      generatedAt: '2026-06-08T20:24:04.500Z',
      podStatusText: '',
      logFiles: [{
        path: '/tmp/api.log',
        content: `[sandbox] runtime_pending_readiness_failure ${JSON.stringify(diagnostic)}\n`,
      }],
    });

    expect(report.call_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'api',
        call: 'wait_for_running',
        request_id: 'req_status_pending',
        workload_id: 'task-startup-timeout',
        phase: 'Pending',
        status: 'Pending',
        error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      }),
      expect.objectContaining({
        source: 'pod_manager',
        call: 'wait_for_running',
        request_id: 'req_status_pending',
        workload_id: 'task-startup-timeout',
        phase: 'Pending',
        status: 'Pending',
        error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      }),
      expect.objectContaining({
        source: 'asbcp_create_status',
        call: 'wait_for_running',
        request_id: 'req_status_pending',
        workload_id: 'task-startup-timeout',
        phase: 'Pending',
        status: 'Pending',
        error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      }),
    ]));
    expect(report.failure).toEqual(expect.objectContaining({
      error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      workload_id: 'task-startup-timeout',
    }));
    expect(report.api).toEqual(expect.objectContaining({
      source: 'api',
      error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
    }));
    expect(report.pod_manager_summary).toEqual(expect.objectContaining({
      source: 'pod_manager',
      error_code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
    }));
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
      convergence_policy: {
        schema_version: 'agentsmith.runtime-readiness-policy/v1',
        theme: 'runtime_pending_readiness',
        backoff: 'increasing_after_consecutive_non_terminal',
        interval_ms: [60_000, 90_000, 120_000, 180_000, 300_000],
      },
      classification_rules: RUNTIME_READINESS_POLICY.classification_rules,
    });
    expect(Object.keys(report.convergence_policy.state_convergence).sort()).toEqual([
      'afscp_workspace_binding',
      'agent_task_sandbox',
      'files',
      'read_export',
    ]);
    expect(Object.keys(report.convergence_policy.state_convergence.read_export).sort()).toEqual([
      'not_found',
      'offline',
      'pending',
      'releasing',
    ]);
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

  it('normalizes plain text operation and code fields into required call summaries', () => {
    const signals = parseRuntimeReadinessSignals([{
      path: '/tmp/plain-runtime.log',
      content: [
        'API runtime_pending_readiness operation=create_task_workspace request_id=req-api workload_id=task-restore-2 phase=offline status_code=503 code=AGENT_SANDBOX_UNAVAILABLE',
        'pod manager operation=create_or_ensure_pod request_id=req-pod workload_id=task-restore-2 phase=offline status=503 code=AGENT_SANDBOX_UNAVAILABLE',
        'ASBCP operation=create/status request_id=req-asbcp workload_id=task-restore-2 phase=offline status_code=503 code=AGENT_SANDBOX_UNAVAILABLE',
      ].join('\n'),
    }]);

    expect(signals).toEqual([
      expect.objectContaining({
        source: 'api',
        call: 'create_task_workspace',
        request_id: 'req-api',
        workload_id: 'task-restore-2',
        phase: 'offline',
        status_code: '503',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      }),
      expect.objectContaining({
        source: 'pod_manager',
        call: 'create_or_ensure_pod',
        request_id: 'req-pod',
        workload_id: 'task-restore-2',
        phase: 'offline',
        status: '503',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      }),
      expect.objectContaining({
        source: 'asbcp_create_status',
        call: 'create/status',
        request_id: 'req-asbcp',
        workload_id: 'task-restore-2',
        phase: 'offline',
        status_code: '503',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      }),
    ]);
  });

  it('captures ASBCP readyz and managed runner runtime unavailable logs as runtime readiness signals', () => {
    const signals = parseRuntimeReadinessSignals([{
      path: '/tmp/api.log',
      content: [
        '[api-entry-node] ASBCP readyz preflight failed: asbcp_network_error: readyz fetch failed',
        'Error: create_terminal_session_failed:409:{"error_code":"agent_runner_runtime_unavailable","message":"agent_runner_runtime_unavailable"}',
      ].join('\n'),
    }]);

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'asbcp_create_status',
        call: 'asbcp_readyz_preflight',
        error_code: 'asbcp_network_error',
      }),
      expect.objectContaining({
        source: 'api',
        call: 'create_terminal_session',
        error_code: 'agent_runner_runtime_unavailable',
      }),
    ]));
  });

  it('uses an explicit unknown phase when sandbox unavailable diagnostics omit phase', () => {
    const diagnostic = {
      diagnostic: {
        request_id: 'release:begin:unspecified',
        workload_id: 'task-restore-3',
        status: 500,
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        operation: 'delete_pod',
        pod_manager: {
          workload_id: 'task-restore-3',
          pod_manager_summary: {
            latest_operation: 'delete_pod',
            latest_outcome: 'error',
            latest_status_code: 500,
            latest_error_code: 'AGENT_SANDBOX_UNAVAILABLE',
          },
          api_trace: [
            {
              operation: 'delete_pod',
              outcome: 'error',
              request_id: 'api_req_delete',
              workload_id: 'task-restore-3',
              status_code: 500,
              error_code: 'AGENT_SANDBOX_UNAVAILABLE',
            },
          ],
          asbcp_call_summaries: [
            {
              operation: 'delete_pod',
              outcome: 'error',
              request_id: 'asbcp_req_delete',
              workload_id: 'task-restore-3',
              status_code: 500,
              error_code: 'AGENT_SANDBOX_UNAVAILABLE',
            },
          ],
          steps: [
            {
              operation: 'delete_pod',
              outcome: 'error',
              requestId: 'pod_req_delete',
              workloadId: 'task-restore-3',
              status: 500,
              code: 'AGENT_SANDBOX_UNAVAILABLE',
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
          call: 'delete_pod',
          request_id: 'release:begin:unspecified',
          workload_id: 'task-restore-3',
          phase: 'unknown',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        }),
        expect.objectContaining({
          source: 'pod_manager',
          call: 'delete_pod',
          request_id: 'pod_req_delete',
          workload_id: 'task-restore-3',
          phase: 'unknown',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        }),
        expect.objectContaining({
          source: 'asbcp_create_status',
          call: 'delete_pod',
          request_id: 'asbcp_req_delete',
          workload_id: 'task-restore-3',
          phase: 'unknown',
          error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        }),
      ]),
    );
  });

  it('parses kubernetes pod status text without requiring kubectl in unit tests', () => {
    expect(parseK8sPodsFromText('pod=runner-1\nphase=Running\n---\npod=runner-2\nphase=Failed\n')).toEqual([
      { pod: 'runner-1', phase: 'Running' },
      { pod: 'runner-2', phase: 'Failed' },
    ]);
  });
});
