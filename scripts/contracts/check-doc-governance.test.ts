import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findEngineeringIndexCurrentSectionViolations,
  findReleaseKitSplitKissPlanViolations,
  isHistoricalDoc,
} from './check-doc-governance';

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
      'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
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

    const historicalPlan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/agentsmith-sandbox-control-plane-release-independence-plan-v1.md'),
      'utf8',
    );
    expect(historicalPlan).toContain('本文件降级为历史迁移计划与 AgentSmith consumer-side 边界说明');
    expect(historicalPlan).toContain('当前 AgentSmith producer 只报告 absence');
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

  it('flags release-kit split plan text that upgrades P6-lite docs cleanup to heavy sign-off', () => {
    const violations = findReleaseKitSplitKissPlanViolations(
      [
        '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
        '',
        '当前 active 正文只维护当前边界、下一步、阻断项和验收；历史 evidence 进入 archive/reference。',
        '本补充不写入 `docs/项目宪法.md`。',
        '主协调 agent 只分配/验收，实际修改由 worker TDD 完成。',
        'formal operator adoption verdict 仍未完成。',
        '',
        '### P6. 清理和防回流',
        '',
        'P6-lite 文档/旧引用归档清理继续推进。',
        '',
        '验收：',
        '- AgentSmith product readiness 收口跑 `npm run release:ready`。',
        '',
        '## 9. 发布模式',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'p6-lite-heavy-release-ready-default' }),
        expect.objectContaining({ rule: 'heavy-formal-operator-verdict-default' }),
      ]),
    );
  });

  it('flags P6-lite release:ready default even when the section includes the allowed escalation exception', () => {
    const violations = findReleaseKitSplitKissPlanViolations(
      [
        '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
        '',
        '当前 active 正文只维护当前边界、下一步、阻断项和验收；历史 evidence 应进入 archive/reference。',
        '本补充不写入 `docs/项目宪法.md`。',
        '主协调 agent 只分配/验收，实际修改由 worker TDD 完成。',
        'pre-GA 默认先做 scoped operator runbook acceptance / unsigned scoped evidence；签名身份或全四象限 GA verdict 只有明确客户/合规/GA 发布要求时才进入。',
        '',
        '### P6. 清理和防回流',
        '',
        'P6-lite 文档/旧引用清理默认使用 doc/static guard + targeted contracts；只有改 release/runtime/product readiness 路径才升级到 `npm run release:ready` 或发布级重门禁。',
        '',
        '验收：',
        '- P6-lite 文档/旧引用归档清理收口跑 `npm run release:ready`。',
        '',
        '## 9. 发布模式',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'p6-lite-heavy-release-ready-default' }),
      ]),
    );
  });

  it('flags P6-lite release:ready default when the same bullet also has an allowed escalation exception', () => {
    const violations = findReleaseKitSplitKissPlanViolations(
      [
        '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
        '',
        '### P6. 清理和防回流',
        '',
        '- P6-lite 默认收口跑 `npm run release:ready`；只有改 release/runtime/product readiness 才升级到 `npm run release:ready`。',
        '',
        '## 9. 发布模式',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'p6-lite-heavy-release-ready-default' }),
      ]),
    );
  });

  it('flags formal operator adoption verdict defaults even when the GA trigger sentence is present', () => {
    const violations = findReleaseKitSplitKissPlanViolations(
      [
        '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
        '',
        '当前 active 正文只维护当前边界、下一步、阻断项和验收；历史 evidence 应进入 archive/reference。',
        '本补充不写入 `docs/项目宪法.md`。',
        '主协调 agent 只分配/验收，实际修改由 worker TDD 完成。',
        'pre-GA 默认先做 scoped operator runbook acceptance / unsigned scoped evidence；签名身份或全四象限 GA verdict 只有明确客户/合规/GA 发布要求时才进入。',
        '',
        '当前真实下一步：',
        '- 推进 formal operator adoption verdict，作为 P6-lite 之后的默认收口项。',
        '',
        '### P6. 清理和防回流',
        '',
        'P6-lite 文档/旧引用清理默认使用 doc/static guard + targeted contracts；只有改 release/runtime/product readiness 路径才升级到 `npm run release:ready` 或发布级重门禁。',
        '',
        '## 9. 发布模式',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'heavy-formal-operator-verdict-default' }),
      ]),
    );
  });

  it('flags formal operator adoption verdict default when the same bullet also has an allowed GA trigger', () => {
    const violations = findReleaseKitSplitKissPlanViolations(
      [
        '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
        '',
        '当前真实下一步：',
        '- 推进 `formal operator adoption verdict` 作为默认收口项；只有客户/合规/GA 要求才进入。',
        '',
        '### P6. 清理和防回流',
        '',
        'P6-lite 文档/旧引用清理默认使用 doc/static guard + targeted contracts；只有改 release/runtime/product readiness 路径才升级到 `npm run release:ready` 或发布级重门禁。',
        '',
        '## 9. 发布模式',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'heavy-formal-operator-verdict-default' }),
      ]),
    );
  });

  it('allows semantically equivalent KISS wording without pinning exact prose', () => {
    const plan = [
      '# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1',
      '',
      'Active plan 读法：',
      '',
      '1. 当前正文只放当前边界、后续动作、阻断项与验收口径；旧证据统一转为 archive/reference 链接，不在 active plan 里继续堆矩阵。',
      '2. 本轮只在本计划记录治理克制，不把 release-kit / runner split 的执行约束新增到 `docs/项目宪法.md`。',
      '3. 协调者负责拆分任务和验收结果，具体改动由 worker 用先测后改的方式完成。',
      '4. pre-GA operator acceptance 先采用 scoped runbook acceptance 或 unsigned scoped evidence；只有客户、合规或 GA 发布明确要求时，才进入签名身份或全四象限正式 verdict。',
      '5. P6-lite 文档和旧引用归档只跑 doc/static guard 与 targeted contracts；`npm run release:ready` 仅限 release、runtime 或 product readiness 路径发生变更时升级使用。',
      '',
      '## 治理克制记录',
      '',
      '本计划没有把治理克制要求写入或新增到 `docs/项目宪法.md`。',
      '',
      '### P6. 清理和防回流',
      '',
      'P6-lite 文档/旧引用归档清理继续推进。',
      '',
      '验收：',
      '- 使用 `npm run contracts:check-doc-governance` 和 targeted contracts 收口文档/静态边界。',
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
