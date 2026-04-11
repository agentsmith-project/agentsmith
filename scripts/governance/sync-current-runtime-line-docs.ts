import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_RUNTIME_SHARED_RULES,
  listCurrentLocalRuntimeLines,
  type CurrentRuntimeLineDefinition,
} from './current-runtime-line-manifest';

const ROOT = process.cwd();
type Mode = 'write' | 'check';

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function write(relativePath: string, content: string): void {
  writeFileSync(path.join(ROOT, relativePath), content, 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceBlock(content: string, startMarker: string, endMarker: string, nextBlock: string): string {
  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  if (!pattern.test(content)) {
    throw new Error(`generated_block_not_found:${startMarker}`);
  }
  return content.replace(pattern, `${startMarker}\n${nextBlock}\n${endMarker}`);
}

function renderRuleList(): string[] {
  return CURRENT_RUNTIME_SHARED_RULES.map((rule) => `- ${rule.summary}`);
}

function renderRuleListZh(): string[] {
  return [
    '- 本机共享一套 substrate，`local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用它。',
    '- 同一时间只允许一条本地工作线处于 active；切换前先停掉或 reset 当前工作线。',
    '- `demo-rehearsal` 和 `cluster-rehearsal` 都拥有自己的 scenario-owned local kind world 与 local registry，不再共用一个泛化本地集群。',
    '- rehearsal 线负责在开发机上排演 release 路径；deploy 线负责目标主机上的正式发布。',
  ];
}

function renderLocalFlowList(lines: readonly CurrentRuntimeLineDefinition[]): string[] {
  return lines.map((line) => {
    const kindSuffix = line.localKindClusterName && line.localRegistryName
      ? ` Uses \`${line.localKindClusterName}\` / \`${line.localRegistryName}\`.`
      : '';
    return `- \`${line.formalName}\` — ${line.primaryUse}${kindSuffix}`;
  });
}

function renderLocalFlowListZh(lines: readonly CurrentRuntimeLineDefinition[]): string[] {
  return lines.map((line) => {
    switch (line.id) {
      case 'local-manual':
        return '- `local-manual` — 日常开发、真实后端手测、notebook / runner 主链手测。';
      case 'demo-rehearsal':
        return '- `demo-rehearsal` — demo 发布线的本机排演入口，使用 `agentsmith-demo` / `agentsmith-demo-registry`。';
      case 'cluster-rehearsal':
        return '- `cluster-rehearsal` — cluster 发布线的本机排演入口，使用 `agentsmith-cluster` / `agentsmith-cluster-registry`。';
      default:
        return `- \`${line.formalName}\` — ${line.primaryUse}`;
    }
  });
}

function renderReadmeRuntimeBlock(): string {
  return [
    'Current runtime-line truth:',
    '- Human guides: [Runtime Lines Matrix](./docs/user-guides/runtime-lines-matrix.md) and [Local Runtime Flows](./docs/user-guides/local-runtime-flows.md)',
    '- Machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)',
    '',
    'Current local runtime baseline:',
    ...renderRuleList(),
    '',
    'Current local flows:',
    ...renderLocalFlowList(listCurrentLocalRuntimeLines()),
    '',
    'Use `Local Runtime Flows` for local commands and switching. Use the deploy runbooks for target-host release steps.',
  ].join('\n');
}

function renderDevelopmentRuntimeBlock(): string {
  return [
    '当前 runtime-line 真相：',
    '- 人类入口：[`Runtime Lines Matrix`](./docs/user-guides/runtime-lines-matrix.md) 与 [`Local Runtime Flows`](./docs/user-guides/local-runtime-flows.md)',
    '- machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)',
    '',
    '当前本机基线：',
    ...renderRuleListZh(),
    '',
    '当前本机工作线：',
    ...renderLocalFlowListZh(listCurrentLocalRuntimeLines()),
    '',
    '本文件只保留开发/排障入口；具体运行线拓扑与切换规则统一看 runtime-line 文档。',
  ].join('\n');
}

function renderGovernanceRuntimeBlock(): string {
  return [
    'For current runtime-line methodology and release/rehearsal topology, use:',
    '',
    '- [Runtime Lines Matrix](./user-guides/runtime-lines-matrix.md)',
    '- [Local Runtime Flows](./user-guides/local-runtime-flows.md)',
    '- Machine-readable source: `scripts/governance/current-runtime-line-manifest.ts`',
    '',
    'Current local baseline:',
    ...renderRuleList(),
  ].join('\n');
}

function renderDocsIndexRuntimeBlock(): string {
  return [
    '- [Local Runtime Flows](./user-guides/local-runtime-flows.md)',
    '  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；当前本机最短运行手册。',
    '- [Runtime Lines Matrix](./user-guides/runtime-lines-matrix.md)',
    '  - 当前 local / rehearsal / deploy 运行线总表。',
    '- [Demo Deploy Operations](./user-guides/demo-deploy-operations.md)',
    '  - 目标主机上的 demo 发布线，不再承担本机 rehearsal 真相说明。',
    '- [Cluster Deploy Operations](./user-guides/cluster-deploy-operations.md)',
    '  - 目标主机上的 real-cluster 发布线，不再承担本机 rehearsal 真相说明。',
  ].join('\n');
}

function renderUserGuidesRuntimeBlock(): string {
  return [
    '- [Local Runtime Flows](./local-runtime-flows.md)',
    '  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；共享 substrate + 一次只跑一条本地工作线的最短手册。',
    '- [Runtime Lines Matrix](./runtime-lines-matrix.md)',
    '  - 当前 runtime / deploy / rehearsal 线与 mode 边界的总表。',
    '- [Demo Deploy Operations](./demo-deploy-operations.md)',
    '  - 目标主机上的 demo 发布线：release root、生命周期命令，以及 `full` 模式下的 local `kind` sandbox 仿真。',
    '- [Cluster Deploy Operations](./cluster-deploy-operations.md)',
    '  - 目标主机上的 real-cluster 发布线：registry-backed bundle release、target-host install flow、namespace-only automation model。',
  ].join('\n');
}

function renderLocalRuntimeFlowsBlock(): string {
  return [
    '运行线职责、mode 边界、shared substrate 方法论以',
    '[Runtime Lines Matrix](./runtime-lines-matrix.md)',
    '为总入口；这份文档只展开本机操作顺序。',
    '',
    'Machine-readable source:',
    '',
    '- `scripts/governance/current-runtime-line-manifest.ts`',
    '',
    '## 一句话规则',
    '',
    '先起共享底座，再跑一条工作线；同一时间只跑一条。',
    '',
    '## 固定规则',
    '',
    ...renderRuleListZh().map((rule, index) => `${index + 1}. ${rule.slice(2)}`),
    '',
    '## 当前本机工作线',
    '',
    ...renderLocalFlowListZh(listCurrentLocalRuntimeLines()),
  ].join('\n');
}

function renderRuntimeLinesMatrixBlock(): string {
  const rows = [
    '| 本地真实手测线 | `local-manual` | 日常开发、真实后端手测、notebook / runner 手测 | 默认启用 | 通过 `local-manual-internal-up` 显式开启 | 共享本地 substrate | 当前推荐本机真实手测入口 |',
    '| demo 本机排演线 | `demo-rehearsal` | 本机排演 demo 发布线 | `DEMO_DEPLOY_MODE=simple` 时 external-only | `DEMO_DEPLOY_MODE=full` 时启用，运行在本地 `kind` | 共享本地 substrate | 使用 scenario-owned `agentsmith-demo` 与 `agentsmith-demo-registry` |',
    '| demo 正式发布线 | `demo-deploy` | 单机 / demo 环境发布 | `simple` | `full` | 目标主机上的 compose substrate | 目标主机 release 线，不是本机 rehearsal 入口 |',
    '| cluster 本机排演线 | `cluster-rehearsal` | 本机排演真实集群发布线 | 始终包含 external runner | 始终包含 internal k8s 执行面 | 共享本地 substrate | 使用 scenario-owned `agentsmith-cluster` 与 `agentsmith-cluster-registry` |',
    '| cluster 正式发布线 | `cluster-deploy` | 真实集群发布 | 始终包含 external runner | 始终包含 internal k8s 执行面 | 目标主机上的 compose substrate | mode 描述自动化边界，不是 external/internal 能力差异 |',
  ];

  return [
    '## 核心方法论',
    '',
    ...renderRuleListZh().map((rule, index) => `${index + 1}. ${rule.slice(2)}`),
    '',
    '## 运行线矩阵',
    '',
    '| 运行线 | 当前正式命名 | 主要用途 | external 路径 | internal 路径 | substrate | 备注 |',
    '|-------|-------------|---------|--------------|--------------|----------|------|',
    ...rows,
  ].join('\n');
}

function syncFile(relativePath: string, updater: (content: string) => string, mode: Mode): string | null {
  const before = read(relativePath);
  const after = updater(before);
  if (before === after) {
    return null;
  }
  if (mode === 'write') {
    write(relativePath, after);
    return null;
  }
  return relativePath;
}

function main(): void {
  const mode: Mode = process.argv.includes('--check') ? 'check' : 'write';
  const mismatches: string[] = [];
  const files = [
    ['docs/current-engineering-governance-model.md', (content: string) => replaceBlock(content, '<!-- current-runtime-lines:governance-model:start -->', '<!-- current-runtime-lines:governance-model:end -->', renderGovernanceRuntimeBlock())],
    ['docs/user-guides/README.md', (content: string) => replaceBlock(content, '<!-- current-runtime-lines:user-guides-index:start -->', '<!-- current-runtime-lines:user-guides-index:end -->', renderUserGuidesRuntimeBlock())],
    ['docs/user-guides/local-runtime-flows.md', (content: string) => replaceBlock(content, '<!-- current-runtime-lines:local-runtime-flows:start -->', '<!-- current-runtime-lines:local-runtime-flows:end -->', renderLocalRuntimeFlowsBlock())],
    ['docs/user-guides/runtime-lines-matrix.md', (content: string) => replaceBlock(content, '<!-- current-runtime-lines:runtime-matrix:start -->', '<!-- current-runtime-lines:runtime-matrix:end -->', renderRuntimeLinesMatrixBlock())],
  ] as const;

  for (const [relativePath, updater] of files) {
    const mismatch = syncFile(relativePath, updater, mode);
    if (mismatch) {
      mismatches.push(mismatch);
    }
  }

  if (mode === 'check' && mismatches.length > 0) {
    console.error('[current-runtime-lines] generated sections are out of sync:');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exit(1);
  }

  console.log(`[current-runtime-lines] ${mode === 'check' ? 'check passed' : 'sync completed'}`);
}

main();
