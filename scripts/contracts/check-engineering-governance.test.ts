import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKFLOW_SURFACE_DOC_PATHS,
  findInternalWorkflowReferenceViolations,
} from './engineering-governance-doc-guard';

const HISTORICAL_UNIFIED_DEPLOY_MILESTONE_BASENAME =
  'agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md';
const GA_RELEASE_PLAN_PATH = 'docs/engineering/agentsmith-ga-release-plan-v1.md';

describe('check-engineering-governance contract', () => {
  it('guards README as part of the human workflow surface', () => {
    expect(DEFAULT_WORKFLOW_SURFACE_DOC_PATHS).toContain('README.md');
  });

  it('flags internal workflow commands in fenced code blocks outside diagnostic context', () => {
    const violations = findInternalWorkflowReferenceViolations({
      relativePath: 'docs/user-guides/release-readiness-checklist.md',
      content: [
        '# Release checklist',
        '',
        '### Clean Human Entrypoints',
        '',
        '```bash',
        'npm run product:ready',
        'npm run test:unified-deploy:local-kind',
        '```',
        '',
      ].join('\n'),
    });

    expect(violations).toEqual([
      expect.objectContaining({
        relativePath: 'docs/user-guides/release-readiness-checklist.md',
        lineNumber: 7,
        command: 'npm run test:unified-deploy:local-kind',
      }),
    ]);
  });

  it('allows internal workflow commands when the surrounding documentation is diagnostic', () => {
    const violations = findInternalWorkflowReferenceViolations({
      relativePath: 'README.md',
      content: [
        '# README',
        '',
        '### Maintainer Troubleshooting',
        '',
        '```bash',
        'npm run test:unified-deploy:local-kind',
        '```',
        '',
        'Owner diagnostics return to `npm run product:ready` for product-side readiness / handoff sign-off.',
      ].join('\n'),
    });

    expect(violations).toEqual([]);
  });

  it('allows internal workflow commands when explicitly marked as maintainer diagnostics', () => {
    const violations = findInternalWorkflowReferenceViolations({
      relativePath: 'docs/testing/diagnostic-catalog-v1.md',
      content: [
        '# Diagnostic catalog',
        '',
        '### Maintainer Diagnostics',
        '',
        'Use only when an owner runbook points here.',
        '',
        '```bash',
        'npm run test:unified-deploy:local-kind',
        '```',
        '',
      ].join('\n'),
    });

    expect(violations).toEqual([]);
  });

  it('keeps the historical unified deploy milestone out of active release-boundary scans', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts/contracts/check-engineering-governance.ts'),
      'utf8',
    );

    expect(source).not.toContain(HISTORICAL_UNIFIED_DEPLOY_MILESTONE_BASENAME);
    expect(source).not.toContain('unifiedDeployMilestonePlan');
  });

  it('uses the GA release plan in active release-boundary scans while keeping split plan reference-scoped', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts/contracts/check-engineering-governance.ts'),
      'utf8',
    );
    const currentReleaseBoundaryDocsBlock = source.match(/const currentReleaseBoundaryDocs = \[[\s\S]*?\]\.join\('\\n'\);/u)?.[0] ?? '';

    expect(source).toContain(`read('${GA_RELEASE_PLAN_PATH}')`);
    expect(currentReleaseBoundaryDocsBlock).toContain('gaReleasePlan');
    expect(currentReleaseBoundaryDocsBlock).not.toContain('releaseKitSplitPlan');
  });

  it('rejects internal workflow commands presented as a default command directory', () => {
    const violations = findInternalWorkflowReferenceViolations({
      relativePath: 'README.md',
      content: [
        '# README',
        '',
        '### Default Command Directory',
        '',
        '```bash',
        'npm run test:unified-deploy:local-kind',
        '```',
        '',
      ].join('\n'),
    });

    expect(violations).toEqual([
      expect.objectContaining({
        relativePath: 'README.md',
        lineNumber: 6,
        command: 'npm run test:unified-deploy:local-kind',
      }),
    ]);
  });

  it('passes against the active governance and product terminology docs', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-engineering-governance.ts'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
