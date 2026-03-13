import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import {
  getProjectResourcePolicyOrDefault,
  upsertProjectResourcePolicy,
} from './project-resource-policy-store.js';
import { readRequestId, validatePolicyRuleKeys } from './project-source-route-handler-utils.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;
type ManagedPolicyResourceType = 'endpoint' | 'source_library' | 'agent';

type PolicyRulePayload = {
  access_mode?: 'allow_all_members' | 'allow_list';
  allowed_subjects?: Array<{
    subject_type: 'group' | 'user';
    subject_id: string;
    rate_limits?: Record<string, unknown>;
    spending_limits?: Record<string, unknown>;
  }>;
  rate_limits?: Record<string, unknown>;
  spending_limits?: Record<string, unknown>;
};

function isManagedPolicyResourceType(resourceType: string): resourceType is ManagedPolicyResourceType {
  return resourceType === 'endpoint' || resourceType === 'source_library' || resourceType === 'agent';
}

export async function handleProjectResourcePolicyRoute(args: {
  method: string;
  workspaceId: string;
  projectId: string;
  resourceType: string;
  resourceId: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  allowedRateKeys: Record<ManagedPolicyResourceType, readonly string[]>;
  allowedLimitKeys: Record<ManagedPolicyResourceType, readonly string[]>;
}): Promise<boolean> {
  const {
    method,
    workspaceId,
    projectId,
    resourceType,
    resourceId,
    req,
    res,
    deps,
    user,
    json,
    readBody,
    allowedRateKeys,
    allowedLimitKeys,
  } = args;

  if (method === 'GET') {
    if (!isManagedPolicyResourceType(resourceType)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'unsupported_resource_type' });
      return true;
    }
    const policy = getProjectResourcePolicyOrDefault(
      workspaceId,
      projectId,
      resourceType,
      resourceId,
    );
    json(res, 200, {
      ...policy,
      allowed_subjects: policy.allowed_subjects.map((subject) => ({
        ...subject,
      })),
    });
    return true;
  }

  if (method === 'PATCH') {
    const requestId = readRequestId(req);
    const writePolicyUpdateError = async (errorMessage: string) => {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'resource_policy.updated',
        result: 'error',
        requestId,
        resourceType: 'resource_policy',
        resourceId: `${resourceType}:${resourceId}`,
        errorCode: 'VALIDATION_ERROR',
        errorMessage,
        metadata: {
          governed_resource_type: resourceType,
          governed_resource_id: resourceId,
        },
      });
    };

    if (!isManagedPolicyResourceType(resourceType)) {
      await writePolicyUpdateError('unsupported_resource_type');
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'unsupported_resource_type' });
      return true;
    }

    const body = await readBody(req) as PolicyRulePayload;
    if (!body || (body.access_mode !== 'allow_all_members' && body.access_mode !== 'allow_list') || !Array.isArray(body.allowed_subjects)) {
      await writePolicyUpdateError('access_mode and allowed_subjects are required');
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'access_mode and allowed_subjects are required' });
      return true;
    }

    const rateValidation = validatePolicyRuleKeys({
      resourceType,
      kind: 'rate_limits',
      payload: body.rate_limits,
      allowedRateKeys,
      allowedLimitKeys,
    });
    if (!rateValidation.ok) {
      await writePolicyUpdateError(rateValidation.message);
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: rateValidation.message });
      return true;
    }

    const spendingValidation = validatePolicyRuleKeys({
      resourceType,
      kind: 'spending_limits',
      payload: body.spending_limits,
      allowedRateKeys,
      allowedLimitKeys,
    });
    if (!spendingValidation.ok) {
      await writePolicyUpdateError(spendingValidation.message);
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: spendingValidation.message });
      return true;
    }

    const previousPolicy = getProjectResourcePolicyOrDefault(
      workspaceId,
      projectId,
      resourceType,
      resourceId,
    );
    const validatedSubjects: Array<{
      subject_type: 'group' | 'user';
      subject_id: string;
      rate_limits?: Record<string, unknown>;
      spending_limits?: Record<string, unknown>;
    }> = [];

    for (const subject of body.allowed_subjects) {
      if (
        !subject
        || typeof subject !== 'object'
        || ((subject as { subject_type?: unknown }).subject_type !== 'group'
          && (subject as { subject_type?: unknown }).subject_type !== 'user')
        || typeof (subject as { subject_id?: unknown }).subject_id !== 'string'
      ) {
        continue;
      }
      const typedSubject = subject as {
        subject_type: 'group' | 'user';
        subject_id: string;
        rate_limits?: Record<string, unknown>;
        spending_limits?: Record<string, unknown>;
      };
      const subjectRateValidation = validatePolicyRuleKeys({
        resourceType,
        kind: 'rate_limits',
        payload: typedSubject.rate_limits,
        allowedRateKeys,
        allowedLimitKeys,
      });
      if (!subjectRateValidation.ok) {
        await writePolicyUpdateError(subjectRateValidation.message);
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: subjectRateValidation.message });
        return true;
      }
      const subjectSpendingValidation = validatePolicyRuleKeys({
        resourceType,
        kind: 'spending_limits',
        payload: typedSubject.spending_limits,
        allowedRateKeys,
        allowedLimitKeys,
      });
      if (!subjectSpendingValidation.ok) {
        await writePolicyUpdateError(subjectSpendingValidation.message);
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: subjectSpendingValidation.message });
        return true;
      }
      validatedSubjects.push({ ...typedSubject });
    }

    const normalizedAllowedSubjects = validatedSubjects.map((subject) => ({
      ...subject,
      updated_at: new Date().toISOString(),
    }));
    upsertProjectResourcePolicy(workspaceId, projectId, {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: body.access_mode,
      allowed_subjects: normalizedAllowedSubjects,
      rate_limits: body.rate_limits,
      spending_limits: body.spending_limits,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'resource_policy.updated',
      requestId,
      resourceType: 'resource_policy',
      resourceId: `${resourceType}:${resourceId}`,
      metadata: {
        governed_resource_type: resourceType,
        governed_resource_id: resourceId,
        access_mode: {
          from: previousPolicy.access_mode,
          to: body.access_mode,
        },
        allowed_subjects_count: {
          from: Array.isArray(previousPolicy.allowed_subjects) ? previousPolicy.allowed_subjects.length : 0,
          to: normalizedAllowedSubjects.length,
        },
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}
