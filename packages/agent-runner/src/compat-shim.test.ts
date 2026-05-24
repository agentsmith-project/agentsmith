import { describe, expect, it } from 'vitest';
import {
  AGENT_TASK_RUNNER_SPEC as CONTRACT_AGENT_TASK_RUNNER_SPEC,
  TASK_EXECUTION_CONTEXT_JSON_SCHEMA as CONTRACT_TASK_EXECUTION_CONTEXT_JSON_SCHEMA,
} from '@mbos/agent-runner-contract';

import {
  AGENT_TASK_RUNNER_SPEC,
  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,
  buildAgentRuntimeEnv,
} from './index.js';

describe('@mbos/agent-runner compatibility shim', () => {
  it('re-exports the contract package truth while keeping runtime env helpers local', () => {
    expect(AGENT_TASK_RUNNER_SPEC).toBe(CONTRACT_AGENT_TASK_RUNNER_SPEC);
    expect(TASK_EXECUTION_CONTEXT_JSON_SCHEMA).toBe(CONTRACT_TASK_EXECUTION_CONTEXT_JSON_SCHEMA);
    expect(buildAgentRuntimeEnv({ task_id: 'task_1' }).MBOS_AGENT_TASK_ID).toBe('task_1');
  });
});
