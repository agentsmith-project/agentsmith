import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { APIError } from '@/lib/api/errors';
import {
  GovernanceExplainabilityAPI,
  getGovernanceEvidenceDetails,
  getGovernanceLimitExceededDetails,
  getGovernanceRouteForbiddenDetails,
} from '@/lib/api/endpoints/governance-explainability';

function createClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function toApiClient(mock: ReturnType<typeof createClient>): ApiClient {
  return {
    setToken: () => undefined,
    getToken: () => null,
    clearToken: () => undefined,
    get: mock.get,
    post: mock.post,
    put: mock.put,
    patch: mock.patch,
    delete: mock.delete,
    connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
  };
}

describe('GovernanceExplainabilityAPI', () => {
  it('calls authorize endpoint', async () => {
    const mock = createClient();
    const api = new GovernanceExplainabilityAPI(toApiClient(mock));

    await api.authorize('ws_1', 'proj_1', {
      subject: { type: 'user', id: 'user_1' },
      resource: { type: 'endpoint', id: 'ep_1' },
      action: 'invoke',
    });

    expect(mock.post).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/authorize', {
      subject: { type: 'user', id: 'user_1' },
      resource: { type: 'endpoint', id: 'ep_1' },
      action: 'invoke',
    });
  });

  it('calls limit check endpoint', async () => {
    const mock = createClient();
    const api = new GovernanceExplainabilityAPI(toApiClient(mock));

    await api.checkLimits('ws_1', 'proj_1', {
      subject_id: 'user_1',
      resource_type: 'source_library',
      resource_id: 'lib_1',
      operation: 'upload',
      estimated_cost: 4096,
    });

    expect(mock.post).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/spending-limits/check', {
      subject_id: 'user_1',
      resource_type: 'source_library',
      resource_id: 'lib_1',
      operation: 'upload',
      estimated_cost: 4096,
    });
  });

  it('builds effective access snapshot from existing governance endpoints', async () => {
    const mock = createClient();
    mock.get
      .mockResolvedValueOnce({
        project_id: 'proj_1',
        user_id: 'user_1',
        role: 'developer',
        permissions: ['project:endpoint:use'],
        status: 'suspended',
        joined_at: '2026-03-01T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        platform_permissions: ['project:endpoint:use', 'project:governance:update'],
      });

    const api = new GovernanceExplainabilityAPI(toApiClient(mock));
    const snapshot = await api.getEffectiveAccessSnapshot('ws_1', 'proj_1', 'user_1');

    expect(mock.get).toHaveBeenNthCalledWith(1, '/workspaces/ws_1/projects/proj_1/memberships/user_1');
    expect(mock.get).toHaveBeenNthCalledWith(2, '/workspaces/ws_1/projects/proj_1/members/user_1/permissions');
    expect(snapshot.membership_status).toBe('suspended');
    expect(snapshot.effective_permissions).toEqual(['project:endpoint:use', 'project:governance:update']);
  });

  it('extracts governance limit error details from APIError', () => {
    const error = new APIError(
      'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      'resource_policy_spending_limit_exceeded',
      undefined,
      429,
      {
        error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
        message: 'resource_policy_spending_limit_exceeded',
        resource_type: 'source_library',
        resource_id: 'lib_1',
        limit_key: 'source_library.max_file_size_bytes',
      },
    );

    expect(getGovernanceLimitExceededDetails(error)?.limit_key).toBe('source_library.max_file_size_bytes');
  });

  it('keeps spending-limit payload fields normalized to limit semantics', () => {
    const details = getGovernanceEvidenceDetails({
      error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      governance_kind: 'resource_policy',
      enforcement_kind: 'spending_limit',
      limit_key: 'endpoint.daily_token_limit',
      reason: 'spending_limit_exceeded',
    });

    expect(details?.enforcement_kind).toBe('spending_limit');
    expect(details?.limit_key).toBe('endpoint.daily_token_limit');
    expect(details?.reason).toBe('spending_limit_exceeded');
  });

  it('extracts governance forbidden details from APIError', () => {
    const error = new APIError(
      'FORBIDDEN',
      'forbidden',
      undefined,
      403,
      {
        error_code: 'FORBIDDEN',
        message: 'forbidden',
        missing_permissions: ['project:membership:update'],
        authz_decision: {
          membership_status: 'suspended',
          decisions: [{ permission: 'project:membership:update', granted: false, reason: 'membership_suspended', source: 'permission', membership_status: 'suspended' }],
        },
      },
    );

    expect(getGovernanceRouteForbiddenDetails(error)?.authz_decision?.membership_status).toBe('suspended');
  });
});
