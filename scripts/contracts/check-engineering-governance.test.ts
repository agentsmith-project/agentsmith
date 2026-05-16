import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKFLOW_SURFACE_DOC_PATHS,
  findInternalWorkflowReferenceViolations,
} from './engineering-governance-doc-guard';

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
        'npm run release:ready',
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
        'Owner diagnostics return to `npm run release:ready` for release sign-off.',
      ].join('\n'),
    });

    expect(violations).toEqual([]);
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
