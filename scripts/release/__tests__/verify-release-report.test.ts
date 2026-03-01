/**
 * TDD Tests for Release Report Automation (Epic D1)
 *
 * These tests verify that the release verification script generates
 * structured reports (JSON + Markdown) with all required information.
 *
 * RED-GREEN-REFACTOR sequence:
 * 1. RED: Write failing test first
 * 2. GREEN: Write minimal code to pass
 * 3. REFACTOR: Clean up
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT_PATH = join(__dirname, '../verify-release-report.ts');
const OUTPUT_DIR = join(tmpdir(), 'release-reports-test');
const RUNS_OUTPUT_DIR = join(tmpdir(), 'release-runs-test');
const ESCALATIONS_OUTPUT_DIR = join(tmpdir(), 'release-escalations-test');

beforeAll(() => {
  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!existsSync(RUNS_OUTPUT_DIR)) {
    mkdirSync(RUNS_OUTPUT_DIR, { recursive: true });
  }
  if (!existsSync(ESCALATIONS_OUTPUT_DIR)) {
    mkdirSync(ESCALATIONS_OUTPUT_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Clean up output directory
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  if (existsSync(RUNS_OUTPUT_DIR)) {
    rmSync(RUNS_OUTPUT_DIR, { recursive: true, force: true });
  }
  if (existsSync(ESCALATIONS_OUTPUT_DIR)) {
    rmSync(ESCALATIONS_OUTPUT_DIR, { recursive: true, force: true });
  }
});

describe('verify-release-report: TDD Suite', () => {
  // Increase timeout for report generation tests (30 seconds should be enough)
  // Use dry-run mode to avoid running actual smoke tests (which take 14+ seconds and may fail)

  // Configure longer timeout for all tests in this suite
  const originalTimeout = 5000;
  // Note: Vitest testTimeout can be set per test or globally

  describe('RED Phase 1: Report Schema - Required Fields', () => {
    it('should generate JSON report with all required metadata fields', () => {
      // Arrange & Act - use dry-run for fast, predictable testing
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);

      // Assert
      expect(result.exitCode).toBe(0);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Required top-level fields
      expect(report).toHaveProperty('metadata');
      expect(report).toHaveProperty('execution');
      expect(report).toHaveProperty('summary');

      // Required metadata fields
      expect(report.metadata).toHaveProperty('timestamp');
      expect(report.metadata).toHaveProperty('duration_ms');
      expect(report.metadata).toHaveProperty('environment');
      expect(report.metadata).toHaveProperty('git');
    });

    it('should include git commit information in metadata', () => {
      // Arrange & Act
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert - Git fields
      expect(report.metadata.git).toHaveProperty('commit_hash');
      expect(report.metadata.git).toHaveProperty('commit_short');
      expect(report.metadata.git).toHaveProperty('branch');
      expect(report.metadata.git).toHaveProperty('commit_message');
      expect(report.metadata.git).toHaveProperty('author');

      // Verify format
      expect(report.metadata.git.commit_short).toMatch(/^[a-f0-9]{7,}$/);
      expect(typeof report.metadata.git.commit_hash).toBe('string');
    });

    it('should include environment information in metadata', () => {
      // Arrange & Act
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      expect(report.metadata.environment).toHaveProperty('node_version');
      expect(report.metadata.environment).toHaveProperty('platform');
      expect(report.metadata.environment.node_version).toMatch(/^v?\d+\.\d+\.\d+/);
    });

    it('should accept optional commit range parameter', () => {
      // Arrange & Act - use dry-run for fast testing
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--commit-range', 'abc123..def456',
        '--dry-run'
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      expect(report.metadata.git).toHaveProperty('commit_range', 'abc123..def456');
    });

    it('should write release gate run history alongside the report', () => {
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--runs-output', RUNS_OUTPUT_DIR,
        '--escalations-output', ESCALATIONS_OUTPUT_DIR,
        '--name', 'report-test',
        '--dry-run',
        '--trigger', 'manual',
        '--checks', 'typecheck,smoke-governance',
        '--actor-user-id', 'user_owner',
        '--actor-name', 'Owner User',
        '--notes', 'rerun failed checks',
        '--rerun-of-run-id', 'prior-run',
      ]);

      expect(result.exitCode).toBe(0);
      const run = JSON.parse(readFileSync(join(RUNS_OUTPUT_DIR, 'report-test.json'), 'utf-8')) as {
        id?: string;
        report_name?: string;
        trigger?: string;
        total_checks?: number;
        requested_check_ids?: string[];
        actor_user_id?: string;
        actor_name?: string;
        notes?: string;
        rerun_of_run_id?: string;
      };
      expect(run.id).toBe('report-test');
      expect(run.report_name).toBe('report-test');
      expect(run.trigger).toBe('manual');
      expect(run.total_checks).toBeGreaterThan(0);
      expect(run.requested_check_ids).toEqual(['typecheck', 'smoke-governance']);
      expect(run.actor_user_id).toBe('user_owner');
      expect(run.actor_name).toContain('Owner');
      expect(run.notes).toContain('rerun');
      expect(run.rerun_of_run_id).toBe('prior-run');

      const escalation = JSON.parse(readFileSync(join(ESCALATIONS_OUTPUT_DIR, 'report-test.json'), 'utf-8')) as {
        id?: string;
        event_type?: string;
      };
      expect(escalation.id).toBe('report-test');
      expect(['gate_ready', 'gate_warning', 'gate_blocked']).toContain(escalation.event_type);
    });
  });

  describe('RED Phase 2: Execution Results', () => {
    it('should record each check result with status and duration', () => {
      // Arrange & Act
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      expect(report.execution).toHaveProperty('total_checks');
      expect(report.execution).toHaveProperty('passed');
      expect(report.execution).toHaveProperty('failed');
      expect(report.execution).toHaveProperty('checks');

      expect(Array.isArray(report.execution.checks)).toBe(true);
      expect(report.execution.total_checks).toBe(report.execution.checks.length);

      // Each check should have required fields
      report.execution.checks.forEach((check: unknown) => {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('category');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('duration_ms');
        expect(['pass', 'fail', 'skip']).toContain(check.status);
      });
    });

    it('should include output/error for failed checks', () => {
      // Arrange & Act - Simulate a failing scenario
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--dry-run'  // Mock mode for testing
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert - Failed checks should have error details
      const failedChecks = report.execution.checks.filter((c: unknown) => c.status === 'fail');
      failedChecks.forEach((check: unknown) => {
        expect(check).toHaveProperty('error');
        expect(typeof check.error).toBe('string');
        expect(check.error.length).toBeGreaterThan(0);
      });
    });
  });

  describe('RED Phase 3: Summary and Classification', () => {
    it('should generate pass/fail summary based on check results', () => {
      // Arrange & Act
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      expect(report.summary).toHaveProperty('status');
      expect(report.summary).toHaveProperty('release_policy');
      expect(['pass', 'fail']).toContain(report.summary.status);

      // Status should be 'fail' if any checks failed
      if (report.execution.failed > 0) {
        expect(report.summary.status).toBe('fail');
      } else {
        expect(report.summary.status).toBe('pass');
      }
    });

    it('should categorize failures by type', () => {
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--dry-run'
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      if (report.execution.failed > 0) {
        expect(report.summary).toHaveProperty('failure_categories');
        expect(Array.isArray(report.summary.failure_categories)).toBe(true);

        // Each category should have required fields
        report.summary.failure_categories.forEach((cat: unknown) => {
          expect(cat).toHaveProperty('category');
          expect([
            'token', 'network', 'backend', 'assertion', 'timeout',
            'authorization', 'quota', 'rate_limit', 'permission', 'unknown',
          ]).toContain(cat.category);
          expect(cat).toHaveProperty('count');
          expect(cat).toHaveProperty('checks');
          expect(Array.isArray(cat.checks)).toBe(true);
        });
      }
    });

    it('should mark rate-limit failures as acceptable upstream transient', () => {
      runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--mock-failure', 'rate_limit',
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      expect(report.summary.upstream_transient).toBeDefined();
      expect(report.summary.upstream_transient.categories).toContain('rate_limit');
      expect(report.summary.upstream_transient.acceptance).toBe('acceptable_with_retry');
    });

    it('should provide troubleshooting recommendations for failures', () => {
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--dry-run'
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      if (report.execution.failed > 0) {
        expect(report.summary).toHaveProperty('recommendations');
        expect(Array.isArray(report.summary.recommendations)).toBe(true);
        expect(report.summary.recommendations.length).toBeGreaterThan(0);
      }
    });

    it('should attach runtime release evidence to the summary', () => {
      runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'report-test') as {
        summary?: {
          runtime_release_evidence?: {
            source?: string;
            guardrails?: { release_readiness?: string; blockers?: string[]; warnings?: string[] };
            pricing_version_coverage?: { coverage_ratio?: number; total_usage_facts?: number };
            release_candidate?: { release_status?: string; approvals_complete?: boolean };
          };
        };
      };

      expect(report.summary?.runtime_release_evidence).toBeDefined();
      expect(report.summary?.runtime_release_evidence?.source).toBe('dry_run');
      expect(report.summary?.runtime_release_evidence?.guardrails?.release_readiness).toBe('ready');
      expect(report.summary?.runtime_release_evidence?.guardrails?.blockers).toEqual([]);
      expect(report.summary?.runtime_release_evidence?.guardrails?.warnings?.length).toBeGreaterThan(0);
      expect(report.summary?.runtime_release_evidence?.pricing_version_coverage?.total_usage_facts).toBeGreaterThan(0);
      expect(report.summary?.runtime_release_evidence?.pricing_version_coverage?.coverage_ratio).toBeGreaterThan(0);
      expect(report.summary?.runtime_release_evidence?.release_candidate?.release_status).toBe('published');
      expect(report.summary?.runtime_release_evidence?.release_candidate?.approvals_complete).toBe(true);
    });

    it('should attach usage report evidence to the summary', () => {
      runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'report-test') as {
        summary?: {
          usage_report_evidence?: {
            source?: string;
            release_readiness?: string;
            active_schedules?: number;
            required_schedules?: number;
            warnings?: string[];
          };
        };
      };

      expect(report.summary?.usage_report_evidence).toBeDefined();
      expect(report.summary?.usage_report_evidence?.source).toBe('dry_run');
      expect(report.summary?.usage_report_evidence?.release_readiness).toBe('ready');
      expect(report.summary?.usage_report_evidence?.active_schedules).toBeGreaterThan(0);
      expect(report.summary?.usage_report_evidence?.required_schedules).toBeGreaterThan(0);
      expect(report.summary?.usage_report_evidence?.warnings?.length).toBeGreaterThan(0);
    });

    it('should fail when runtime release evidence reports blocked guardrails', () => {
      const runtimeEvidencePath = join(OUTPUT_DIR, 'runtime-evidence-blocked.json');
      const runtimeEvidence = {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        guardrails: {
          target: 'combo:prod-chat',
          release_readiness: 'blocked',
          blockers: ['runtime_guardrail_primary_pricing_missing'],
          warnings: [],
          planned_attempts: 2,
        },
        pricing_version_coverage: {
          total_usage_facts: 2,
          covered_usage_facts: 2,
          missing_usage_facts: 0,
          missing_price_facts: 0,
          coverage_ratio: 1,
        },
      };
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(runtimeEvidencePath, JSON.stringify(runtimeEvidence), 'utf-8');

      runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--dry-run',
        '--runtime-evidence', runtimeEvidencePath,
      ]);

      const report = readJsonReport(OUTPUT_DIR, 'report-test') as {
        summary?: { status?: string; recommendations?: string[] };
      };

      expect(report.summary?.status).toBe('fail');
      expect(report.summary?.recommendations?.some((item) => item.includes('runtime_guardrail_primary_pricing_missing'))).toBe(true);
    });

    it('should fail when usage report evidence is blocked', () => {
      const usageEvidencePath = join(OUTPUT_DIR, 'usage-evidence-blocked.json');
      const usageEvidence = {
        source: 'artifact',
        generated_at: new Date().toISOString(),
        release_readiness: 'blocked',
        blockers: ['usage_report_schedule_unacknowledged:Release Evidence Digest'],
        warnings: [],
        active_schedules: 1,
        required_schedules: 1,
        successful_deliveries_last_7d: 0,
        failed_deliveries_last_7d: 1,
        unacknowledged_required_deliveries: 1,
      };
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(usageEvidencePath, JSON.stringify(usageEvidence), 'utf-8');

      runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--dry-run',
        '--usage-report-evidence', usageEvidencePath,
      ]);

      const report = readJsonReport(OUTPUT_DIR, 'report-test') as {
        summary?: { status?: string; recommendations?: string[] };
      };

      expect(report.summary?.status).toBe('fail');
      expect(report.summary?.recommendations?.some((item) => item.includes('usage_report_schedule_unacknowledged'))).toBe(true);
    });
  });

  describe('RED Phase 4: Markdown Report', () => {
    it('should generate Markdown report alongside JSON', () => {
      // Arrange & Act
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const mdPath = join(OUTPUT_DIR, 'report-test.md');

      // Assert
      expect(existsSync(mdPath)).toBe(true);
      const mdContent = readFileSync(mdPath, 'utf-8');

      // Markdown should contain key sections
      expect(mdContent).toContain('# Release Verification Report');
      expect(mdContent).toContain('## Summary');
      expect(mdContent).toContain('## Execution Results');
      expect(mdContent).toContain('## Metadata');
      expect(mdContent).toContain('### Runtime Release Evidence');
    });

    it('should format markdown with status badges and tables', () => {
      // Arrange & Act
      runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const mdContent = readFileSync(join(OUTPUT_DIR, 'report-test.md'), 'utf-8');

      // Assert - Check for formatted elements
      expect(mdContent).toMatch(/✅|❌|⚠️/);  // Status emojis
      expect(mdContent).toContain('|');       // Table markers
      // Note: dry-run has all passes, so no code blocks are generated
      expect(mdContent).toContain('## Summary');  // Has sections
    });

    it('should be usable as release notes', () => {
      // Arrange & Act
      runScript(['--output', OUTPUT_DIR, '--name', 'report-test', '--dry-run']);
      const mdContent = readFileSync(join(OUTPUT_DIR, 'report-test.md'), 'utf-8');

      // Assert - Release note requirements
      expect(mdContent).toContain('## Summary');           // Executive summary
      expect(mdContent).toContain('Commit:');              // Commit info
      expect(mdContent).toContain('Branch:');              // Branch info
      expect(mdContent).toContain('✅ Passed');            // Pass indicator (uppercase P in markdown)
      expect(mdContent).toContain('❌ Failed');            // Fail indicator (uppercase F in markdown)
    });
  });

  describe('RED Phase 5: CLI Interface', () => {
    it('should support --output flag for custom output directory', () => {
      // Arrange & Act
      const customDir = '/tmp/test-release-reports';
      const result = runScript(['--output', customDir, '--name', 'report-test', '--dry-run']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(customDir, 'report-test.json'))).toBe(true);
    });

    it('should support --name flag for custom report name', () => {
      // Arrange & Act
      const result = runScript(['--output', OUTPUT_DIR, '--name', 'my-release', '--dry-run']);
      const report = readJsonReport(OUTPUT_DIR, 'my-release');

      // Assert
      expect(report).toBeDefined();
    });

    it('should display help with --help flag', () => {
      // Arrange & Act
      const result = runScript(['--help']);

      // Assert
      expect(result.stdout).toContain('verify-release-report');
      expect(result.stdout).toContain('--output');
      expect(result.stdout).toContain('--name');
      expect(result.stdout).toContain('--commit-range');
    });

    it('should archive with one command using --archive flag', () => {
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--archive',
        '--dry-run'
      ]);

      // Assert - Should create timestamped archive
      expect(result.exitCode).toBe(0);
      // Archive file pattern: report-YYYYMMDD-HHMMSS.json
      const files = readdir(OUTPUT_DIR);
      const archiveFile = files.find(f => f.match(/^report-\d{8}-\d{6}\.json$/));
      expect(archiveFile).toBeDefined();
    });
  });

  describe('RED Phase 6: Failure Classification (D2 Preview)', () => {
    it('should classify token-related failures (401/403/expired)', () => {
      // This is a preview for D2 - failure classification
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--mock-failure', 'token'  // Simulated token failure
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      const tokenCategory = report.summary.failure_categories?.find((c: unknown) => c.category === 'token');
      expect(tokenCategory).toBeDefined();
      expect(tokenCategory.count).toBeGreaterThan(0);
    });

    it('should classify network-related failures (timeout/ECONNREFUSED)', () => {
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--mock-failure', 'network'
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      const networkCategory = report.summary.failure_categories?.find((c: unknown) => c.category === 'network');
      expect(networkCategory).toBeDefined();
      expect(networkCategory.count).toBeGreaterThan(0);
    });

    it('should classify assertion failures (test expectations not met)', () => {
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--mock-failure', 'assertion'
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert
      const assertionCategory = report.summary.failure_categories?.find((c: unknown) => c.category === 'assertion');
      expect(assertionCategory).toBeDefined();
      expect(assertionCategory.count).toBeGreaterThan(0);
    });

    it('should provide fix suggestions per failure category', () => {
      // Arrange & Act
      const result = runScript([
        '--output', OUTPUT_DIR,
        '--name', 'report-test',
        '--mock-failure', 'token'
      ]);
      const report = readJsonReport(OUTPUT_DIR, 'report-test');

      // Assert - Recommendations should include specific fixes
      expect(report.summary.recommendations).toBeDefined();
      expect(report.summary.release_policy).toBeDefined();
      const tokenRecommendation = report.summary.recommendations.find((r: string) =>
        r.includes('token') || r.includes('refresh') || r.includes('auth')
      );
      expect(tokenRecommendation).toBeDefined();
      expect(['warning', 'blocked']).toContain(report.summary.release_policy.decision);
    });
  });
});

// Helper functions

interface ScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[] = []): ScriptResult {
  try {
    const stdout = execSync(`npx tsx ${SCRIPT_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    return {
      exitCode: (error as NodeJS.ErrnoException).errno || 1,
      stdout: (error as ExecSyncError).stdout?.toString() || '',
      stderr: (error as ExecSyncError).stderr?.toString() || '',
    };
  }
}

function readJsonReport(outputDir: string, name: string): unknown {
  const path = join(outputDir, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Report file not found: ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function readdir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

interface ExecSyncError extends NodeJS.ErrnoException {
  stdout?: Buffer;
  stderr?: Buffer;
}
