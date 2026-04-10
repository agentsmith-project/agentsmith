import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_WORKFLOW_MANIFEST,
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
  listRecommendedCurrentWorkflowSections,
  type CurrentWorkflowCommand,
  type CurrentWorkflowSection,
} from './current-workflow-manifest';

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
  const replacement = `${startMarker}\n${nextBlock}\n${endMarker}`;
  if (!pattern.test(content)) {
    throw new Error(`generated_block_not_found:${startMarker}`);
  }
  return content.replace(pattern, replacement);
}

function renderCommandList(section: CurrentWorkflowSection): string {
  const lines = [`### ${section.title}`, '', '```bash'];
  for (const command of section.commands) {
    lines.push(command.command);
  }
  lines.push('```');
  return lines.join('\n');
}

function renderCurrentWorkflowDocBlock(): string {
  const recommendedSections = listRecommendedCurrentWorkflowSections();

  return [
    'Use this minimal command set for daily work.',
    '',
    'Current workflow model:',
    ...CURRENT_WORKFLOW_TOP_LEVEL_TERMS.map((term) => `- \`${term}\``),
    '',
    'Authoritative definition:',
    '- [Current Engineering Governance Model](./docs/current-engineering-governance-model.md)',
    '- Machine-readable source: [`scripts/governance/current-workflow-manifest.ts`](./scripts/governance/current-workflow-manifest.ts)',
    '- Machine-readable gate source: [`scripts/governance/current-gate-manifest.ts`](./scripts/governance/current-gate-manifest.ts)',
    '',
    'Command naming rule:',
    '- `npm run` names are the canonical current entrypoints',
    '- `make` targets are convenience wrappers for the same paths',
    '',
    ...recommendedSections.flatMap((section, index) => {
      const block = renderCommandList(section).split('\n');
      return index === recommendedSections.length - 1 ? block : [...block, ''];
    }),
  ].join('\n');
}

function renderDevelopmentWorkflowBlock(): string {
  const recommendedSections = listRecommendedCurrentWorkflowSections();

  return [
    '当前仓库只保留这几类 current 主路径：',
    '',
    ...CURRENT_WORKFLOW_TOP_LEVEL_TERMS.map((term) => `- \`${term}\``),
    '',
    '权威定义：',
    '- [docs/current-engineering-governance-model.md](./docs/current-engineering-governance-model.md)',
    '- machine-readable source: [`scripts/governance/current-workflow-manifest.ts`](./scripts/governance/current-workflow-manifest.ts)',
    '- machine-readable gate source: [`scripts/governance/current-gate-manifest.ts`](./scripts/governance/current-gate-manifest.ts)',
    '',
    '命令命名约定：',
    '- `npm run` 是 current canonical entrypoint',
    '- `make` 只作为同一路径的便捷包装',
    '',
    ...recommendedSections.flatMap((section, index) => {
      const block = renderCommandList(section).split('\n');
      return index === recommendedSections.length - 1 ? block : [...block, ''];
    }),
  ].join('\n');
}

function renderGovernanceModelCommandBlock(): string {
  return CURRENT_WORKFLOW_MANIFEST.map(renderCommandList).join('\n\n');
}

function renderMakeCommandSummary(command: CurrentWorkflowCommand): string {
  const display = command.makeTarget ? `make ${command.makeTarget}` : command.command;
  return `${display}  # ${command.description}`;
}

function renderMakeHelpExtendedBlock(): string {
  const lines = [
    'help-extended:',
    '\t@echo "MBOS Current Engineering Commands"',
    '\t@echo ""',
    '\t@echo "Current path (lowest cognitive load):"',
    '\t@echo "  make quick-help     # show only the recommended day-to-day commands"',
    '\t@echo "  make help-glossary  # explain common testing/engineering terms in plain language"',
    '\t@echo "  note: npm script names are canonical; make targets below are convenience wrappers"',
    '\t@echo ""',
  ];

  for (const section of CURRENT_WORKFLOW_MANIFEST) {
    const label = section.title === '环境'
      ? 'Environment'
      : section.title === '测试'
        ? 'Tests'
        : section.title === '门禁'
          ? 'Gates'
          : section.title === '验证通道'
            ? 'Verification channels'
            : 'Release';
    lines.push(`\t@echo "${label}:"`);
    for (const command of section.commands) {
      lines.push(`\t@echo "  ${renderMakeCommandSummary(command)}"`);
    }
    lines.push('\t@echo ""');
  }

  lines.push('\t@echo "Bootstrap:"');
  lines.push('\t@echo "  make bootstrap    # deps-up -> wait for ready -> deps-init -> deps-smoke (ordered)"');
  lines.push('\t@echo ""');

  return lines.join('\n');
}

function renderMakeQuickHelpBlock(): string {
  const recommended = listRecommendedCurrentWorkflowSections().flatMap((section) => section.commands);
  const lines = [
    'quick-help:',
    '\t@echo "MBOS Recommended Commands"',
    '\t@echo ""',
    '\t@echo "  note: make is the convenience layer; canonical names live under npm run"',
    '\t@echo ""',
  ];

  for (const command of recommended) {
    const display = command.makeTarget ? `make ${command.makeTarget}` : command.command;
    const sentence = `${command.description.charAt(0).toUpperCase()}${command.description.slice(1)}.`;
    lines.push(`\t@echo "  ${display}"`);
    lines.push(`\t@echo "    ${sentence}"`);
    lines.push('\t@echo ""');
  }

  return lines.join('\n');
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
    ['README.md', (content: string) => replaceBlock(content, '<!-- current-workflow:readme:start -->', '<!-- current-workflow:readme:end -->', renderCurrentWorkflowDocBlock())],
    ['DEVELOPMENT.md', (content: string) => replaceBlock(content, '<!-- current-workflow:development:start -->', '<!-- current-workflow:development:end -->', renderDevelopmentWorkflowBlock())],
    ['docs/current-engineering-governance-model.md', (content: string) => replaceBlock(content, '<!-- current-workflow:governance-model:start -->', '<!-- current-workflow:governance-model:end -->', renderGovernanceModelCommandBlock())],
    ['Makefile', (content: string) => replaceBlock(content, '# current-workflow:help-extended:start', '# current-workflow:help-extended:end', renderMakeHelpExtendedBlock())],
    ['Makefile', (content: string) => replaceBlock(content, '# current-workflow:quick-help:start', '# current-workflow:quick-help:end', renderMakeQuickHelpBlock())],
  ] as const;

  for (const [relativePath, updater] of files) {
    const mismatch = syncFile(relativePath, updater, mode);
    if (mismatch) mismatches.push(mismatch);
  }

  if (mode === 'check' && mismatches.length > 0) {
    console.error('[current-workflow] generated sections are out of sync:');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exit(1);
  }

  console.log(`[current-workflow] ${mode === 'check' ? 'check passed' : 'sync completed'}`);
}

main();
