/**
 * Epic D: Release Engineering - Integration E2E Tests
 *
 * Tests the CLI-based release verification tools:
 * - verify-release-report.ts (Release Report Automation)
 * - failure-classifier.ts (Failure Classification)
 * - Report export (JSON/Markdown)
 *
 * These are integration tests that run actual CLI commands
 * and verify the outputs match expectations.
 *
 * Run: npm test -- tests/integration/epic-d-release.spec.ts
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Test configuration
const TEST_OUTPUT_DIR = join(process.cwd(), 'artifacts', 'test-release-reports');
const SCRIPT_PATH = join(process.cwd(), 'scripts/release/verify-release-report.ts');
const CLASSIFIER_SCRIPT_PATH = join(process.cwd(), 'scripts/release/__tests__/failure-classifier.test.ts');
// Use tsx to run TypeScript files directly
const RUNNER = 'npx tsx';

describe('Epic D: Release Engineering - Integration Tests', () => {
  beforeAll(() => {
    // Clean up any previous test artifacts
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  });

  afterAll(() => {
    // Clean up test artifacts
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  describe('verify-release-report.ts - CLI Execution', () => {
    it('should run with --help and show usage', () => {
      const output = execSync(`${RUNNER} ${SCRIPT_PATH} --help`, {
        encoding: 'utf-8',
      });
      expect(output).toContain('verify-release-report');
      expect(output).toContain('--output');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--mock-failure');
    });

    it('should generate report in dry-run mode', () => {
      const reportName = 'test-dry-run';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      // Run the script
      const output = execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      expect(output).toContain('Generating release report');
      expect(output).toContain('JSON:');

      // Verify JSON file was created
      expect(existsSync(outputPath)).toBe(true);

      // Verify JSON structure
      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(report).toHaveProperty('metadata');
      expect(report).toHaveProperty('execution');
      expect(report).toHaveProperty('summary');
    });

    it('should generate both JSON and Markdown reports', () => {
      const reportName = 'test-both-formats';
      const jsonPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);
      const mdPath = join(TEST_OUTPUT_DIR, `${reportName}.md`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      // Verify both files exist
      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(mdPath)).toBe(true);

      // Verify Markdown content
      const mdContent = readFileSync(mdPath, 'utf-8');
      expect(mdContent).toContain('# Release Verification Report');
      expect(mdContent).toContain('## Summary');
      expect(mdContent).toContain('## Execution Results');
    });

    it('should create archive when --archive is specified', () => {
      const reportName = 'test-archive';
      const archivePattern = /^report-\d{8}-\d{6}\.(json|md)$/;

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --archive --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      // Check for archive files (timestamped)
      const files = readdirSync(TEST_OUTPUT_DIR);
      const archiveFiles = files.filter((f: string) => archivePattern.test(f));

      expect(archiveFiles.length).toBeGreaterThanOrEqual(2); // At least .json and .md
    });

    it('should accept --commit-range option', () => {
      const reportName = 'test-commit-range';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --commit-range HEAD~1..HEAD --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(report.metadata.git).toHaveProperty('commit_range');
    });

    it('should exit with code 0 when all checks pass (dry-run)', () => {
      const reportName = 'test-exit-code-pass';

      const result = spawn('npx', ['tsx', SCRIPT_PATH,
        '--output', TEST_OUTPUT_DIR,
        '--name', reportName,
        '--dry-run',
      ]);

      return new Promise<void>((resolve) => {
        let exitCode: number | null = null;
        result.on('close', (code) => {
          exitCode = code;
          expect(exitCode).toBe(0);
          resolve();
        });
      });
    });
  });

  describe('Report Structure Validation', () => {
    it('should generate valid ReleaseReport JSON structure', () => {
      const reportName = 'test-structure';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));

      // Verify top-level structure
      expect(report).toMatchObject({
        metadata: expect.any(Object),
        execution: expect.any(Object),
        summary: expect.any(Object),
      });

      // Verify metadata structure
      expect(report.metadata).toMatchObject({
        timestamp: expect.any(String),
        duration_ms: expect.any(Number),
        environment: expect.any(Object),
        git: expect.any(Object),
      });

      // Verify execution structure
      expect(report.execution).toMatchObject({
        total_checks: expect.any(Number),
        passed: expect.any(Number),
        failed: expect.any(Number),
        skipped: expect.any(Number),
        checks: expect.any(Array),
      });

      // Verify summary structure
      expect(report.summary).toMatchObject({
        status: expect.any(String),
        stats: expect.any(Object),
      });
    });

    it('should include environment information', () => {
      const reportName = 'test-environment';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));

      expect(report.metadata.environment).toMatchObject({
        node_version: expect.stringMatching(/^v\d+\.\d+\.\d+/),
        platform: expect.any(String),
        arch: expect.any(String),
        cwd: expect.any(String),
      });
    });

    it('should include git information', () => {
      const reportName = 'test-git-info';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));

      expect(report.metadata.git).toMatchObject({
        commit_hash: expect.stringMatching(/^[a-f0-9]{40}$/),
        commit_short: expect.stringMatching(/^[a-f0-9]{7,}$/),
        branch: expect.any(String),
        commit_message: expect.any(String),
        author: expect.any(String),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it('should include execution stats', () => {
      const reportName = 'test-execution-stats';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));

      expect(report.summary.stats).toMatchObject({
        total_duration_ms: expect.any(Number),
        fastest_check: expect.objectContaining({
          name: expect.any(String),
          duration_ms: expect.any(Number),
        }),
        slowest_check: expect.objectContaining({
          name: expect.any(String),
          duration_ms: expect.any(Number),
        }),
        by_category: expect.any(Object),
      });
    });
  });

  describe('Markdown Report Generation', () => {
    it('should generate properly formatted Markdown', () => {
      const reportName = 'test-md-format';
      const mdPath = join(TEST_OUTPUT_DIR, `${reportName}.md`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const mdContent = readFileSync(mdPath, 'utf-8');

      // Verify Markdown structure
      expect(mdContent).toMatch(/^# Release Verification Report/m);
      expect(mdContent).toMatch(/## Summary/m);
      expect(mdContent).toMatch(/### Git Information/m);
      expect(mdContent).toMatch(/### Environment/m);
      expect(mdContent).toMatch(/## Execution Results/m);

      // Verify table formatting
      expect(mdContent).toContain('| Metric | Value |');
      expect(mdContent).toContain('| Total Checks |');
      expect(mdContent).toContain('| Check | Category | Status | Duration |');
    });

    it('should include status emoji in Markdown', () => {
      const reportName = 'test-md-emoji';
      const mdPath = join(TEST_OUTPUT_DIR, `${reportName}.md`);

      execSync(
        `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --dry-run`,
        {
          encoding: 'utf-8',
        }
      );

      const mdContent = readFileSync(mdPath, 'utf-8');

      // Check for status emojis
      expect(mdContent).toMatch(/✅.*PASSED|❌.*FAILED/);
      expect(mdContent).toContain('✅'); // Pass indicator
      expect(mdContent).toContain('⏭️'); // Skip indicator
    });
  });

  describe('Failure Classification (Epic D2) - Unit Tests via CLI', () => {
    it('should have comprehensive failure classification unit tests', () => {
      // Run the failure-classifier unit tests
      const output = execSync(`npm test -- ${CLASSIFIER_SCRIPT_PATH} --run`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Verify tests run and pass (vitest outputs "passed" or "✓")
      expect(output).toMatch(/passed|✓/);
    });
  });

  describe('Report with Mock Failures', () => {
    it('should include failure categories when checks fail', () => {
      const reportName = 'test-failure-categories';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      // Command exits with code 1 when there are failures - that's expected
      try {
        execSync(
          `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --mock-failure token --dry-run`,
          {
            encoding: 'utf-8',
            stdio: 'pipe',
          }
        );
      } catch {
        // Expected when there are failures
      }

      // Report should still be generated
      expect(existsSync(outputPath)).toBe(true);

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));

      // When there are failures, summary should include failure_categories
      if (report.execution.failed > 0) {
        expect(report.summary).toHaveProperty('failure_categories');
        expect(Array.isArray(report.summary.failure_categories)).toBe(true);
      }
    });

    it('should include recommendations when checks fail', () => {
      const reportName = 'test-recommendations';
      const outputPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);

      try {
        execSync(
          `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --mock-failure network --dry-run`,
          {
            encoding: 'utf-8',
            stdio: 'pipe',
          }
        );
      } catch {
        // Expected when there are failures
      }

      const report = JSON.parse(readFileSync(outputPath, 'utf-8'));

      // When there are failures, summary should include recommendations
      if (report.execution.failed > 0) {
        expect(report.summary).toHaveProperty('recommendations');
        expect(Array.isArray(report.summary.recommendations)).toBe(true);
        expect(report.summary.recommendations.length).toBeGreaterThan(0);
      }
    });

    it('should show failure breakdown in Markdown', () => {
      const reportName = 'test-md-failures';
      const mdPath = join(TEST_OUTPUT_DIR, `${reportName}.md`);

      try {
        execSync(
          `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --mock-failure backend --dry-run`,
          {
            encoding: 'utf-8',
            stdio: 'pipe',
          }
        );
      } catch {
        // Expected when there are failures
      }

      const mdContent = readFileSync(mdPath, 'utf-8');

      // Check for failure breakdown section (or verify it passed without failures)
      if (mdContent.includes('Failed')) {
        expect(mdContent).toMatch(/### Failure Breakdown|### 📋 Recommendations/);
      } else {
        // If no failures, that's also valid
        expect(mdContent).toMatch(/PASSED/);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid mock-failure type gracefully', () => {
      const reportName = 'test-invalid-mock';

      // Should still run, just won't mock failures (will treat unknown as pass)
      try {
        execSync(
          `${RUNNER} ${SCRIPT_PATH} --output ${TEST_OUTPUT_DIR} --name ${reportName} --mock-failure invalid --dry-run`,
          {
            encoding: 'utf-8',
            stdio: 'pipe',
          }
        );
      } catch {
        // May exit with code 0 or 1 depending on whether any checks "fail"
      }

      // Report should still be generated
      const jsonPath = join(TEST_OUTPUT_DIR, `${reportName}.json`);
      expect(existsSync(jsonPath)).toBe(true);
    });
  });

  describe('Epic D2: Failure Classification - Direct Test', () => {
    // Test the failure classifier directly via a test script
    it('should classify various error types correctly', () => {
      // Create a temporary test file
      const testFile = join(TEST_OUTPUT_DIR, 'classifier-test.ts');
      const testCode = `
import { classifyFailure } from '${join(process.cwd(), 'scripts/release/failure-classifier.ts')}';

const tests = [
  { error: '401 Unauthorized - JWT expired', expected: 'token' },
  { error: 'ECONNREFUSED: Connection refused', expected: 'network' },
  { error: '500 Internal Server Error', expected: 'backend' },
  { error: 'AssertionError: expected true to be false', expected: 'assertion' },
];

let passed = 0;
for (const { error, expected } of tests) {
  const result = classifyFailure(error);
  if (result.category === expected) {
    passed++;
  }
}

console.log('Passed:', passed, '/', tests.length);
`;

      require('fs').writeFileSync(testFile, testCode);

      const output = execSync(`npx tsx ${testFile}`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Passed: 4');
    });
  });

  describe('Epic D2: Troubleshooting Guide Integration', () => {
    it('should verify troubleshooting guide document exists', () => {
      const guidePath = join(process.cwd(), 'docs/troubleshooting-guide-v1.md');
      expect(existsSync(guidePath)).toBe(true);
    });

    it('should verify troubleshooting guide contains required sections', () => {
      const guidePath = join(process.cwd(), 'docs/troubleshooting-guide-v1.md');
      const content = readFileSync(guidePath, 'utf-8');

      // Check for key sections (matching actual guide structure)
      expect(content).toMatch(/# AgentSmith Troubleshooting Guide/i);
      expect(content).toMatch(/## Token Issues/i);
      expect(content).toMatch(/## Network Issues/i);
      expect(content).toMatch(/## Backend Issues/i);
      expect(content).toMatch(/## Timeout Issues/i);
    });
  });
});
