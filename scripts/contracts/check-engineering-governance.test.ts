import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  it('guards the v3 release simplification plan against precheck API/Web cross-stage handoff', () => {
    const plan = readFileSync('docs/engineering/governance-release-flow-simplification-plan-v3.md', 'utf8');

    expect(plan).toContain('本轮不做 precheck API/Web 到 `gate-release` 的跨阶段 handoff/复用');
    expect(plan).toContain('precheck 成功后仍停止 API/Web');
    expect(plan).toContain('`gate-release` 内 backend-real 父流程启动 release-owned API/Web/deps');
    expect(plan).toContain('Browser trace 子检查符合 ownership truth 时不得重复启动 API/Web/deps');
    expect(plan).toContain('不对 Agent Task、Files、AFSCP 等重状态路径宣称复用');
    expect(plan).not.toContain('同一次发布前总检查中，API/Web 启动次数不超过 1');
    expect(plan).not.toContain('后续步骤可以读取同一次命令内的运行状态描述以避免重复启动');
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
