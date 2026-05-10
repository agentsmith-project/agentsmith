import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildResourceRecoveryFailureReport,
  buildResourceRecoverySummary,
  buildStartupResourceRecoveryReport,
  compareResourceRecoveryBaseline,
  finalizeResourceRecoveryStepReport,
  type FileLibraryResourceRecoveryProbe,
  type FileLibraryResourceRecoverySnapshot,
} from './file-library-resource-recovery';

function buildSnapshot(
  overrides: Partial<FileLibraryResourceRecoverySnapshot> = {},
): FileLibraryResourceRecoverySnapshot {
  return {
    captured_at: '2026-04-15T10:00:00.000Z',
    evidence_kind: 'afscp_files_api',
    api_processes: [],
    tcp_connections: [],
    ...overrides,
  };
}

function buildProbe(
  overrides: Partial<FileLibraryResourceRecoveryProbe> = {},
): FileLibraryResourceRecoveryProbe {
  return {
    step: 'file-library-real-smoke',
    notes: [],
    cleanup_probe_errors: [],
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
  it('keeps runtime recovery evidence on AFSCP Files API truth instead of retired gateway or mount helpers', () => {
    const source = readFileSync('scripts/file-library-resource-recovery.ts', 'utf8');

    expect(source).toContain("evidence_kind: 'afscp_files_api'");
    expect(source).not.toContain('juicefs-orphan-preflight');
    expect(source).not.toContain('file-library-gateway');
    expect(source).not.toContain('gateway_state');
    expect(source).not.toContain('managed_gateway');
    expect(source).not.toContain('mounted_task_mounts');
    expect(source).not.toContain('findmnt');
  });

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
    const report = buildStartupResourceRecoveryReport({
      bootBaseline: buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      }),
      readyBaseline: buildSnapshot({
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
      }),
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
    const report = buildStartupResourceRecoveryReport({
      bootBaseline: buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      }),
      readyBaseline: buildSnapshot({
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
      }),
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
      writeJsonFile(bootBaselinePath, buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      }));
      writeJsonFile(startupCandidatePath, buildSnapshot({
        captured_at: '2026-04-15T09:59:00.000Z',
        api_processes: [
          {
            pid: 42001,
            label: 'api-entry',
            open_fd_count: 24,
            socket_fd_count: 6,
          },
        ],
      }));

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

  it('fails startup verification when the api never reaches ready even if startup resources stay within allowance', () => {
    const report = buildStartupResourceRecoveryReport({
      bootBaseline: buildSnapshot({
        captured_at: '2026-04-15T09:55:00.000Z',
      }),
      readyBaseline: buildSnapshot({
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
      }),
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

  it('passes when the Files API runtime state returns to the ready baseline', () => {
    const baseline = buildSnapshot({
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

    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline,
      current: baseline,
      probe: buildProbe(),
    });

    expect(report.status).toBe('pass');
    expect(report.findings).toEqual([]);
  });

  it('fails when api resource truth grows beyond the ready baseline', () => {
    const baseline = buildSnapshot({
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
          remote_port: 19000,
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
        'tcp connection count grew beyond the baseline after file-library-real-smoke for api-entry -> 127.0.0.1:19000 [ESTABLISHED]: expected <= 1, found 2',
        'unexpected tcp connections remained after file-library-real-smoke: api-entry -> 127.0.0.1:19000 [CLOSE_WAIT] x1',
      ]),
    );
  });

  it('fails closed when the generic cleanup probe cannot prove cleanup', () => {
    const report = compareResourceRecoveryBaseline({
      step: 'file-library-real-smoke',
      baseline: buildSnapshot(),
      current: buildSnapshot(),
      probe: buildProbe({
        cleanup_probe_errors: [
          'ss is required to capture tcp connection truth but was not found',
        ],
      }),
    });

    expect(report.status).toBe('fail');
    expect(report.findings).toContain(
      'resource cleanup probe could not prove cleanup after file-library-real-smoke: ss is required to capture tcp connection truth but was not found',
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
      step: 'file-library-real-smoke',
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
      step: 'file-library-real-smoke',
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
          step: 'task-home-binding-smoke',
          baseline: buildSnapshot({
            api_processes: [
              {
                pid: 42001,
                label: 'api-entry',
                open_fd_count: 24,
                socket_fd_count: 6,
              },
            ],
          }),
          current: buildSnapshot(),
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
      { step: 'task-home-binding-smoke', status: 'fail' },
    ]);
    expect(summary.findings).toContain(
      'baseline api process labels disappeared after task-home-binding-smoke: api-entry',
    );
    expect(summary.markdown).toContain('# File Library AFSCP Files API Resource Recovery Report');
    expect(summary.markdown).toContain('- overall_status: fail');
    expect(summary.markdown).toContain('- evidence_kind: afscp_files_api');
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
