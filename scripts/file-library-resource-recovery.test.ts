import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildStartupResourceRecoveryReport,
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

type StartupReportCliResult = ReturnType<typeof spawnSync>;
type SummaryCliResult = ReturnType<typeof spawnSync>;

function writeJsonFile(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function runStartupReportCli(args: readonly string[]): StartupReportCliResult {
  return spawnSync(
    'npx',
    ['tsx', 'scripts/file-library-resource-recovery.ts', 'startup-report', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

function runSummaryCli(args: readonly string[]): SummaryCliResult {
  return spawnSync(
    'npx',
    ['tsx', 'scripts/file-library-resource-recovery.ts', 'summary', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

describe('file library resource recovery', () => {
  it('honors the declared startup steady-state tcp contract instead of hardcoding ESTABLISHED <= 1', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 2,
        },
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 17017,
          state: 'CLOSE_WAIT',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 2,
          },
          {
            process_label: 'api-entry',
            remote_port: 17017,
            state: 'CLOSE_WAIT',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('pass');
    expect(report.findings).toEqual([]);
  });

  it('passes startup verification when only declared api-entry steady-state resources appear between boot and ready baselines', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 17017,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
          {
            process_label: 'api-entry',
            remote_port: 17017,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.step).toBe('file-library-api-startup');
    expect(report.status).toBe('pass');
    expect(report.findings).toEqual([]);
  });

  it('fails startup verification when the declared api-entry steady-state floor is not reached before smoke steps', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 17017,
          state: 'ESTABLISHED',
          count: 2,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 17017,
            state: 'ESTABLISHED',
            min_count: 4,
            max_count: 4,
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'startup api tcp connection count did not reach the declared steady-state floor before smoke steps for api-entry remote_port 17017 [ESTABLISHED]: expected >= 4, found 2',
    );
  });

  it('fails startup verification when startup-side api-entry tcp leaks are already present before any smoke step runs', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 2,
        },
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
          {
            process_label: 'api-entry',
            remote_port: 17017,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'startup api tcp connection count exceeded the declared steady-state allowance before smoke steps for api-entry remote_port 15432 [ESTABLISHED]: expected <= 1, found 2',
        'unexpected api startup tcp connections remained before smoke steps: api-entry -> 127.0.0.1:19000 [ESTABLISHED] x1',
      ]),
    );
  });

  it('treats a missing failure-observation path as an absent optional snapshot when startup_candidate is the comparison source', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-library-startup-report-'));
    const bootBaselinePath = path.join(root, 'boot-baseline.json');
    const startupCandidatePath = path.join(root, 'startup-candidate.json');
    const missingFailureObservationPath = path.join(root, 'failure-observation.json');
    const outputPath = path.join(root, 'startup-report.json');

    try {
      const bootBaseline = buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      });
      const startupCandidate = buildSnapshot({
        captured_at: '2026-04-15T09:59:00.000Z',
        api_processes: [
          {
            pid: 42001,
            label: 'api-entry',
            open_fd_count: 24,
            socket_fd_count: 6,
          },
        ],
      });

      writeJsonFile(bootBaselinePath, bootBaseline);
      writeJsonFile(startupCandidatePath, startupCandidate);

      const result = runStartupReportCli([
        '--boot-baseline', bootBaselinePath,
        '--startup-candidate', startupCandidatePath,
        '--failure-observation', missingFailureObservationPath,
        '--comparison-current-source', 'startup_candidate',
        '--output', outputPath,
      ]);

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        evidence_chain: {
          failure_observation: FileLibraryResourceRecoverySnapshot | null;
          comparison_current_source: string;
        };
      };
      expect(report.evidence_chain.failure_observation).toBeNull();
      expect(report.evidence_chain.comparison_current_source).toBe('startup_candidate');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when startup-report is given a declared ready-baseline path that disappears even if startup-candidate still exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-library-startup-report-required-ready-'));
    const bootBaselinePath = path.join(root, 'boot-baseline.json');
    const missingReadyBaselinePath = path.join(root, 'ready-baseline.json');
    const startupCandidatePath = path.join(root, 'startup-candidate.json');
    const outputPath = path.join(root, 'startup-report.json');

    try {
      writeJsonFile(bootBaselinePath, buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      }));
      writeJsonFile(startupCandidatePath, buildSnapshot({
        captured_at: '2026-04-15T09:59:00.000Z',
      }));

      const result = runStartupReportCli([
        '--boot-baseline', bootBaselinePath,
        '--ready-baseline', missingReadyBaselinePath,
        '--startup-candidate', startupCandidatePath,
        '--comparison-current-source', 'startup_candidate',
        '--output', outputPath,
      ]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'startup-report requires the declared ready_baseline snapshot',
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        'startup comparison current source startup_candidate requires a matching snapshot',
      );
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('raises a startup comparison error instead of surfacing ENOENT when comparison_current_source points at a missing optional snapshot', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-library-startup-report-missing-'));
    const bootBaselinePath = path.join(root, 'boot-baseline.json');
    const startupCandidatePath = path.join(root, 'startup-candidate.json');
    const missingFailureObservationPath = path.join(root, 'failure-observation.json');
    const outputPath = path.join(root, 'startup-report.json');

    try {
      writeJsonFile(bootBaselinePath, buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      }));
      writeJsonFile(startupCandidatePath, buildSnapshot({
        captured_at: '2026-04-15T09:59:00.000Z',
      }));

      const result = runStartupReportCli([
        '--boot-baseline', bootBaselinePath,
        '--startup-candidate', startupCandidatePath,
        '--failure-observation', missingFailureObservationPath,
        '--comparison-current-source', 'failure_observation',
        '--output', outputPath,
      ]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'startup comparison current source failure_observation requires a matching snapshot',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails startup verification when helper or gateway resources already drift before any smoke step runs', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
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
      gateway_state_files: ['library-smoke.json'],
      managed_gateway_labels: ['state:library-smoke'],
      managed_gateway_processes: [
        {
          pid: 4123,
          label: 'state:library-smoke',
          library_id: 'library-smoke',
          owner_scope: 'api-v1:instance-a:boot-current',
          state_file: 'library-smoke.json',
          open_fd_count: 12,
          socket_fd_count: 4,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
        {
          process_label: 'helper:mc',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
          {
            process_label: 'api-entry',
            remote_port: 17017,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'unexpected gateway state files remained after file-library-api-startup: library-smoke.json',
        'unexpected managed gateway labels remained after file-library-api-startup: state:library-smoke',
        'unexpected helper labels remained after file-library-api-startup: helper:mc',
        'unexpected tcp connections remained after file-library-api-startup: helper:mc -> 127.0.0.1:19000 [ESTABLISHED] x1',
      ]),
    );
  });

  it('fails closed when startup helper steady-state declares a non-zero allowance that cannot honestly constrain helper resource truth', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
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
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
        {
          process_label: 'helper:mc',
          remote_host: '127.0.0.1',
          remote_port: 19000,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
        helper_labels: [
          {
            label: 'helper:mc',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'startup helper steady-state allowance currently supports only max_count=0 because helper fd/socket/tcp truth is not yet contract-defined for helper:mc: received 1',
        'unexpected helper labels remained after file-library-api-startup: helper:mc',
        'unexpected tcp connections remained after file-library-api-startup: helper:mc -> 127.0.0.1:19000 [ESTABLISHED] x1',
      ]),
    );
  });

  it('fails closed for non-zero startup helper steady-state allowance even when no helper processes are currently present', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
        helper_labels: [
          {
            label: 'helper:mc',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'startup helper steady-state allowance currently supports only max_count=0 because helper fd/socket/tcp truth is not yet contract-defined for helper:mc: received 1',
    );
  });

  it('passes startup verification when startup reconcile removes non-authoritative boot gateway state files before ready', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
      gateway_state_files: ['orphan-library.json'],
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('pass');
    expect(report.findings).not.toContain(
      'baseline gateway state files disappeared after file-library-api-startup: orphan-library.json',
    );
  });

  it('passes startup verification when startup reconcile removes non-state-backed orphan managed gateway labels and processes before ready', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
      managed_gateway_labels: ['state:orphan-library'],
      managed_gateway_processes: [
        {
          pid: 3011,
          label: 'state:orphan-library',
          library_id: 'orphan-library',
          owner_scope: 'api-v1:stale-instance:boot-old',
          state_file: null,
          open_fd_count: 11,
          socket_fd_count: 7,
        },
      ],
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('pass');
    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        'baseline managed gateway labels disappeared after file-library-api-startup: state:orphan-library',
        expect.stringContaining(
          'managed gateway processes did not return to the baseline after file-library-api-startup for state:orphan-library',
        ),
      ]),
    );
  });

  it('fails startup verification when startup reconcile removes boot gateway state that was authority-confirmed at boot', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
      gateway_state_files: ['existing-library.json'],
      managed_gateway_labels: ['state:existing-library'],
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
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'baseline gateway state files disappeared after file-library-api-startup: existing-library.json',
        'baseline managed gateway labels disappeared after file-library-api-startup: state:existing-library',
        expect.stringContaining(
          'managed gateway processes did not return to the baseline after file-library-api-startup for state:existing-library',
        ),
      ]),
    );
  });

  it('fails startup verification when the api never reaches ready even if startup resources stay within allowance', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const readyBaseline = buildSnapshot({
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      readyBaseline,
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
      extraFindings: ['file-library gate api did not become ready before smoke steps'],
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'file-library gate api did not become ready before smoke steps',
      ]),
    );
  });

  it('preserves startup candidate and failure observation as distinct evidence sources when no ready baseline exists yet', () => {
    const bootBaseline = buildSnapshot({
      captured_at: '2026-04-15T09:55:00.000Z',
    });
    const startupCandidate = buildSnapshot({
      captured_at: '2026-04-15T09:59:00.000Z',
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 24,
          socket_fd_count: 6,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 1,
        },
      ],
    });
    const failureObservation = buildSnapshot({
      captured_at: '2026-04-15T10:01:00.000Z',
      api_processes: [
        {
          pid: 43002,
          label: 'api-entry',
          open_fd_count: 29,
          socket_fd_count: 8,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 2,
        },
      ],
    });

    const report = buildStartupResourceRecoveryReport({
      bootBaseline,
      startupCandidate,
      failureObservation,
      comparisonCurrentSource: 'failure_observation',
      steadyState: {
        api_tcp_connections: [
          {
            process_label: 'api-entry',
            remote_port: 15432,
            state: 'ESTABLISHED',
            max_count: 1,
          },
        ],
      },
      extraFindings: ['file-library gate startup listener handoff changed authority after steady-state proof'],
    });

    expect(report.status).toBe('fail');
    expect(report.current).toEqual(failureObservation);
    expect(report.evidence_chain).toEqual({
      boot_baseline: bootBaseline,
      ready_baseline: null,
      startup_candidate: startupCandidate,
      failure_observation: failureObservation,
      comparison_current_source: 'failure_observation',
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        'file-library gate startup listener handoff changed authority after steady-state proof',
        'startup api tcp connection count exceeded the declared steady-state allowance before smoke steps for api-entry remote_port 15432 [ESTABLISHED]: expected <= 1, found 2',
      ]),
    );
  });

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
      readyBaseline: buildSnapshot(),
      startupCandidate: buildSnapshot({
        captured_at: '2026-04-15T09:59:00.000Z',
      }),
      failureObservation: null,
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
    expect(summary.ready_baseline).toEqual(buildSnapshot());
    expect(summary.startup_candidate).toEqual(buildSnapshot({
      captured_at: '2026-04-15T09:59:00.000Z',
    }));
    expect(summary.failure_observation).toBeNull();
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
    expect(summary.markdown).toContain('- startup_candidate_captured_at: 2026-04-15T09:59:00.000Z');
    expect(summary.markdown).toContain('- failure_observation_captured_at: not_captured');
  });

  it('marks the final summary as failed when cleanup adds an extra finding after all recovery reports passed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-library-summary-cleanup-'));
    const bootBaselinePath = path.join(root, 'boot-baseline.json');
    const readyBaselinePath = path.join(root, 'ready-baseline.json');
    const reportPath = path.join(root, 'file-library-real-smoke.json');
    const outputJsonPath = path.join(root, 'report.json');
    const outputMarkdownPath = path.join(root, 'report.md');

    try {
      const bootBaseline = buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      });
      const readyBaseline = buildSnapshot({
        captured_at: '2026-04-15T10:00:00.000Z',
      });
      const passingReport = compareResourceRecoveryBaseline({
        step: 'file-library-real-smoke',
        baseline: readyBaseline,
        current: readyBaseline,
      });

      writeJsonFile(bootBaselinePath, bootBaseline);
      writeJsonFile(readyBaselinePath, readyBaseline);
      writeJsonFile(reportPath, passingReport);

      const result = runSummaryCli([
        '--boot-baseline', bootBaselinePath,
        '--ready-baseline', readyBaselinePath,
        '--report', reportPath,
        '--output-json', outputJsonPath,
        '--output-markdown', outputMarkdownPath,
        '--extra-finding', 'cleanup failed to stop the owned api process tree on port 21010 with exit code 9',
      ]);

      expect(result.status).toBe(0);
      const summary = JSON.parse(readFileSync(outputJsonPath, 'utf8')) as {
        status: string;
        findings: string[];
      };
      const markdown = readFileSync(outputMarkdownPath, 'utf8');

      expect(summary.status).toBe('fail');
      expect(summary.findings).toContain(
        'cleanup failed to stop the owned api process tree on port 21010 with exit code 9',
      );
      expect(markdown).toContain('- overall_status: fail');
      expect(markdown).toContain(
        '- cleanup failed to stop the owned api process tree on port 21010 with exit code 9',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails the final summary when cleanup cannot prove trusted owned-stop truth even if the port becomes free', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-library-summary-stop-truth-'));
    const bootBaselinePath = path.join(root, 'boot-baseline.json');
    const readyBaselinePath = path.join(root, 'ready-baseline.json');
    const reportPath = path.join(root, 'file-library-real-smoke.json');
    const outputJsonPath = path.join(root, 'report.json');
    const outputMarkdownPath = path.join(root, 'report.md');

    try {
      const bootBaseline = buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      });
      const readyBaseline = buildSnapshot({
        captured_at: '2026-04-15T10:00:00.000Z',
      });
      const passingReport = compareResourceRecoveryBaseline({
        step: 'file-library-real-smoke',
        baseline: readyBaseline,
        current: readyBaseline,
      });

      writeJsonFile(bootBaselinePath, bootBaseline);
      writeJsonFile(readyBaselinePath, readyBaseline);
      writeJsonFile(reportPath, passingReport);

      const result = runSummaryCli([
        '--boot-baseline', bootBaselinePath,
        '--ready-baseline', readyBaselinePath,
        '--report', reportPath,
        '--output-json', outputJsonPath,
        '--output-markdown', outputMarkdownPath,
        '--extra-finding',
        'cleanup could not prove the owned api process tree was cleared after port 21010 became free because trusted stop truth was unavailable',
      ]);

      expect(result.status).toBe(0);
      const summary = JSON.parse(readFileSync(outputJsonPath, 'utf8')) as {
        status: string;
        findings: string[];
      };
      const markdown = readFileSync(outputMarkdownPath, 'utf8');

      expect(summary.status).toBe('fail');
      expect(summary.findings).toContain(
        'cleanup could not prove the owned api process tree was cleared after port 21010 became free because trusted stop truth was unavailable',
      );
      expect(markdown).toContain('- overall_status: fail');
      expect(markdown).toContain(
        '- cleanup could not prove the owned api process tree was cleared after port 21010 became free because trusted stop truth was unavailable',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when summary is given a declared startup-candidate path that disappears even if ready-baseline still exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-library-summary-required-startup-'));
    const bootBaselinePath = path.join(root, 'boot-baseline.json');
    const readyBaselinePath = path.join(root, 'ready-baseline.json');
    const missingStartupCandidatePath = path.join(root, 'startup-candidate.json');
    const reportPath = path.join(root, 'file-library-real-smoke.json');
    const outputJsonPath = path.join(root, 'report.json');
    const outputMarkdownPath = path.join(root, 'report.md');

    try {
      const bootBaseline = buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      });
      const readyBaseline = buildSnapshot({
        captured_at: '2026-04-15T10:00:00.000Z',
      });
      const passingReport = compareResourceRecoveryBaseline({
        step: 'file-library-real-smoke',
        baseline: readyBaseline,
        current: readyBaseline,
      });

      writeJsonFile(bootBaselinePath, bootBaseline);
      writeJsonFile(readyBaselinePath, readyBaseline);
      writeJsonFile(reportPath, passingReport);

      const result = runSummaryCli([
        '--boot-baseline', bootBaselinePath,
        '--ready-baseline', readyBaselinePath,
        '--startup-candidate', missingStartupCandidatePath,
        '--report', reportPath,
        '--output-json', outputJsonPath,
        '--output-markdown', outputMarkdownPath,
      ]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'summary requires the declared startup_candidate snapshot',
      );
      expect(existsSync(outputJsonPath)).toBe(false);
      expect(existsSync(outputMarkdownPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
