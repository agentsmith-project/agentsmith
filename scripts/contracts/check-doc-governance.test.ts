import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findEngineeringIndexCurrentSectionViolations, isHistoricalDoc } from './check-doc-governance';

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

  it('states file-library HOME segment repair as one-time pre-GA repair, not a long-term bridge', () => {
    const plan = readFileSync(
      resolve(process.cwd(), 'docs/engineering/agent-task-persistent-home-runtime-plan.md'),
      'utf8',
    );

    expect(plan).toContain('pre-GA 一次性自愈迁移/repair');
    expect(plan).toContain('不是长期 silent compatibility');
    expect(plan).not.toContain('不做长期 legacy dual-read');
    expect(plan).not.toContain('不得静默兼容两个 HOME 根');
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
});
