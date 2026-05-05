import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { AgentRunner, AgentRunnerServiceKey } from '../agent-runners';

type LegacyAgentKeys = Extract<keyof AgentRunner, 'mode' | 'interaction_kind'>;

const agentRunnerVocabularyFiles = [
  'src/components/api-keys/agent-runner-keys-dialog/KeysListSection.tsx',
  'src/mocks/doc-fixtures/workspace-projects.ts',
  'src/mocks/fixtures/agent-runners.ts',
  'src/mocks/handlers/agent-runners.ts',
];

describe('Agent Runner API hand-written types', () => {
  it('tracks the generated Agent Runner surface instead of legacy Agent selectors', () => {
    expectTypeOf<LegacyAgentKeys>().toEqualTypeOf<never>();

    const source = readFileSync(resolve(process.cwd(), 'src/lib/api/types/agent-runners.ts'), 'utf8');
    expect(source).not.toMatch(/\bAgentInteractionKind\b/);
    expect(source).not.toMatch(/^\s*mode\s*:/m);
    expect(source).not.toMatch(/\binteraction_kind\b/);
  });

  it('keeps mocks and connection-key UI on Agent Runner public type names', () => {
    expectTypeOf<AgentRunnerServiceKey>().toMatchTypeOf<{
      agent_runner_id: string;
      key_prefix: string;
      status: 'active' | 'revoked';
    }>();

    for (const file of agentRunnerVocabularyFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');

      expect(source).not.toMatch(/\bAgentServiceKey\b/);
      expect(source).not.toMatch(/import type\s*\{[^}]*\bAgent\b[^}]*\}\s*from\s*['"]@\/lib\/api\/types['"]/);
      expect(source).not.toMatch(/\b(docAgentFixtures|agentFixtures|agentServiceKeyFixtures)\b/);
      expect(source).not.toMatch(/\b(AgentKeyRecord|AgentKeyRow)\b/);
    }
  });
});
