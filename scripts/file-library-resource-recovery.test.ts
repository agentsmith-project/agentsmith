import { describe, expect, it } from 'vitest';

import {
  buildResourceRecoverySummary,
  compareResourceRecoveryBaseline,
  finalizeResourceRecoveryStepReport,
  buildResourceRecoveryFailureReport,
  type FileLibraryResourceRecoveryProbe,
  type FileLibraryResourceRecoverySnapshot,
} from './file-library-resource-recovery';

function buildSnapshot(
  overrides: Partial<FileLibraryResourceRecoverySnapshot> = {},
): FileLibraryResourceRecoverySnapshot {
  return {
    captured_at: '2026-04-15T10:00:00.000Z',
    gateway_state_dir: '/repo/packages/api-entry-node/artifacts/file-library-gateway-state',
    task_mount_root: '/home/percy/ags-workspace',
    api_processes: [],
    helper_labels: [],
    helper_processes: [],
    gateway_state_files: [],
    managed_gateway_labels: [],
    managed_gateway_processes: [],
    mounted_task_mounts: [],
    tcp_connections: [],
    ...overrides,
  };
}

function buildProbe(
  overrides: Partial<FileLibraryResourceRecoveryProbe> = {},
): FileLibraryResourceRecoveryProbe {
  return {
    step: 'file-library-mount-sync-smoke',
    mount_point: '/tmp/file-library-mount',
    cleanup_mount_status: 'not_mounted',
    residual_mount_process_pids: [],
    cleanup_probe_errors: [],
    notes: [],
    ...overrides,
  };
}

describe('file library resource recovery', () => {
  it('passes when the runtime state returns to the baseline and the mount cleanup probe is clean', () => {
    const baseline = buildSnapshot({
      gateway_state_files: ['existing-library.json'],
      managed_gateway_labels: ['state:existing-library'],
      managed_gateway_processes: [
        {
          pid: 3001,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
        },
      ],
      mounted_task_mounts: ['/home/percy/ags-workspace/task_existing'],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-mount-sync-smoke',
      baseline,
      current: baseline,
      probe: buildProbe(),
    });

    expect(report.status).toBe('pass');
    expect(report.findings).toEqual([]);
  });

  it('fails when the gate leaves a gateway state file behind after the smoke step', () => {
    const baseline = buildSnapshot();
    const current = buildSnapshot({
      gateway_state_files: ['library-smoke.json'],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current,
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'unexpected gateway state files remained after file-library-real-smoke: library-smoke.json',
    );
  });

  it('fails when the gate leaves a managed gateway process label beyond the baseline', () => {
    const baseline = buildSnapshot();
    const current = buildSnapshot({
      managed_gateway_labels: ['state:library-smoke'],
      managed_gateway_processes: [
        {
          pid: 4123,
          label: 'state:library-smoke',
          library_id: 'library-smoke',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'library-smoke.json',
        },
      ],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current,
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'unexpected managed gateway labels remained after file-library-real-smoke: state:library-smoke',
    );
  });

  it('fails when the gate removes baseline resources or changes managed gateway pids for an existing label', () => {
    const baseline = buildSnapshot({
      gateway_state_files: ['existing-library.json'],
      managed_gateway_labels: ['state:existing-library'],
      managed_gateway_processes: [
        {
          pid: 3001,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
        },
      ],
      mounted_task_mounts: ['/home/percy/ags-workspace/task_existing'],
    });
    const current = buildSnapshot({
      managed_gateway_labels: ['state:existing-library'],
      managed_gateway_processes: [
        {
          pid: 3111,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
        },
      ],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current,
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'baseline gateway state files disappeared after file-library-real-smoke: existing-library.json',
    );
    expect(report.findings).toContain(
      'baseline mounted task roots disappeared after file-library-real-smoke: /home/percy/ags-workspace/task_existing',
    );
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'managed gateway processes did not return to the baseline after file-library-real-smoke for state:existing-library',
        ),
      ]),
    );
  });

  it('fails when a managed gateway label keeps the baseline label but leaks an extra pid', () => {
    const baseline = buildSnapshot({
      managed_gateway_labels: ['state:existing-library'],
      managed_gateway_processes: [
        {
          pid: 3001,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
        },
      ],
    });
    const current = buildSnapshot({
      managed_gateway_labels: ['state:existing-library'],
      managed_gateway_processes: [
        {
          pid: 3001,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
        },
        {
          pid: 3555,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
        },
      ],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current,
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'managed gateway processes did not return to the baseline after file-library-real-smoke for state:existing-library',
        ),
      ]),
    );
  });

  it('fails when task mounts remain beyond the baseline or the mount cleanup probe still reports a live mount', () => {
    const baseline = buildSnapshot();
    const current = buildSnapshot({
      mounted_task_mounts: ['/home/percy/ags-workspace/task_smoke'],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-mount-sync-smoke',
      baseline,
      current,
      probe: buildProbe({
        cleanup_mount_status: 'exact_mount',
        residual_mount_process_pids: [9123],
      }),
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'unexpected mounted task roots remained after file-library-mount-sync-smoke: /home/percy/ags-workspace/task_smoke',
    );
    expect(report.findings).toContain(
      'mount cleanup probe still reports an exact mount for /tmp/file-library-mount after file-library-mount-sync-smoke',
    );
    expect(report.findings).toContain(
      'mount cleanup probe still reports juicefs mount processes for /tmp/file-library-mount after file-library-mount-sync-smoke: 9123',
    );
  });

  it('fails when api or gateway resource truth grows beyond the ready baseline', () => {
    const baseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      managed_gateway_processes: [
        {
          pid: 3001,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
          open_fd_count: 18,
          socket_fd_count: 4,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'ESTABLISHED',
          count: 1,
        },
        {
          process_label: 'state:existing-library',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });
    const current = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 27,
          socket_fd_count: 8,
        },
      ],
      managed_gateway_processes: [
        {
          pid: 3001,
          label: 'state:existing-library',
          library_id: 'existing-library',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'existing-library.json',
          open_fd_count: 21,
          socket_fd_count: 5,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'ESTABLISHED',
          count: 2,
        },
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'CLOSE_WAIT',
          count: 1,
        },
        {
          process_label: 'state:existing-library',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 2,
        },
      ],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current,
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'api process fd count grew beyond the baseline after file-library-real-smoke for api-entry (pid 42001): expected <= 24, found 27',
        'api process socket fd count grew beyond the baseline after file-library-real-smoke for api-entry (pid 42001): expected <= 6, found 8',
        'managed gateway fd count grew beyond the baseline after file-library-real-smoke for state:existing-library (pid 3001): expected <= 18, found 21',
        'managed gateway socket fd count grew beyond the baseline after file-library-real-smoke for state:existing-library (pid 3001): expected <= 4, found 5',
        'tcp connection count grew beyond the baseline after file-library-real-smoke for api-entry -> 127.0.0.1:19000 [ESTABLISHED]: expected <= 1, found 2',
        'unexpected tcp connections remained after file-library-real-smoke: api-entry -> 127.0.0.1:19000 [CLOSE_WAIT] x1',
        'tcp connection count grew beyond the baseline after file-library-real-smoke for state:existing-library -> 127.0.0.1:15432 [ESTABLISHED]: expected <= 1, found 2',
      ]),
    );
  });

  it('fails when helper processes and their tcp connections remain beyond the ready baseline', () => {
    const baseline = buildSnapshot();
    const current = buildSnapshot({
      helper_labels: ['helper:mc'],
      helper_processes: [
        {
          pid: 5102,
          label: 'helper:mc',
          command: 'mc rb --force fladmin/jfs-lib-helper',
          open_fd_count: 9,
          socket_fd_count: 3,
        },
      ],
      tcp_connections: [
        {
          process_label: 'helper:mc',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current,
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'unexpected helper labels remained after file-library-real-smoke: helper:mc',
        expect.stringContaining(
          'helper processes did not return to the baseline after file-library-real-smoke for helper:mc',
        ),
        'unexpected tcp connections remained after file-library-real-smoke: helper:mc -> 127.0.0.1:19000 [ESTABLISHED] x1',
      ]),
    );
  });

  it('fails closed when the mount cleanup probe cannot prove mount or process truth', () => {
    const report = compareResourceRecoveryBaseline({
      step: 'file-library-mount-sync-smoke',
      baseline: buildSnapshot(),
      current: buildSnapshot(),
      probe: buildProbe({
        cleanup_probe_errors: [
          'findmnt is required to verify mount cleanup but was not found',
          'ps is required to verify mount cleanup but was not found',
        ],
      }),
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'mount cleanup probe could not prove cleanup after file-library-mount-sync-smoke: findmnt is required to verify mount cleanup but was not found; ps is required to verify mount cleanup but was not found',
    );
  });

  it('marks the step as failed when the smoke command fails even if recovery returns to the baseline', () => {
    const verified = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline: buildSnapshot(),
      current: buildSnapshot(),
    });

    const report = finalizeResourceRecoveryStepReport({
      report: verified,
      smoke_status: 23,
      smoke_message: 'file-library-real-smoke exited with status 23',
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'smoke step failed for file-library-real-smoke with exit code 23: file-library-real-smoke exited with status 23',
    );
  });

  it('builds a failure report when verify cannot materialize its normal recovery report', () => {
    const report = buildResourceRecoveryFailureReport({
      step: 'file-library-mount-sync-smoke',
      baseline: buildSnapshot(),
      current: buildSnapshot(),
      reason: 'resource recovery verify exited before writing the step report',
      probe: buildProbe(),
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'resource recovery verify exited before writing the step report',
    );
    expect(report.probe).toMatchObject({
      step: 'file-library-mount-sync-smoke',
      mount_point: '/tmp/file-library-mount',
    });
  });

  it('renders a structured summary that preserves per-step verdicts and carries failures upward', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const summary = buildResourceRecoverySummary({
      bootBaseline,
      baseline: buildSnapshot(),
      reports: [
        compareResourceRecoveryBaseline({
          step: 'file-library-real-smoke',
          baseline: buildSnapshot(),
          current: buildSnapshot(),
        }),
        compareResourceRecoveryBaseline({
          step: 'file-library-mount-sync-smoke',
          baseline: buildSnapshot(),
          current: buildSnapshot({
            gateway_state_files: ['library-smoke.json'],
          }),
        }),
      ],
    });

    expect(summary.status).toBe('fail');
    expect(summary.boot_baseline).toEqual(bootBaseline);
    expect(summary.steps).toEqual([
      { step: 'file-library-real-smoke', status: 'pass' },
      { step: 'file-library-mount-sync-smoke', status: 'fail' },
    ]);
    expect(summary.findings).toContain(
      'unexpected gateway state files remained after file-library-mount-sync-smoke: library-smoke.json',
    );
    expect(summary.markdown).toContain('# File Library Resource Recovery Report');
    expect(summary.markdown).toContain('- overall_status: fail');
    expect(summary.markdown).toContain('- boot_baseline_captured_at: 2026-04-15T09:55:00.000Z');
    expect(summary.markdown).toContain('- ready_baseline_captured_at: 2026-04-15T10:00:00.000Z');
  });
});
