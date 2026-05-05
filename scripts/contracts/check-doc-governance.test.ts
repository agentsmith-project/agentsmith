import { describe, expect, it } from 'vitest';

import { isHistoricalDoc } from './check-doc-governance';

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
});
