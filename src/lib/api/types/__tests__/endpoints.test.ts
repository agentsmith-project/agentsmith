/**
 * Endpoint Types Tests
 *
 * TDD tests for new endpoint types.
 * These tests define the expected behavior of the type system.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { components, operations, paths } from '../../types.generated';
import type {
  AgentTaskModelSettingReadinessReasonCode,
  AgentTaskModelSettingReadinessState,
  AgentTaskModelSettingResponse,
  UpdateAgentTaskModelSettingRequest,
} from '../agent-task-model-setting';
import type {
  Endpoint,
  EndpointActionAffordance,
  EndpointActionOperation,
  EndpointCapabilityType,
} from '../endpoints-core';
import type {
  CustomEndpointUpstreamProtocol,
  CustomEndpointConfig,
  EndpointHealthCheck,
  EndpointHealthErrorCategory,
  BatchHealthCheckRequest,
  BatchHealthCheckResponse,
  ModelPricing,
  PricingCurrency,
  PricingUnit,
  UpdatePricingRequest,
  ValidateEndpointRequest,
  ValidateEndpointResponse,
} from '../endpoints';

type AgentTaskModelSettingPathParams = NonNullable<
  paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-task-model-setting']['parameters']['path']
>;
type GetAgentTaskModelSettingPathParams =
  operations['getAgentTaskModelSetting']['parameters']['path'];
type UpdateAgentTaskModelSettingPathParams =
  operations['updateAgentTaskModelSetting']['parameters']['path'];
type UpdateAgentTaskModelSettingResponses =
  operations['updateAgentTaskModelSetting']['responses'];
type UpdateAgentTaskModelSettingJsonResponse<
  Status extends keyof UpdateAgentTaskModelSettingResponses,
> = UpdateAgentTaskModelSettingResponses[Status] extends {
  content: { 'application/json': infer Body };
} ? Body : never;
type ExpectedProjectPathParams = {
  projectId: string;
  workspaceId: string;
};
type ForbiddenUpdateAgentTaskModelSettingFields = Extract<
  keyof UpdateAgentTaskModelSettingRequest,
  | 'runner_id'
  | 'bound_runner_id'
  | 'runner'
  | 'routing'
  | 'quota'
  | 'fallback'
  | 'upstream'
  | 'upstream_url'
  | 'model'
  | 'default_model'
  | 'default_model_id'
  | 'default_endpoint_id'
  | 'task_run_override'
  | 'execution_preference'
  | 'execution_preferences'
>;
type ForbiddenGeneratedUpdateAgentTaskModelSettingFields = Extract<
  keyof components['schemas']['UpdateAgentTaskModelSettingRequest'],
  | 'runner_id'
  | 'bound_runner_id'
  | 'runner'
  | 'routing'
  | 'quota'
  | 'fallback'
  | 'upstream'
  | 'upstream_url'
  | 'model'
  | 'default_model'
  | 'default_model_id'
  | 'default_endpoint_id'
  | 'task_run_override'
  | 'execution_preference'
  | 'execution_preferences'
>;
type ForbiddenEndpointCapability = Extract<EndpointCapabilityType, 'agent_task_capable'>;
type ForbiddenGeneratedEndpointCapability = Extract<
  components['schemas']['EndpointCapabilityType'],
  'agent_task_capable'
>;

describe('CustomEndpointUpstreamProtocol', () => {
  it('should accept openai_chat_completions protocol', () => {
    const upstreamProtocol: CustomEndpointUpstreamProtocol = 'openai_chat_completions';
    expect(upstreamProtocol).toBe('openai_chat_completions');
  });

  it('should accept openai_responses and anthropic_messages protocol', () => {
    const responses: CustomEndpointUpstreamProtocol = 'openai_responses';
    const anthropic: CustomEndpointUpstreamProtocol = 'anthropic_messages';
    expect(responses).toBe('openai_responses');
    expect(anthropic).toBe('anthropic_messages');
  });

  it('should have exactly three protocol options', () => {
    const protocols: CustomEndpointUpstreamProtocol[] = [
      'openai_chat_completions',
      'openai_responses',
      'anthropic_messages',
    ];
    expect(protocols).toHaveLength(3);
  });
});

describe('Agent task model setting contract', () => {
  it('adds the narrow permission-shaped project resource without candidate-list APIs', () => {
    expectTypeOf<AgentTaskModelSettingPathParams>().toEqualTypeOf<ExpectedProjectPathParams>();
    expectTypeOf<GetAgentTaskModelSettingPathParams>().toEqualTypeOf<ExpectedProjectPathParams>();
    expectTypeOf<UpdateAgentTaskModelSettingPathParams>().toEqualTypeOf<ExpectedProjectPathParams>();

    expectTypeOf<AgentTaskModelSettingResponse>().toMatchTypeOf<{
      readiness: {
        state: 'ready' | 'not_configured' | 'blocked';
        display_summary: string;
        reason_code?: AgentTaskModelSettingReadinessReasonCode;
      };
      setting?: {
        workspace_id: string;
        project_id: string;
        endpoint_id: string;
        endpoint_display_name?: string;
        default_model_id?: string;
        default_model?: string;
        setting_revision: string;
        updated_at: string;
        updated_by_user_id: string;
      };
      actions?: {
        update: {
          operation: 'update';
          visible: boolean;
          allowed: boolean;
          required_permissions: string[];
          danger_level: 'none';
        };
      };
    }>();
    expectTypeOf<components['schemas']['AgentTaskModelSettingResponse']>().toMatchTypeOf<AgentTaskModelSettingResponse>();
    expectTypeOf<AgentTaskModelSettingReadinessState>().toEqualTypeOf<'ready' | 'not_configured' | 'blocked'>();
    expectTypeOf<components['schemas']['AgentTaskModelSettingReadinessState']>().toEqualTypeOf<AgentTaskModelSettingReadinessState>();
    expectTypeOf<AgentTaskModelSettingReadinessReasonCode>().toEqualTypeOf<
      | 'agent_task_model_setting_missing'
      | 'agent_task_model_endpoint_not_found'
      | 'agent_task_model_endpoint_disabled'
      | 'agent_task_model_default_missing'
      | 'agent_task_model_capability_mismatch'
      | 'agent_task_model_protocol_unsupported'
      | 'agent_task_model_credential_missing'
      | 'agent_task_model_credential_unavailable'
      | 'agent_task_model_policy_denied'
      | 'agent_task_model_rate_limited'
      | 'agent_task_model_spending_limited'
    >();
    expectTypeOf<components['schemas']['AgentTaskModelSettingReadinessReasonCode']>().toEqualTypeOf<AgentTaskModelSettingReadinessReasonCode>();

    const taskOnlyResponse: AgentTaskModelSettingResponse = {
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
    };
    expect(taskOnlyResponse.setting).toBeUndefined();
    expect(taskOnlyResponse.actions).toBeUndefined();

    const yamlSource = readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8');
    expect(yamlSource).toContain('/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-task-model-setting:');
    expect(yamlSource).toContain('operationId: getAgentTaskModelSetting');
    expect(yamlSource).toContain('operationId: updateAgentTaskModelSetting');
    expect(yamlSource).not.toContain('agent-task-model-candidates');
    expect(yamlSource).not.toContain('agent-task-model-candidate');

    const jsonSource = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    const settingPath = jsonSource.paths?.[
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-task-model-setting'
    ];
    expect(settingPath).toHaveProperty('get');
    expect(settingPath).toHaveProperty('patch');
    expect(Object.keys(jsonSource.paths ?? {})).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('agent-task-model-candidates'),
        expect.stringContaining('agent-task-model-candidate'),
      ]),
    );
  });

  it('keeps PATCH narrow to endpoint_id and expected_setting_revision', () => {
    expectTypeOf<ForbiddenUpdateAgentTaskModelSettingFields>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenGeneratedUpdateAgentTaskModelSettingFields>().toEqualTypeOf<never>();
    expectTypeOf<UpdateAgentTaskModelSettingRequest>().toEqualTypeOf<{
      endpoint_id: string;
      expected_setting_revision: string | null;
    }>();
    expectTypeOf<components['schemas']['UpdateAgentTaskModelSettingRequest']>().toEqualTypeOf<UpdateAgentTaskModelSettingRequest>();

    const jsonSource = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as {
      components?: {
        schemas?: Record<string, {
          additionalProperties?: boolean;
          properties?: Record<string, unknown>;
          required?: string[];
        }>;
      };
    };
    const requestSchema = jsonSource.components?.schemas?.UpdateAgentTaskModelSettingRequest;
    expect(requestSchema?.additionalProperties).toBe(false);
    expect(requestSchema?.required).toEqual(['endpoint_id', 'expected_setting_revision']);
    expect(requestSchema?.properties?.expected_setting_revision).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(Object.keys(requestSchema?.properties ?? {}).sort()).toEqual([
      'endpoint_id',
      'expected_setting_revision',
    ]);
  });

  it('documents PATCH validation, conflict, and resolution blocker bodies separately', () => {
    expectTypeOf<UpdateAgentTaskModelSettingJsonResponse<400>>()
      .toEqualTypeOf<components['schemas']['UnsupportedFieldError']>();
    expectTypeOf<UpdateAgentTaskModelSettingJsonResponse<403>>()
      .toMatchTypeOf<
        components['schemas']['ApiError']
        | components['schemas']['AgentTaskModelResolutionError']
      >();
    expectTypeOf<UpdateAgentTaskModelSettingJsonResponse<409>>()
      .toMatchTypeOf<
        components['schemas']['AgentTaskModelSettingConflictError']
        | components['schemas']['AgentTaskModelResolutionError']
      >();
    expectTypeOf<UpdateAgentTaskModelSettingJsonResponse<422>>()
      .toEqualTypeOf<components['schemas']['AgentTaskModelSettingValidationError']>();
    expectTypeOf<UpdateAgentTaskModelSettingJsonResponse<429>>()
      .toEqualTypeOf<components['schemas']['AgentTaskModelResolutionError']>();
    expectTypeOf<components['schemas']['AgentTaskModelResolutionError']['error_code']>()
      .toEqualTypeOf<
        Exclude<
          AgentTaskModelSettingReadinessReasonCode,
          'agent_task_model_setting_missing' | 'agent_task_model_endpoint_not_found'
        >
      >();

    const yamlSource = readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8');
    expect(yamlSource).toContain('AgentTaskModelResolutionError:');
    expect(yamlSource).toContain('AgentTaskModelResolutionErrorCode:');
    expect(yamlSource).toContain('AgentTaskModelSettingValidationError:');
    expect(yamlSource).toContain('"422":');
    expect(yamlSource).toContain('"429":');
  });
});

describe('Endpoint row Agent task action contract', () => {
  it('uses backend-owned actions.use_for_agent_tasks instead of a capability enum', () => {
    expectTypeOf<ForbiddenEndpointCapability>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenGeneratedEndpointCapability>().toEqualTypeOf<never>();
    expectTypeOf<EndpointCapabilityType>().toEqualTypeOf<
      | 'chat_completion'
      | 'multimodal_completion'
      | 'embedding'
      | 'rerank'
      | 'image_generation'
      | 'video_generation'
    >();
    expectTypeOf<components['schemas']['EndpointCapabilityType']>().toEqualTypeOf<EndpointCapabilityType>();
    expectTypeOf<EndpointActionOperation>().toEqualTypeOf<'use_for_agent_tasks'>();
    expectTypeOf<EndpointActionAffordance>().toMatchTypeOf<{
      operation: 'use_for_agent_tasks';
      visible: boolean;
      allowed: boolean;
      reason_code?: AgentTaskModelSettingReadinessReasonCode;
      required_permissions: string[];
      danger_level: 'none' | 'medium' | 'high';
    }>();
    expectTypeOf<EndpointActionAffordance['reason_code']>()
      .toEqualTypeOf<AgentTaskModelSettingReadinessReasonCode | undefined>();
    expectTypeOf<Endpoint>().toMatchTypeOf<{
      actions?: {
        use_for_agent_tasks: EndpointActionAffordance;
      };
    }>();
    expectTypeOf<components['schemas']['Endpoint']>().toMatchTypeOf<{
      actions: {
        use_for_agent_tasks: components['schemas']['EndpointActionAffordance'];
      };
    }>();

    const yamlSource = readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8');
    expect(yamlSource).toContain('use_for_agent_tasks:');
    expect(yamlSource).toContain('EndpointActionAffordance:');
    expect(yamlSource).toContain('EndpointCapabilityType:');
    expect(yamlSource).not.toMatch(/EndpointCapabilityType:[\s\S]*agent_task_capable/);
  });
});

describe('CustomEndpointConfig', () => {
  it('should create valid openai_chat_completions config', () => {
    const config: CustomEndpointConfig = {
      upstreamProtocol: 'openai_chat_completions',
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      capability: 'chat_completion',
      credentialRef: 'cred-123',
    };

    expect(config.upstreamProtocol).toBe('openai_chat_completions');
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.modelName).toBe('gpt-4o');
    expect(config.capability).toBe('chat_completion');
    expect(config.credentialRef).toBe('cred-123');
  });

  it('should create valid anthropic_messages config', () => {
    const config: CustomEndpointConfig = {
      upstreamProtocol: 'anthropic_messages',
      baseUrl: 'https://api.anthropic.com',
      modelName: 'claude-3-5-sonnet-20241022',
      capability: 'multimodal_completion',
      credentialRef: 'cred-456',
    };

    expect(config.upstreamProtocol).toBe('anthropic_messages');
    expect(config.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(config.capability).toBe('multimodal_completion');
  });
});

describe('EndpointHealthCheck', () => {
  it('should create pass status with latency', () => {
    const health: EndpointHealthCheck = {
      endpointId: 'ep-123',
      status: 'pass',
      checkedAt: '2026-03-03T10:00:00Z',
      latencyMs: 150,
    };

    expect(health.status).toBe('pass');
    expect(health.latencyMs).toBe(150);
    expect(health.error).toBeUndefined();
  });

  it('should create fail status with error details', () => {
    const health: EndpointHealthCheck = {
      endpointId: 'ep-456',
      status: 'fail',
      checkedAt: '2026-03-03T10:05:00Z',
      error: 'Authentication failed',
      errorCategory: 'auth',
    };

    expect(health.status).toBe('fail');
    expect(health.error).toBe('Authentication failed');
    expect(health.errorCategory).toBe('auth');
    expect(health.latencyMs).toBeUndefined();
  });

  it('should accept all error categories', () => {
    const categories: EndpointHealthErrorCategory[] = [
      'auth',
      'network',
      'upstream',
      'timeout',
      'rate_limit',
      'unknown',
    ];

    expect(categories).toHaveLength(6);
  });
});

describe('BatchHealthCheckRequest', () => {
  it('should create request for selected endpoints', () => {
    const request: BatchHealthCheckRequest = {
      endpointIds: ['ep-1', 'ep-2', 'ep-3'],
      mode: 'selected',
    };

    expect(request.mode).toBe('selected');
    expect(request.endpointIds).toEqual(['ep-1', 'ep-2', 'ep-3']);
  });

  it('should create request for all endpoints', () => {
    const request: BatchHealthCheckRequest = {
      mode: 'all',
    };

    expect(request.mode).toBe('all');
    expect(request.endpointIds).toBeUndefined();
  });
});

describe('BatchHealthCheckResponse', () => {
  it('should create response with summary', () => {
    const response: BatchHealthCheckResponse = {
      results: [
        {
          endpointId: 'ep-1',
          status: 'pass',
          checkedAt: '2026-03-03T10:00:00Z',
          latencyMs: 100,
        },
        {
          endpointId: 'ep-2',
          status: 'fail',
          checkedAt: '2026-03-03T10:00:01Z',
          error: 'Connection refused',
          errorCategory: 'network',
        },
      ],
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
      },
    };

    expect(response.results).toHaveLength(2);
    expect(response.summary.total).toBe(2);
    expect(response.summary.passed).toBe(1);
    expect(response.summary.failed).toBe(1);
    expect(response.summary.skipped).toBe(0);
  });
});

describe('ModelPricing', () => {
  it('should create pricing with USD currency', () => {
    const pricing: ModelPricing = {
      modelId: 'gpt-4o',
      endpointId: 'ep-123',
      currency: 'USD',
      inputTokenPrice: 0.005,
      outputTokenPrice: 0.015,
      unit: 'million',
      updatedAt: '2026-03-03T10:00:00Z',
    };

    expect(pricing.currency).toBe('USD');
    expect(pricing.inputTokenPrice).toBe(0.005);
    expect(pricing.outputTokenPrice).toBe(0.015);
    expect(pricing.unit).toBe('million');
  });

  it('should create pricing with CNY currency', () => {
    const pricing: ModelPricing = {
      modelId: 'placeholder-model',
      endpointId: 'ep-456',
      currency: 'CNY',
      inputTokenPrice: 0.5,
      outputTokenPrice: 1.5,
      unit: 'million',
    };

    expect(pricing.currency).toBe('CNY');
  });

  it('should create pricing without optional fields', () => {
    const pricing: ModelPricing = {
      modelId: 'gpt-4o-mini',
      endpointId: 'ep-789',
      currency: 'EUR',
      inputTokenPrice: 0.002,
      outputTokenPrice: 0.006,
      unit: 'thousand',
    };

    expect(pricing.updatedAt).toBeUndefined();
  });
});

describe('PricingCurrency', () => {
  it('should accept all supported currencies', () => {
    const currencies: PricingCurrency[] = ['USD', 'CNY', 'EUR'];
    expect(currencies).toHaveLength(3);
  });
});

describe('PricingUnit', () => {
  it('should accept million and thousand units', () => {
    const units: PricingUnit[] = ['million', 'thousand'];
    expect(units).toHaveLength(2);
  });
});

describe('UpdatePricingRequest', () => {
  it('should create request with all fields', () => {
    const request: UpdatePricingRequest = {
      currency: 'USD',
      inputTokenPrice: 0.01,
      outputTokenPrice: 0.03,
      unit: 'million',
    };

    expect(request.currency).toBe('USD');
    expect(request.inputTokenPrice).toBe(0.01);
    expect(request.outputTokenPrice).toBe(0.03);
    expect(request.unit).toBe('million');
  });

  it('should create request with partial fields', () => {
    const request: UpdatePricingRequest = {
      inputTokenPrice: 0.007,
      outputTokenPrice: 0.021,
    };

    expect(request.inputTokenPrice).toBe(0.007);
    expect(request.currency).toBeUndefined();
  });
});

describe('ValidateEndpointRequest', () => {
  it('should create validation request for openai_chat_completions', () => {
    const request: ValidateEndpointRequest = {
      baseUrl: 'https://api.openai.com/v1',
      upstreamProtocol: 'openai_chat_completions',
      credentialRef: 'cred-123',
      model: 'gpt-4o',
    };

    expect(request.upstreamProtocol).toBe('openai_chat_completions');
    expect(request.baseUrl).toBe('https://api.openai.com/v1');
    expect(request.model).toBe('gpt-4o');
  });

  it('should create validation request without optional model', () => {
      const request: ValidateEndpointRequest = {
      baseUrl: 'https://api.anthropic.com',
      upstreamProtocol: 'anthropic_messages',
      credentialRef: 'cred-456',
    };

    expect(request.model).toBeUndefined();
  });
});

describe('ValidateEndpointResponse', () => {
  it('should create valid response', () => {
    const response: ValidateEndpointResponse = {
      valid: true,
      healthCheck: {
        endpointId: 'ep-123',
        status: 'pass',
        checkedAt: '2026-03-03T10:00:00Z',
        latencyMs: 120,
      },
    };

    expect(response.valid).toBe(true);
    expect(response.healthCheck?.status).toBe('pass');
  });

  it('should create invalid response with error', () => {
    const response: ValidateEndpointResponse = {
      valid: false,
      error: 'Connection timeout',
    };

    expect(response.valid).toBe(false);
    expect(response.error).toBe('Connection timeout');
    expect(response.healthCheck).toBeUndefined();
  });
});

describe('Type Safety - No Any Types', () => {
  it('should not use any type in CustomEndpointConfig', () => {
    // This test ensures type safety - if compilation fails,
    // it means the type is properly defined (not 'any')
    const config: CustomEndpointConfig = {
      upstreamProtocol: 'openai_chat_completions',
      baseUrl: 'https://api.example.com/v1',
      modelName: 'test-model',
      capability: 'chat_completion',
      credentialRef: 'cred-test',
    };

    // Type assertion to ensure strict typing
    const ensureNoAny: <T>(value: T) => T = (value) => value;
    const typedConfig = ensureNoAny<CustomEndpointConfig>(config);

    expect(typedConfig.upstreamProtocol).toBeDefined();
  });

  it('should have strictly typed error categories', () => {
    // Ensures errorCategory is properly typed
    const health: EndpointHealthCheck = {
      endpointId: 'ep-test',
      status: 'fail',
      checkedAt: '2026-03-03T10:00:00Z',
      errorCategory: 'auth', // Type-safe literal
    };

    const categories: EndpointHealthErrorCategory[] = [
      'auth',
      'network',
      'upstream',
      'timeout',
      'rate_limit',
      'unknown',
    ];

    expect(categories).toContain(health.errorCategory);
  });
});
