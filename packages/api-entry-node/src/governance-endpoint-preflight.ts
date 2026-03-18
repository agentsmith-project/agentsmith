import { randomUUID } from 'node:crypto';
import type { NodeApiDeps } from './node-api-deps.js';
import type { EndpointRecord } from './resource-models.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { isProjectResourceAccessAllowedForUser } from './project-resource-policy-store.js';
import {
  checkProjectEndpointRateLimitsForUser,
  checkProjectEndpointSpendingLimitsForUser,
} from './project-resource-policy-enforcer.js';

export type EndpointGovernancePreflightAllowed = {
  allowed: true;
  decisionId: string;
  estimatedCostPerTokenUsd?: number;
};

export type EndpointGovernancePreflightDenied = {
  allowed: false;
  decisionId: string;
  statusCode: 403 | 429;
  retryAfterSeconds?: number;
  responseBody: {
    error_code: 'RESOURCE_POLICY_DENIED' | 'RESOURCE_POLICY_RATE_LIMITED' | 'RESOURCE_POLICY_SPENDING_LIMITED';
    message: 'resource_policy_denied' | 'resource_policy_rate_limited' | 'resource_policy_spending_limited';
    resource_type: 'endpoint';
    resource_id: string;
    retry_after_seconds?: number;
    spending_key?: string;
  };
};

export type EndpointGovernancePreflightDecision =
  | EndpointGovernancePreflightAllowed
  | EndpointGovernancePreflightDenied;

function computeEstimatedCostPerTokenUsd(endpoint: EndpointRecord): number | undefined {
  const profile = endpoint.model_profile;
  if (!profile) return undefined;
  const inputPrice = typeof profile.price_input_per_1m === 'number' ? profile.price_input_per_1m : undefined;
  const outputPrice = typeof profile.price_output_per_1m === 'number' ? profile.price_output_per_1m : undefined;
  const effectivePricePer1M = Math.max(inputPrice ?? 0, outputPrice ?? 0);
  if (!Number.isFinite(effectivePricePer1M) || effectivePricePer1M <= 0) return undefined;
  return effectivePricePer1M / 1_000_000;
}

function metadataBase(
  kind: 'access_denied' | 'policy_rate' | 'policy_spending',
  source: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === 'access_denied') {
    return { governance_kind: 'resource_policy', enforcement_kind: 'allow_list', source, ...extra };
  }
  if (kind === 'policy_rate') {
    return { governance_kind: 'resource_policy', enforcement_kind: 'rate_limit', source, ...extra };
  }
  return { governance_kind: 'resource_policy', enforcement_kind: 'spending_limit', source, ...extra };
}

export async function enforceEndpointGovernancePreflight(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  endpoint: EndpointRecord;
  userId: string;
  requestId?: string | null;
  source: string;
  contextMetadata?: Record<string, unknown>;
  recordAccessDeniedEvidence?: boolean;
}): Promise<EndpointGovernancePreflightDecision> {
  const {
    deps,
    workspaceId,
    projectId,
    endpoint,
    userId,
    requestId,
    source,
    contextMetadata,
    recordAccessDeniedEvidence = true,
  } = args;

  const decisionId = `gdec_${randomUUID().replace(/-/g, '')}`;
  const policyCheck = await isProjectResourceAccessAllowedForUser({
    docStore: deps.docStore,
    workspaceId,
    projectId,
    resourceType: 'endpoint',
    resourceId: endpoint.id,
    userId,
  });
  if (!policyCheck.allowed) {
    const metadata = metadataBase('access_denied', source, {
      decision_id: decisionId,
      reason: policyCheck.reason ?? 'not_allowed',
      ...(contextMetadata ?? {}),
    });
    if (recordAccessDeniedEvidence) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: userId },
        action: 'resource_policy.access_denied',
        result: 'error',
        requestId,
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        errorCode: 'RESOURCE_POLICY_DENIED',
        errorMessage: 'resource_policy_denied',
        metadata,
      });
      await writeProjectUsageFact(deps, {
        workspaceId,
        projectId,
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        endUserId: userId,
        requestId,
        requests: 1,
        result: 'error',
        errorCode: 'RESOURCE_POLICY_DENIED',
        metadata: {
          stage: 'preflight',
          ...metadata,
        },
      });
    }
    return {
      allowed: false,
      decisionId,
      statusCode: 403,
      responseBody: {
        error_code: 'RESOURCE_POLICY_DENIED',
        message: 'resource_policy_denied',
        resource_type: 'endpoint',
        resource_id: endpoint.id,
      },
    };
  }

  const rateCheck = await checkProjectEndpointRateLimitsForUser({
    docStore: deps.docStore,
    workspaceId,
    projectId,
    resourceId: endpoint.id,
    userId,
    policy: policyCheck.policy,
  });
  if (!rateCheck.allowed) {
    const metadata = metadataBase('policy_rate', source, {
      decision_id: decisionId,
      rate_key: rateCheck.rate_key,
      effective_limit: rateCheck.effective_limit,
      current_requests: rateCheck.current_requests,
      window_seconds: rateCheck.window_seconds,
      retry_after_seconds: rateCheck.retry_after_seconds,
      scope: rateCheck.scope,
      ...(contextMetadata ?? {}),
    });
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: userId },
      action: 'resource_policy.rate_limited',
      result: 'error',
      requestId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
      errorMessage: 'resource_policy_rate_limited',
      metadata,
    });
    await writeProjectUsageFact(deps, {
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      endUserId: userId,
      requestId,
      requests: 1,
      result: 'error',
      errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
      metadata: {
        stage: 'preflight',
        ...metadata,
      },
    });
    return {
      allowed: false,
      decisionId,
      statusCode: 429,
      retryAfterSeconds: rateCheck.retry_after_seconds,
      responseBody: {
        error_code: 'RESOURCE_POLICY_RATE_LIMITED',
        message: 'resource_policy_rate_limited',
        resource_type: 'endpoint',
        resource_id: endpoint.id,
        retry_after_seconds: rateCheck.retry_after_seconds,
      },
    };
  }

  const estimatedCostPerTokenUsd = computeEstimatedCostPerTokenUsd(endpoint);
  const spendingCheck = await checkProjectEndpointSpendingLimitsForUser({
    docStore: deps.docStore,
    workspaceId,
    projectId,
    resourceId: endpoint.id,
    userId,
    policy: policyCheck.policy,
    estimatedCostPerTokenUsd,
  });
  if (!spendingCheck.allowed) {
    const metadata = metadataBase('policy_spending', source, {
      decision_id: decisionId,
      spending_key: spendingCheck.spending_key,
      effective_limit_usd: spendingCheck.effective_limit_usd,
      current_spending_usd: spendingCheck.current_spending_usd,
      window_seconds: spendingCheck.window_seconds,
      retry_after_seconds: spendingCheck.retry_after_seconds,
      scope: spendingCheck.scope,
      ...(contextMetadata ?? {}),
    });
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: userId },
      action: 'resource_policy.spending_limited',
      result: 'error',
      requestId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      errorCode: 'RESOURCE_POLICY_SPENDING_LIMITED',
      errorMessage: 'resource_policy_spending_limited',
      metadata,
    });
    await writeProjectUsageFact(deps, {
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      endUserId: userId,
      requestId,
      requests: 1,
      result: 'error',
      errorCode: 'RESOURCE_POLICY_SPENDING_LIMITED',
      metadata: {
        stage: 'preflight',
        ...metadata,
      },
    });
    return {
      allowed: false,
      decisionId,
      statusCode: 429,
      retryAfterSeconds: spendingCheck.retry_after_seconds,
      responseBody: {
        error_code: 'RESOURCE_POLICY_SPENDING_LIMITED',
        message: 'resource_policy_spending_limited',
        resource_type: 'endpoint',
        resource_id: endpoint.id,
        spending_key: spendingCheck.spending_key,
        retry_after_seconds: spendingCheck.retry_after_seconds,
      },
    };
  }

  return {
    allowed: true,
    decisionId,
    estimatedCostPerTokenUsd,
  };
}
