import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AgentRunner,
  AgentRunnerActionAffordance,
  AgentRunnerActionOperation,
  AgentRunnerActions,
  AgentRunnerCollectionActions,
  AgentRunnerKind,
  AgentRunnerKeyExpiryCleanup,
  AgentRunnerListResponse,
  AgentRunnerServiceKey,
  AgentRunnerSource,
  AgentRunnerTestConnectionCleanup,
  AgentRunnerTestConnectionRequest,
  AgentRunnerTestConnectionResponse,
  AgentRunnerTestTaskRunAcceptedResponse,
  AgentRunnerTestTaskRunUnavailableResponse,
  AgentRunnerTestTaskRunRequest,
  CreateAgentRunnerRequest,
  UpdateAgentRunnerRequest,
} from '../agent-runners';
import type { components, operations } from '../../types.generated';

type LegacyAgentKeys = Extract<keyof AgentRunner, 'mode' | 'interaction_kind'>;
type ForbiddenCreateAgentRunnerFields = Extract<
  keyof CreateAgentRunnerRequest,
  'is_default' | 'default_endpoint_id' | 'status' | 'diagnostics' | 'capabilities'
>;
type ForbiddenUpdateAgentRunnerFields = Extract<
  keyof UpdateAgentRunnerRequest,
  'kind' | 'is_default' | 'default_endpoint_id' | 'status' | 'diagnostics' | 'capabilities'
>;
type ForbiddenConnectionCleanupFields = Extract<
  keyof AgentRunnerKeyExpiryCleanup,
  'key' | 'key_hash' | 'secret' | 'secret_hash'
>;
type ForbiddenTestConnectionRequestFields = Extract<
  keyof AgentRunnerTestConnectionRequest,
  'ws_url' | 'key' | 'Authorization' | 'diagnostics'
>;
type ForbiddenTestTaskRunRequestFields = Extract<
  keyof AgentRunnerTestTaskRunRequest,
  'task_id' | 'runner_selection' | 'agent_id' | 'runner_id' | 'input_refs' | 'workspace_file_library_id'
>;
type ForbiddenTestTaskRunAcceptedResponseFields = Extract<
  keyof AgentRunnerTestTaskRunAcceptedResponse,
  'selection' | 'runner_selection'
>;
type ForbiddenTestTaskRunUnavailableResponseFields = Extract<
  keyof AgentRunnerTestTaskRunUnavailableResponse,
  'selection' | 'runner_selection'
>;
type TestConnectionUnsupportedFieldResponse =
  operations['testAgentRunnerConnection']['responses'][400]['content']['application/json'];
type TestTaskRunUnsupportedFieldResponse =
  operations['createAgentRunnerTestTaskRun']['responses'][400]['content']['application/json'];

const agentRunnerVocabularyFiles = [
  'src/components/api-keys/agent-runner-keys-dialog/KeysListSection.tsx',
  'src/mocks/doc-fixtures/workspace-projects.ts',
  'src/mocks/fixtures/agent-runners.ts',
  'src/mocks/handlers/agent-runners.ts',
];

describe('Agent Runner API hand-written types', () => {
  it('tracks the generated Agent Runner surface instead of legacy Agent selectors', () => {
    expectTypeOf<LegacyAgentKeys>().toEqualTypeOf<never>();
    expectTypeOf<AgentRunnerKind>().toEqualTypeOf<'system_managed' | 'developer'>();
    expectTypeOf<AgentRunnerSource>().toEqualTypeOf<'system' | 'developer'>();
    expectTypeOf<AgentRunner>().toMatchTypeOf<{
      kind: AgentRunnerKind;
      source: AgentRunnerSource;
      read_only: boolean;
      actions: AgentRunnerActions;
    }>();
    expectTypeOf<AgentRunner['actions']['issue_connection_key']>().toMatchTypeOf<AgentRunnerActionAffordance>();
    expectTypeOf<AgentRunner['actions']['view_diagnostics']>().toMatchTypeOf<{
      operation: AgentRunnerActionOperation;
      visible: boolean;
      allowed: boolean;
      required_permissions: string[];
      danger_level: 'none' | 'medium' | 'high';
    }>();
    expectTypeOf<AgentRunnerActionOperation>().toEqualTypeOf<
      | 'set_project_default'
      | 'bind_to_task'
      | 'run_test_task'
      | 'edit'
      | 'disable'
      | 'delete'
      | 'issue_connection_key'
      | 'revoke_connection_key'
      | 'test_connection'
      | 'view_diagnostics'
      | 'create_developer_runner'
    >();
    expectTypeOf<AgentRunner['actions']['bind_to_task']>().toMatchTypeOf<AgentRunnerActionAffordance>();
    expectTypeOf<Extract<keyof AgentRunner['actions'], 'select_for_task'>>().toEqualTypeOf<never>();
    expectTypeOf<AgentRunnerCollectionActions>().toMatchTypeOf<{
      create_developer_runner: AgentRunnerActionAffordance;
    }>();
    expectTypeOf<AgentRunnerListResponse>().toMatchTypeOf<{
      items: AgentRunner[];
      actions: AgentRunnerCollectionActions;
    }>();

    const source = readFileSync(resolve(process.cwd(), 'src/lib/api/types/agent-runners.ts'), 'utf8');
    expect(source).not.toMatch(/\bAgentInteractionKind\b/);
    expect(source).not.toMatch(/^\s*mode\s*:/m);
    expect(source).not.toMatch(/\binteraction_kind\b/);
  });

  it('keeps public create/update contracts narrowed to Developer runner lifecycle fields', () => {
    expectTypeOf<ForbiddenCreateAgentRunnerFields>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenUpdateAgentRunnerFields>().toEqualTypeOf<never>();
    expectTypeOf<CreateAgentRunnerRequest>().toMatchTypeOf<{
      name: string;
      description?: string;
      kind?: 'developer';
    }>();
    expectTypeOf<UpdateAgentRunnerRequest>().toEqualTypeOf<{
      name?: string;
      description?: string;
    }>();
  });

  it('keeps mocks and connection-key UI on Agent Runner public type names', () => {
    expectTypeOf<AgentRunnerServiceKey>().toMatchTypeOf<{
      agent_runner_id: string;
      key_prefix: string;
      status: 'active' | 'revoked' | 'expired';
    }>();

    for (const file of agentRunnerVocabularyFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');

      expect(source).not.toMatch(/\bAgentServiceKey\b/);
      expect(source).not.toMatch(/import type\s*\{[^}]*\bAgent\b[^}]*\}\s*from\s*['"]@\/lib\/api\/types['"]/);
      expect(source).not.toMatch(/\b(docAgentFixtures|agentFixtures|agentServiceKeyFixtures)\b/);
      expect(source).not.toMatch(/\b(AgentKeyRecord|AgentKeyRow)\b/);
    }
  });

  it('keeps test-connection cleanup metadata public, redacted, and generated-type backed', () => {
    expectTypeOf<AgentRunnerTestConnectionResponse>().toMatchTypeOf<{
      cleanup?: AgentRunnerTestConnectionCleanup;
    }>();
    expectTypeOf<AgentRunnerTestConnectionCleanup>().toMatchTypeOf<{
      key_expiry?: AgentRunnerKeyExpiryCleanup;
    }>();
    expectTypeOf<AgentRunnerKeyExpiryCleanup>().toEqualTypeOf<{
      workspace_id: string;
      project_id: string;
      agent_runner_id: string;
      key_id: string;
      key_prefix: string;
      expires_at?: string;
      cleanup_result: 'marked_expired';
      disconnected: boolean;
    }>();
    expectTypeOf<ForbiddenConnectionCleanupFields>().toEqualTypeOf<never>();
  });

  it('keeps Developer runner test endpoints strict and OpenAPI 400-visible', () => {
    expectTypeOf<ForbiddenTestConnectionRequestFields>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenTestTaskRunRequestFields>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenTestTaskRunAcceptedResponseFields>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenTestTaskRunUnavailableResponseFields>().toEqualTypeOf<never>();
    expectTypeOf<TestConnectionUnsupportedFieldResponse>().toEqualTypeOf<components['schemas']['UnsupportedFieldError']>();
    expectTypeOf<TestTaskRunUnsupportedFieldResponse>().toEqualTypeOf<components['schemas']['UnsupportedFieldError']>();

    const generatedTypes = readFileSync(resolve(process.cwd(), 'src/lib/api/types.generated.ts'), 'utf8');
    const openapiYaml = readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8');
    expect(generatedTypes).not.toContain('selection: components["schemas"]["AgentRunnerTestTaskRunSelection"]');
    expect(openapiYaml).not.toContain('AgentRunnerTestTaskRunSelection');
  });
});
