import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_RUNTIME_LINE_MANIFEST,
  CURRENT_RUNTIME_SHARED_RULES,
  listCurrentLocalRuntimeLines,
  type CurrentRuntimeLineDefinition,
  type CurrentRuntimeSharedRuleBinding,
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

function renderRuleList(binding: CurrentRuntimeSharedRuleBinding): string[] {
  return CURRENT_RUNTIME_SHARED_RULES
    .filter((rule) => rule.binding === binding)
    .map((rule) => `- ${rule.summary}`);
}

function renderRuleListZh(binding: CurrentRuntimeSharedRuleBinding): string[] {
  const summaries: Record<string, string> = {
    'local-real-human-entry': '- `local-real` 是开发机上的正式人类入口；`local-manual` 只保留为底层 maintainer adapter。',
    'serial-local-runtime-switching': '- `local-real` 与 unified deploy substrate 共享默认本地 substrate 端口，在同一开发机上必须串行切换。',
    'one-agentsmith-deploy': '- 只有一个 AgentSmith deploy 模型；`local-kind` 与 `existing-cluster` 是 profile，不是 demo/cluster 两套产品。',
    'docker-substrate-k8s-app-boundary': '- Substrates 保持在 app namespace 外部，由 Docker 或运维提供的服务承载；AgentSmith app 工作负载运行在 Kubernetes。',
    'api-single-replica-current': '- 当前里程碑 `api replicas=1`，直到引入明确的多副本 execution routing 设计。',
  };

  return CURRENT_RUNTIME_SHARED_RULES
    .filter((rule) => rule.binding === binding)
    .map((rule) => summaries[rule.id] ?? `- ${rule.summary}`);
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
  return lines.map((line) => `- \`${line.formalName}\` — ${line.primaryUse}`);
}

function renderReadmeRuntimeBlock(): string {
  return [
    'Current runtime-line truth:',
    '- Human guides: [Runtime Lines Matrix](./docs/user-guides/runtime-lines-matrix.md) and [Local Runtime Flows](./docs/user-guides/local-runtime-flows.md)',
    '- Machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)',
    '',
    'Current local runtime baseline:',
    ...renderRuleList('operational_baseline'),
    '',
    'Still-binding runtime contracts:',
    ...renderRuleList('contract'),
    '',
    'Current local developer flow:',
    ...renderLocalFlowList(listCurrentLocalRuntimeLines()),
    '',
    'Use `Local Runtime Flows` for local commands and switching. Use `Unified Deploy Operations` for `local-kind` and `existing-cluster` deploy profile evidence under `artifacts/unified-deploy/`.',
  ].join('\n');
}

function renderDevelopmentRuntimeBlock(): string {
  return [
    '当前 runtime-line 真相：',
    '- 人类入口：[`Runtime Lines Matrix`](./docs/user-guides/runtime-lines-matrix.md) 与 [`Local Runtime Flows`](./docs/user-guides/local-runtime-flows.md)',
    '- machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)',
    '',
    '当前本机操作基线：',
    ...renderRuleListZh('operational_baseline'),
    '',
    '持续生效的 runtime contract：',
    ...renderRuleListZh('contract'),
    '',
    '当前本机工作线：',
    ...renderLocalFlowListZh(listCurrentLocalRuntimeLines()),
    '',
    '本文件只保留开发/排障入口；部署命令、profile、证据路径统一看 runtime-line 文档与 Unified Deploy Operations。',
  ].join('\n');
}

function renderGovernanceRuntimeBlock(): string {
  return [
    'For current runtime-line methodology and unified deploy topology, use:',
    '',
    '- [Runtime Lines Matrix](./user-guides/runtime-lines-matrix.md)',
    '- [Local Runtime Flows](./user-guides/local-runtime-flows.md)',
    '- Machine-readable source: `scripts/governance/current-runtime-line-manifest.ts`',
    '',
    'Current local operational baseline:',
    ...renderRuleList('operational_baseline'),
    '',
    'Still-binding runtime contracts:',
    ...renderRuleList('contract'),
    '',
    'Deploy evidence is produced by unified deploy checks under `artifacts/unified-deploy/`.',
  ].join('\n');
}

function _renderDocsIndexRuntimeBlock(): string {
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
    '  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；当前本机操作基线与切线手册。',
    '- [Runtime Lines Matrix](./runtime-lines-matrix.md)',
    '  - 当前 local-real 与统一部署 profile 的总表。',
    '- [Unified Deploy Operations](./unified-deploy-operations.md)',
    '  - 当前部署入口：one AgentSmith deploy，`local-kind` / `existing-cluster` profiles，Docker substrate，Kubernetes app。',
  ].join('\n');
}

function renderLocalRuntimeFlowsBlock(): string {
  return [
    '运行线职责、部署 profile、substrate 边界以',
    '[Runtime Lines Matrix](./runtime-lines-matrix.md)',
    '为总入口；这份文档只展开本机操作顺序。',
    '',
    'Machine-readable source:',
    '',
    '- `scripts/governance/current-runtime-line-manifest.ts`',
    '',
    '## 一句话基线',
    '',
    '`local-real` 用来开发和手测；unified deploy 用来证明部署。两者在一台开发机上串行切换。',
    '',
    '## 当前操作基线',
    '',
    ...renderRuleListZh('operational_baseline').map((rule, index) => `${index + 1}. ${rule.slice(2)}`),
    '',
    '## 持续生效的 runtime contract',
    '',
    ...renderRuleListZh('contract').map((rule, index) => `${index + 1}. ${rule.slice(2)}`),
    '',
    '## 当前本机工作线',
    '',
    ...renderLocalFlowListZh(listCurrentLocalRuntimeLines()),
    '',
    '## 最小本机验证',
    '',
    '```bash',
    'make local-real-reset',
    "PROMPT='Reply exactly: local real echo ok' POLL_MAX=30 POLL_INTERVAL_SEC=2 SCENARIO_ATTEMPTS=1 make agent-task-smoke-task",
    '```',
    '',
    'Files / file-library 的本机验证使用 local-real API 做 focused producer，不需要启动统一部署。',
    '',
    '## 切到统一部署',
    '',
    '```bash',
    'make local-real-down',
    'npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset',
    'npm run test:unified-deploy:local-kind:images',
    'npm run test:unified-deploy:local-kind',
    'npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner',
    '```',
    '',
    '统一部署证据统一写到 `artifacts/unified-deploy/`。',
  ].join('\n');
}

function renderRuntimeLinesMatrixBlock(): string {
  const rows = CURRENT_RUNTIME_LINE_MANIFEST.map((line) =>
    `| ${line.label} | \`${line.formalName}\` | ${line.primaryUse} | ${line.appRuntime} | ${line.substrate} | ${line.note} |`,
  );

  return [
    '## 当前本机操作基线',
    '',
    ...renderRuleListZh('operational_baseline').map((rule, index) => `${index + 1}. ${rule.slice(2)}`),
    '',
    '可复制的人类操作入口统一看 [Local Runtime Flows](./local-runtime-flows.md) 与 [Unified Deploy Operations](./unified-deploy-operations.md)；本矩阵只说明 topology、profile 边界和运行线归属。',
    '',
    '## 持续生效的 runtime contract',
    '',
    ...renderRuleListZh('contract').map((rule, index) => `${index + 1}. ${rule.slice(2)}`),
    '',
    '旧 demo/cluster split 不再是当前 operating model；不要用旧 rehearsal evidence 代替 unified deploy evidence。',
    '',
    '## 运行线矩阵',
    '',
    '| 运行线 | 当前正式命名 | 主要用途 | App runtime | substrate | 备注 |',
    '|-------|-------------|---------|-------------|----------|------|',
    ...rows,
    '',
    '## 当前证据路径',
    '',
    '- local-real / local-manual runtime state: `artifacts/runtime/lines/local-manual/current`',
    '- unified deploy evidence: `artifacts/unified-deploy/`',
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
    ['README.md', (content: string) => replaceBlock(content, '<!-- current-runtime-lines:readme:start -->', '<!-- current-runtime-lines:readme:end -->', renderReadmeRuntimeBlock())],
    ['DEVELOPMENT.md', (content: string) => replaceBlock(content, '<!-- current-runtime-lines:development:start -->', '<!-- current-runtime-lines:development:end -->', renderDevelopmentRuntimeBlock())],
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
