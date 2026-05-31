import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findEngineeringIndexCurrentSectionViolations,
  findReleaseKitSplitKissPlanViolations,
  isHistoricalDoc,
  SUPERSEDED_RELEASE_GOVERNANCE_TOP_LEVEL_DOCS,
} from './check-doc-governance';

const HISTORICAL_UNIFIED_DEPLOY_MILESTONE_BASENAME =
  'agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md';
const HISTORICAL_ASBCP_RELEASE_INDEPENDENCE_PLAN_ACTIVE_PATH =
  'docs/engineering/agentsmith-sandbox-control-plane-release-independence-plan-v1.md';
const HISTORICAL_ASBCP_RELEASE_INDEPENDENCE_PLAN_ARCHIVE_PATH =
  'docs/engineering/archive/agentsmith-sandbox-control-plane-release-independence-plan-v1.md';

function extractSetInitializer(source: string, constName: string): string {
  const match = source.match(new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, 'u'));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('check-doc-governance historical document detection', () => {
  it('allows active Agent task product docs in titles and paths', () => {
    expect(
      isHistoricalDoc(
        'docs/contracts/agent-task-frontend-module-map.md',
        [
          '# Agent Task Frontend Module Map',
          '',
          'This document defines the current module boundary for Agent task list/detail pages.',
          'Status: `current`',
        ].join('\n'),
      ),
    ).toBe(false);

    expect(
      isHistoricalDoc(
        'docs/engineering/agentsmith-chat-agent-runner-evolution-plan-v1.md',
        [
          '# AgentSmith Chat, Agent Tasks, and Agent Runners Target Plan v1',
          '',
          'Status: `current-target`',
        ].join('\n'),
      ),
    ).toBe(false);
  });

  it.each([
    ['docs/engineering/project-handoff-note.md', '# Project Handoff Note'],
    ['docs/engineering/runner-refactor-plan.md', '# Runner cleanup'],
    ['docs/contracts/storage-migration-v1.md', '# Storage Contract'],
    ['docs/engineering/release-retro.md', '# Release Notes'],
    ['docs/engineering/docs-todo.md', '# Documentation Work'],
    ['docs/engineering/phase-2-rollout.md', '# Rollout Notes'],
    ['docs/engineering/archive-index.md', '# Current Notes'],
    ['docs/engineering/redirect-notice.md', '# Current Notes'],
  ])('blocks lifecycle marker in %s', (relativePath, title) => {
    expect(isHistoricalDoc(relativePath, `${title}\n\nStatus: \`current\``)).toBe(true);
  });

  it('blocks historical markers in status and body content', () => {
    expect(isHistoricalDoc('docs/current-target.md', '# Current Target\n\nStatus: `redirect`')).toBe(true);
    expect(isHistoricalDoc('docs/current-target.md', '# Current Target\n\nHistorical handoff note.')).toBe(true);
  });

  it('treats engineering archive and historical_reference status as historical reference docs', () => {
    const movedDocContent = readFileSync(
      resolve(
        process.cwd(),
        'docs/engineering/archive/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
      ),
      'utf8',
    );

    expect(
      isHistoricalDoc(
        'docs/engineering/archive/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
        movedDocContent,
      ),
    ).toBe(true);
    expect(isHistoricalDoc('docs/engineering/current-note.md', '# Current Note\n\nStatus: historical_reference')).toBe(true);
  });

  it('does not classify current target docs as historical just because they forbid compatibility', () => {
    expect(
      isHistoricalDoc(
        'docs/contracts/product-terminology.md',
        '# Product Terminology Contract\n\nPre-GA target contracts do not keep legacy runtime/API compatibility.',
      ),
    ).toBe(false);
  });

  it('states file-library HOME segment handling as pre-GA reset/recreate, not a repair bridge', () => {
    const plan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/agent-task-persistent-home-runtime-plan.md'),
      'utf8',
    );

    expect(plan).toContain('本地开发/测试数据 reset/recreate');
    expect(plan).toContain('缺少 `file_library_home_segment` 的开发/测试配置记录不得在读取时派生或补写字段；删除后重新创建');
    expect(plan).not.toContain('pre-GA 一次性自愈迁移/repair');
    expect(plan).not.toContain('不是长期 silent compatibility');
    expect(plan).not.toContain('不做长期 legacy dual-read');
    expect(plan).not.toContain('不得静默兼容两个 HOME 根');
  });

  it('keeps Agent task runner runbook aligned with the AFSCP Developer runner blocker', () => {
    const runbook = readFileSync(
      resolve(process.cwd(), 'docs/agent-task-runner-runbook.md'),
      'utf8',
    );

    expect(runbook).toContain('Managed runner is the current executable task HOME binding chain.');
    expect(runbook).toContain('Developer runner Slice 5 blocker posture');
    expect(runbook).toContain('no task HOME/file access; fail closed for execution self-check');
    expect(runbook).toContain('upstream blocker/no-workaround evidence');
    expect(runbook).toContain('must not synthesize them from a host-local file-library path');

    expect(runbook).not.toContain('Developer runner self-check / runner-test task 也使用绑定 file library');
    expect(runbook).not.toContain('| Local developer | local-manual, host development | `file_library`');
    expect(runbook).not.toContain('authorized expert creation may send `bound_runner_id` for a Developer runner');
    expect(runbook).not.toContain('managed runner 和 Developer runner 两条 task/terminal/recovery smoke 都有证据');
  });

  it('keeps active ASBCP-facing docs from sending developers back to sibling source or sandbox-manager guidance', () => {
    const activeDocs = [
      'DEVELOPMENT.md',
      'docs/engineering/afscp-file-library-runtime-rearchitecture-plan.md',
      'docs/engineering/internal-agent-terminal-pod-lifecycle-analysis-v1.md',
      'docs/engineering/file-library-version-management-fast-path-plan-v1.md',
    ];

    for (const relativePath of activeDocs) {
      const content = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(content).not.toMatch(/\.\.\/mbos-sandbox-v1|mbos-sandbox-v1/u);
      expect(content).not.toMatch(/\bsandbox-manager\b|\bsandbox manager\b|\bSandbox Manager\b|\bsandbox_manager\b|\b[Ss]andboxManager\b/u);
      expect(content).not.toMatch(/\bSANDBOX_MANAGER[A-Z0-9_]*\b|\bSANDBOX_SOURCE_DIR\b/u);
      expect(content).not.toMatch(/\bsandbox workload\b/iu);
    }

    const development = readFileSync(resolve(process.cwd(), 'DEVELOPMENT.md'), 'utf8');
    expect(development).toContain('ASBCP image/contract');

  });

  it('keeps the historical ASBCP release independence plan in engineering archive only', () => {
    expect(existsSync(resolve(process.cwd(), HISTORICAL_ASBCP_RELEASE_INDEPENDENCE_PLAN_ACTIVE_PATH))).toBe(false);
    expect(existsSync(resolve(process.cwd(), HISTORICAL_ASBCP_RELEASE_INDEPENDENCE_PLAN_ARCHIVE_PATH))).toBe(true);

    const historicalPlan = readFileSync(
      resolve(process.cwd(), HISTORICAL_ASBCP_RELEASE_INDEPENDENCE_PLAN_ARCHIVE_PATH),
      'utf8',
    );

    expect(historicalPlan).toMatch(/Status:\s*`?historical_reference`?/i);
    expect(historicalPlan).toContain('本文件降级为历史迁移计划与 AgentSmith consumer-side 边界说明');
    expect(historicalPlan).toContain('当前 AgentSmith producer 只报告 absence');
    expect(isHistoricalDoc(HISTORICAL_ASBCP_RELEASE_INDEPENDENCE_PLAN_ARCHIVE_PATH, historicalPlan)).toBe(true);
  });

  it('keeps the historical unified deploy milestone out of active ASBCP guidance inputs', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/contracts/check-doc-governance.ts'),
      'utf8',
    );

    expect(extractSetInitializer(source, 'ACTIVE_ASBCP_GUIDANCE_FILES')).not.toContain(
      HISTORICAL_UNIFIED_DEPLOY_MILESTONE_BASENAME,
    );
  });

  it('keeps superseded release-governance plans and work logs in archive only', () => {
    const activeTopLevelDocs = SUPERSEDED_RELEASE_GOVERNANCE_TOP_LEVEL_DOCS.filter((relativePath) => (
      existsSync(resolve(process.cwd(), relativePath))
    ));
    const archivePaths = SUPERSEDED_RELEASE_GOVERNANCE_TOP_LEVEL_DOCS.map((relativePath) => (
      relativePath.replace('docs/engineering/', 'docs/engineering/archive/')
    ));
    const missingArchiveDocs = archivePaths.filter((relativePath) => (
      !existsSync(resolve(process.cwd(), relativePath))
    ));

    expect(activeTopLevelDocs).toEqual([]);
    expect(missingArchiveDocs).toEqual([]);

    for (const relativePath of archivePaths) {
      const content = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(content).toMatch(/Status:\s*`?historical_reference`?/i);
      expect(isHistoricalDoc(relativePath, content)).toBe(true);
    }
  });

  it('keeps the persistent HOME implementation plan from reintroducing Developer local HOME smoke', () => {
    const plan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/agent-task-persistent-home-runtime-plan.md'),
      'utf8',
    );

    expect(plan).toContain('managed runner | 当前可执行 HOME binding 主链');
    expect(plan).toContain('Developer runner | Slice 5 blocked 时只允许连接/存在状态诊断');
    expect(plan).toContain('no local file_library binding');
    expect(plan).toContain('upstream blocker/no-workaround record');

    expect(plan).not.toContain('<developer_task_home_path>');
    expect(plan).not.toContain('managed 和 Developer runner 的 `task_home_path` 都代表');
    expect(plan).not.toContain('Managed and Developer runner echo');
    expect(plan).not.toContain('managed runner 和 Developer runner 都把同一文件库根目录作为');
  });

  it('keeps same-actor task workspace reuse decoupled from Files edit permission', () => {
    const plan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/agent-task-persistent-home-runtime-plan.md'),
      'utf8',
    );
    const afscpPlan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/afscp-file-library-runtime-rearchitecture-plan.md'),
      'utf8',
    );
    const combined = `${plan}\n${afscpPlan}`;

    expect(plan).toContain('自己已释放、ready、unbound 的 task workspace，而不是 Files 编辑权限');
    expect(plan).toContain('不要求 `project:files:update`');
    expect(plan).toContain('Files UI 直接 edit/upload/move/delete 仍由 `project:files:update` 单独门禁');
    expect(afscpPlan).toContain(
      'backend runtime writable affordance is `task_internal_home`, not Files edit permission',
    );

    expect(combined).not.toContain('cannot bind an existing library without `project:files:update`');
    expect(combined).not.toContain(
      '`use_existing` 时校验文件库 `ready`、project 边界、`project:files:update`',
    );
    expect(combined).not.toContain(
      'Bind existing file library to task | `project:agent_task:use` plus `project:files:update`',
    );
  });

  it('flags handoff/refactor/migration entries in the engineering current index section', () => {
    const violations = findEngineeringIndexCurrentSectionViolations(
      [
        '# Engineering Docs Index',
        '',
        'Current guidance and implementation plans:',
        '- [Current Engineering Governance Model](../current-engineering-governance-model.md)',
        '- [Agent Task Handoff Plan](./agent-task-handoff-plan.md) - `handoff_plan_ready`; next implementation handoff',
        '',
        'Decision-required analyses:',
        '- [Internal Agent Terminal Pod Lifecycle Analysis v1](./internal-agent-terminal-pod-lifecycle-analysis-v1.md)',
      ].join('\n'),
    );

    expect(violations).toEqual([
      expect.objectContaining({
        file: 'docs/engineering/README.md',
        line: 5,
        rule: 'historical-doc-current-index-entry',
      }),
    ]);
  });

  it('keeps the engineering current index free of handoff/refactor/migration entries', () => {
    const index = readFileSync(
      resolve(process.cwd(), 'docs/engineering/README.md'),
      'utf8',
    );

    expect(findEngineeringIndexCurrentSectionViolations(index)).toEqual([]);
  });

  it('flags positive split-plan instructions to update the project constitution', () => {
    const violations = findReleaseKitSplitKissPlanViolations(
      [
        '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
        '',
        '治理克制需要写入 `docs/项目宪法.md`，作为 release-kit / runner split 的长期条款。',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'constitution-governance-expansion' }),
      ]),
    );
  });

  it('allows normal KISS wording without pinning exact prose', () => {
    const plan = [
      '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
      '',
      'Active plan 读法：',
      '',
      '1. 当前正文只放当前边界、后续动作、阻断项与验收口径；旧证据统一转为 archive/reference 链接，不在 active plan 里继续堆矩阵。',
      '2. 本轮只在本计划记录治理克制，不把 release-kit / runner split 的执行约束新增到 `docs/项目宪法.md`。',
      '3. 协调者负责拆分任务和验收结果，具体改动由 worker 用先测后改的方式完成。',
      '4. pre-GA operator acceptance 先采用 scoped runbook acceptance 或 unsigned scoped evidence；只有客户、合规或 GA 发布明确要求时，才进入签名身份或全四象限正式 verdict。',
      '',
      '## 治理克制记录',
      '',
      '本计划没有把治理克制要求写入或新增到 `docs/项目宪法.md`。',
      '',
    ].join('\n');

    expect(findReleaseKitSplitKissPlanViolations(plan)).toEqual([]);
  });

  it('allows conditional release:ready wording instead of parsing P6-lite policy semantics', () => {
    const plan = [
      '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
      '',
      '本补充不写入 `docs/项目宪法.md`。',
      '',
      '### P6. 清理和防回流',
      '',
      'P6-lite 文档/旧引用清理默认使用 doc/static guard；如果本切片同时改 release/runtime/product readiness 路径，再跑 `npm run product:ready`。',
      '',
      '## 9. 发布模式',
    ].join('\n');

    expect(findReleaseKitSplitKissPlanViolations(plan)).toEqual([]);
  });

  it('allows conditional formal operator wording instead of parsing adoption verdict semantics', () => {
    const plan = [
      '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
      '',
      '本补充不写入 `docs/项目宪法.md`。',
      '',
      '当前真实下一步：',
      '- formal operator adoption verdict 仍未完成；只有客户/合规/GA 发布要求时才进入，不作为本轮默认下一步。',
      '',
      '### P6. 清理和防回流',
      '',
      '## 9. 发布模式',
    ].join('\n');

    expect(findReleaseKitSplitKissPlanViolations(plan)).toEqual([]);
  });

  it('keeps the active release-kit split plan aligned with P6-lite KISS constraints', () => {
    const plan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md'),
      'utf8',
    );

    expect(findReleaseKitSplitKissPlanViolations(plan)).toEqual([]);
  });
});
