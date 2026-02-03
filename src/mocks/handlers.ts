/**
 * MSW Handlers
 *
 * Comprehensive mock API handlers for development.
 * All handlers use fixtures from ./fixtures and support CRUD operations.
 */

import { http, HttpResponse } from 'msw';
import type { RecipeMessage } from '@/lib/types/recipe';
import {
  workspaceFixtures,
  projectFixtures,
  projectMembershipFixtures,
  agentFixtures,
  agentServiceKeyFixtures,
  endpointFixtures,
  endpointACLFixtures,
  credentialFixtures,
  credentialSecrets,
  memberFixtures,
  joinRequestFixtures,
  auditEventFixtures,
  usageRecordFixtures,
  userAPIKeyFixtures,
  userProfileFixture,
  userNotificationFixtures,
  chatSessionFixtures,
  chatMessageFixtures,
  attachmentFixtures,
  sourceFileFixtures,
  agentThreadFixtures,
  turnFixtures,
  recipeFixtures,
  recipeMessageFixtures,
  artifactFixtures,
  usageKPI,
} from './fixtures';

// In-memory store for custom permission templates (mock only)
const customPermissionTemplates: Array<{
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  is_default: boolean;
  is_readonly: boolean;
}> = [];

// In-memory store for quota templates (mock only)
const customQuotaTemplates: Array<{
  id: string;
  name: string;
  description?: string;
  overrides_json: Record<string, unknown>;
}> = [];

// ============================================================
// Utility Functions
// ============================================================

function getId(params: Record<string, string | readonly string[] | undefined>, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return (value as string | undefined) ?? '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function getPagination(url: URL) {
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '10');
  return { page, pageSize };
}

function paginated<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return {
    items: items.slice(start, end),
    total: items.length,
    page,
    page_size: pageSize,
    has_more: end < items.length,
  };
}

// ============================================================
// MSW Handlers
// ============================================================

export const handlers = [
  // ============================================================
  // Health Check
  // ============================================================

  http.get('/api/health', () => {
    return HttpResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }),

  // ============================================================
  // Workspaces
  // ============================================================

  http.get('/api/workspaces', () => {
    return HttpResponse.json({
      items: workspaceFixtures,
      total: workspaceFixtures.length,
    });
  }),

  // ============================================================
  // Projects
  // ============================================================

  http.get('/api/workspaces/:ws/projects', ({ request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    return HttpResponse.json(paginated(projectFixtures, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj', ({ params }) => {
    const projectId = getId(params, 'prj');
    const project = projectFixtures.find((p) => p.id === projectId);
    if (!project) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Project not found' }, { status: 404 });
    }
    return HttpResponse.json(project);
  }),

  http.post('/api/workspaces/:ws/projects', async ({ request }) => {
    const body: any = await request.json();

    if (!body || !body.name) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'Request body is required' }, { status: 400 });
    }
    const newProject = {
      id: `proj_${Date.now()}`,
      workspace_id: body.workspace_id || '',
      name: body.name,
      description: body.description,
      visibility: body.visibility || 'private',
      join_policy: body.join_policy || 'approval_required',
      owner_id: 'user_001',
      status: 'active' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    projectFixtures.push(newProject);
    return HttpResponse.json(newProject, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj', async ({ params, request }) => {
    const projectId = getId(params, 'prj');
    const body: any = await request.json();
    const index = projectFixtures.findIndex((p) => p.id === projectId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Project not found' }, { status: 404 });
    }
    projectFixtures[index] = { ...projectFixtures[index], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(projectFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj', ({ params }) => {
    const projectId = getId(params, 'prj');
    const index = projectFixtures.findIndex((p) => p.id === projectId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Project not found' }, { status: 404 });
    }
    projectFixtures.splice(index, 1);
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Agents
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/agents', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const filtered = agentFixtures.filter((a) => a.project_id === projectId);
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/agents/:agent', ({ params }) => {
    const agentId = getId(params, 'agent');
    const agent = agentFixtures.find((a) => a.id === agentId);
    if (!agent) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Agent not found' }, { status: 404 });
    }
    return HttpResponse.json(agent);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/agents', async ({ params, request }) => {
    const body: any = await request.json();
    const newAgent = {
      id: `agent_${Date.now()}`,
      project_id: getId(params, 'prj'),
      name: body.name,
      description: body.description,
      mode: body.mode || 'external',
      interaction_mode: body.interaction_mode || 'both',
      presence: 'offline' as const,
      status: 'enabled' as const,
      config: body.config,
      owner_id: 'user_current',
      owner_name: 'Current User',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentFixtures.push(newAgent);
    return HttpResponse.json(newAgent, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/agents/:agent', async ({ params, request }) => {
    const agentId = getId(params, 'agent');
    const body: any = await request.json();
    const index = agentFixtures.findIndex((a) => a.id === agentId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Agent not found' }, { status: 404 });
    }
    agentFixtures[index] = { ...agentFixtures[index], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(agentFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/agents/:agent', ({ params }) => {
    const agentId = getId(params, 'agent');
    const index = agentFixtures.findIndex((a) => a.id === agentId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Agent not found' }, { status: 404 });
    }
    agentFixtures.splice(index, 1);
    return HttpResponse.json({ success: true });
  }),

  // Agent Service Keys
  http.get('/api/workspaces/:ws/projects/:prj/agents/:agent/keys', ({ params }) => {
    const agentId = getId(params, 'agent');
    const keys = agentServiceKeyFixtures.filter((k) => k.agent_id === agentId && k.status === 'active');
    return HttpResponse.json({ items: keys, total: keys.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/agents/:agent/keys', async ({ params }) => {
    const agentId = getId(params, 'agent');
    const agent = agentFixtures.find((a) => a.id === agentId);
    if (agent?.mode === 'internal') {
      return HttpResponse.json(
        { error_code: 'INTERNAL_AGENT_NO_ASK', message: 'Internal agents cannot have service keys (ASK)' },
        { status: 400 }
      );
    }
    const secret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const fullKey = `ask_${secret}`;
    const keyPrefix = `ask-***${secret.slice(-9)}`;
    const newKey = {
      id: `ask_${Date.now()}`,
      agent_id: agentId,
      key_prefix: keyPrefix,
      status: 'active' as const,
      created_at: new Date().toISOString(),
      key: fullKey,
    };
    const { key: _key, ...stored } = newKey;
    agentServiceKeyFixtures.push(stored as any);
    return HttpResponse.json(newKey, { status: 201 });
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/agents/:agent/keys/:key', ({ params }) => {
    const keyId = getId(params, 'key');
    const index = agentServiceKeyFixtures.findIndex((k) => k.id === keyId);
    if (index !== -1) {
      agentServiceKeyFixtures[index].status = 'revoked';
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Endpoints
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/endpoints', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const filtered = endpointFixtures.filter((e) => e.project_id === projectId);
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const endpoint = endpointFixtures.find((e) => e.id === endpointId);
    if (!endpoint) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Endpoint not found' }, { status: 404 });
    }
    return HttpResponse.json(endpoint);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/endpoints', async ({ params, request }) => {
    const body: any = await request.json();
    const projectId = getId(params, 'prj');
    const existing = endpointFixtures.find(
      (e) => e.project_id === projectId && e.openai_model === body.openai_model
    );
    if (existing) {
      return HttpResponse.json(
        { error_code: 'ENDPOINT_MODEL_CONFLICT', message: 'Model ID already exists in this project' },
        { status: 409 }
      );
    }
    const newEndpoint = {
      id: `endpoint_${Date.now()}`,
      project_id: projectId,
      name: body.name,
      description: body.description,
      openai_model: body.openai_model,
      type: body.type || 'openai',
      base_url: body.base_url,
      status: 'active' as const,
      credential_ref: body.credential_ref,
      limits: body.limits,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    endpointFixtures.push(newEndpoint);
    return HttpResponse.json(newEndpoint, { status: 201 });
  }),

  http.put('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint', async ({ params, request }) => {
    const endpointId = getId(params, 'endpoint');
    const body: any = await request.json();
    const index = endpointFixtures.findIndex((e) => e.id === endpointId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Endpoint not found' }, { status: 404 });
    }
    endpointFixtures[index] = { ...endpointFixtures[index], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(endpointFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const index = endpointFixtures.findIndex((e) => e.id === endpointId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Endpoint not found' }, { status: 404 });
    }
    endpointFixtures.splice(index, 1);
    return HttpResponse.json({ success: true });
  }),

  // Endpoint ACL
  http.get('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint/acl', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const acl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    if (!acl) {
      return HttpResponse.json({ endpoint_id: endpointId, deny_list: [] });
    }
    return HttpResponse.json(acl);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint/acl/deny', async ({ params, request }) => {
    const endpointId = getId(params, 'endpoint');
    const body: any = await request.json();
    const acl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    if (!acl) {
      const newAcl = { endpoint_id: endpointId, deny_list: [] };
      endpointACLFixtures.push(newAcl);
    }
    const aclEntry = {
      user_id: body.user_id,
      reason: body.reason,
      added_at: new Date().toISOString(),
      added_by: 'user_001',
    };
    const currentAcl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    currentAcl!.deny_list.push(aclEntry);
    return HttpResponse.json(aclEntry, { status: 201 });
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint/acl/deny/:userId', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const userId = getId(params, 'userId');
    const acl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    if (acl) {
      acl.deny_list = acl.deny_list.filter((d) => d.user_id !== userId);
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Credentials
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/credentials', ({ params }) => {
    const projectId = getId(params, 'prj');
    const filtered = credentialFixtures.filter((c) => c.project_id === projectId);
    return HttpResponse.json({ items: filtered, total: filtered.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/credentials', async ({ params, request }) => {
    const projectId = getId(params, 'prj');
    const workspaceId = getId(params, 'ws');
    const body: any = await request.json();
    const value = body.value || '';
    const fingerprint = value.length >= 4 ? `••••••••••••${value.slice(-4)}` : '••••••••••••****';
    const newCred = {
      id: `cred_${Date.now()}`,
      workspace_id: workspaceId,
      project_id: projectId,
      name: body.name || 'Unnamed',
      type: 'api_key' as const,
      fingerprint,
      created_at: new Date().toISOString(),
    };
    credentialFixtures.push(newCred);
    credentialSecrets[newCred.id] = value;
    return HttpResponse.json(newCred, { status: 201 });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/credentials/:cred/rotate', async ({ params, request }) => {
    const credId = getId(params, 'cred');
    const body: any = await request.json();
    const value = body.value || '';
    const index = credentialFixtures.findIndex((c) => c.id === credId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Credential not found' }, { status: 404 });
    }
    const fingerprint = value.length >= 4 ? `••••••••••••${value.slice(-4)}` : '••••••••••••****';
    credentialFixtures[index] = {
      ...credentialFixtures[index],
      fingerprint,
      last_rotated_at: new Date().toISOString(),
    };
    credentialSecrets[credId] = value;
    return HttpResponse.json(credentialFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/credentials/:cred', ({ params }) => {
    const credId = getId(params, 'cred');
    const index = credentialFixtures.findIndex((c) => c.id === credId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Credential not found' }, { status: 404 });
    }
    credentialFixtures.splice(index, 1);
    delete credentialSecrets[credId];
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Members
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/members', ({ params }) => {
    const projectId = getId(params, 'prj');
    const memberships = projectMembershipFixtures.filter((m) => m.project_id === projectId);
    const members = memberships.map((m) => {
      const member = memberFixtures.find((mf) => mf.id === m.user_id);
      return {
        ...member,
        role: m.role,
        permissions: m.permissions,
        status: m.status,
        joined_at: m.joined_at,
      };
    });
    return HttpResponse.json({ items: members, total: members.length });
  }),

  http.put('/api/workspaces/:ws/projects/:prj/members/:member/role', async ({ params, request }) => {
    const memberId = getId(params, 'member');
    const projectId = getId(params, 'prj');
    const body: any = await request.json();
    const index = projectMembershipFixtures.findIndex(
      (m) => m.project_id === projectId && m.user_id === memberId
    );
    if (index !== -1) {
      projectMembershipFixtures[index].role = body.role;
      projectMembershipFixtures[index].permissions = body.permissions;
    }
    return HttpResponse.json({ success: true });
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/members/:member', ({ params }) => {
    const memberId = getId(params, 'member');
    const projectId = getId(params, 'prj');
    const index = projectMembershipFixtures.findIndex(
      (m) => m.project_id === projectId && m.user_id === memberId
    );
    if (index !== -1) {
      projectMembershipFixtures[index].status = 'removed';
    }
    return HttpResponse.json({ success: true });
  }),

  // Join Requests
  http.get('/api/workspaces/:ws/projects/:prj/join-requests', () => {
    return HttpResponse.json({ items: joinRequestFixtures, total: joinRequestFixtures.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/join-requests/:join/approve', ({ params }) => {
    const joinId = getId(params, 'join');
    const index = joinRequestFixtures.findIndex((j) => j.id === joinId);
    if (index !== -1) {
      joinRequestFixtures[index].status = 'approved';
      joinRequestFixtures[index].reviewed_at = new Date().toISOString();
      joinRequestFixtures[index].reviewed_by = 'user_001';
    }
    return HttpResponse.json({ success: true });
  }),

  // Invites
  http.post('/api/workspaces/:ws/projects/:prj/invites', async ({ request }) => {
    const body = (await request.json()) as { email: string; role_template?: string; expires_in_hours?: number };
    const inviteId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const token = `itk-${inviteId}`;
    const expiresInHours = body.expires_in_hours ?? 168; // 7 days default
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
    // Relative path; client will resolve to full URL when copying
    const inviteUrl = `/join?token=${token}`;
    return HttpResponse.json({
      invite_id: inviteId,
      invite_url: inviteUrl,
      expires_at: expiresAt,
    });
  }),

  // Member Permissions
  http.get('/api/workspaces/:ws/projects/:prj/members/:member/permissions', ({ params }) => {
    const memberId = getId(params, 'member');
    const projectId = getId(params, 'prj');
    const membership = projectMembershipFixtures.find(
      (m) => m.project_id === projectId && m.user_id === memberId
    );
    if (!membership) {
      return HttpResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    return HttpResponse.json({
      platform_permissions: membership.permissions,
      resource_permissions: {},
    });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/members/:member/permissions', async ({ params, request }) => {
    const memberId = getId(params, 'member');
    const projectId = getId(params, 'prj');
    const body: any = await request.json();
    const index = projectMembershipFixtures.findIndex(
      (m) => m.project_id === projectId && m.user_id === memberId
    );
    if (index !== -1) {
      if (body.permissions) {
        projectMembershipFixtures[index].permissions = body.permissions;
      }
      if (body.template) {
        // Apply template permissions
        const { ROLE_TEMPLATES } = require('@/lib/constants/permissions');
        projectMembershipFixtures[index].permissions = [...ROLE_TEMPLATES[body.template]];
        projectMembershipFixtures[index].role = body.template;
      }
    }
    return HttpResponse.json({ success: true });
  }),

  // Member Quota Overrides
  http.get('/api/workspaces/:ws/projects/:prj/members/:member/quota-overrides', () => {
    return HttpResponse.json({ overrides: {} });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/members/:member/quota-overrides/history', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('page_size') || '20');
    const sampleHistory = [
      {
        id: 'qoh_001',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        created_by_user_id: 'user_001',
        overrides_json: { userdata: { storage: { bytes_per_end_user: 1073741824 } } },
      },
      {
        id: 'qoh_002',
        created_at: new Date(Date.now() - 172800000).toISOString(),
        created_by_user_id: 'user_002',
        overrides_json: {},
      },
    ];
    const start = (page - 1) * pageSize;
    const items = sampleHistory.slice(start, start + pageSize);
    return HttpResponse.json({
      items,
      total: sampleHistory.length,
      page,
      page_size: pageSize,
    });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/members/:member/quota-overrides', async ({ request }) => {
    const body = (await request.json()) as { overrides?: Record<string, unknown> };
    return HttpResponse.json({ overrides: body.overrides ?? {} });
  }),

  // Resource ACL
  http.get('/api/workspaces/:ws/projects/:prj/resources/:type/:id/acl', ({ params }) => {
    const resourceType = getId(params, 'type');
    const resourceId = getId(params, 'id');
    return HttpResponse.json({
      resource_type: resourceType,
      resource_id: resourceId,
      allow: [],
      deny: [],
    });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/resources/:type/:id/acl', async ({ request }) => {
    await request.json(); // Consume body - in real impl would persist
    return HttpResponse.json({ success: true });
  }),

  // Permission Templates (custom templates stored in-memory for mock)
  http.get('/api/workspaces/:ws/projects/:prj/permission-templates', () => {
    const { ROLE_TEMPLATES } = require('@/lib/constants/permissions');
    const defaultTemplates = [
      {
        id: 'owner',
        name: 'Owner',
        description: 'Full access to all project resources',
        permissions: ROLE_TEMPLATES.owner,
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'admin',
        name: 'Admin',
        description: 'Full access except project deletion',
        permissions: ROLE_TEMPLATES.admin,
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'developer',
        name: 'Developer',
        description: 'Can develop and issue agent keys',
        permissions: ROLE_TEMPLATES.developer,
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'user',
        name: 'User',
        description: 'Read-only and basic operations',
        permissions: ROLE_TEMPLATES.user,
        is_default: true,
        is_readonly: true,
      },
    ];
    const items = [...defaultTemplates, ...customPermissionTemplates];
    return HttpResponse.json({ items });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/permission-templates', async ({ request }) => {
    const body = (await request.json()) as { name: string; description?: string; permissions: string[] };
    const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const template = {
      id,
      name: body.name,
      description: body.description,
      permissions: body.permissions ?? [],
      is_default: false,
      is_readonly: false,
    };
    customPermissionTemplates.push(template);
    return HttpResponse.json(template, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/permission-templates/:tid', async ({ params, request }) => {
    const templateId = getId(params, 'tid');
    const body = (await request.json()) as { name?: string; description?: string; permissions?: string[] };
    const index = customPermissionTemplates.findIndex((t) => t.id === templateId);
    if (index === -1) {
      return HttpResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    if (customPermissionTemplates[index].is_readonly) {
      return HttpResponse.json({ error: 'Cannot edit default template' }, { status: 403 });
    }
    if (body.name !== undefined) customPermissionTemplates[index].name = body.name;
    if (body.description !== undefined) customPermissionTemplates[index].description = body.description;
    if (body.permissions !== undefined) customPermissionTemplates[index].permissions = body.permissions;
    return HttpResponse.json(customPermissionTemplates[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/permission-templates/:tid', ({ params }) => {
    const templateId = getId(params, 'tid');
    const index = customPermissionTemplates.findIndex((t) => t.id === templateId);
    if (index === -1) {
      return HttpResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    if (customPermissionTemplates[index].is_readonly) {
      return HttpResponse.json({ error: 'Cannot delete default template' }, { status: 403 });
    }
    customPermissionTemplates.splice(index, 1);
    return HttpResponse.json({ success: true });
  }),

  // Quota Templates
  http.get('/api/workspaces/:ws/projects/:prj/quota-templates', () => {
    return HttpResponse.json([...customQuotaTemplates]);
  }),

  http.get('/api/workspaces/:ws/projects/:prj/quota-templates/:tid', ({ params }) => {
    const templateId = getId(params, 'tid');
    const template = customQuotaTemplates.find((t) => t.id === templateId);
    if (!template) {
      return HttpResponse.json({ error: 'Quota template not found' }, { status: 404 });
    }
    return HttpResponse.json(template);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/quota-templates', async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      description?: string;
      overrides_json?: Record<string, unknown>;
    };
    const id = `qot_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const template = {
      id,
      name: body.name,
      description: body.description,
      overrides_json: body.overrides_json ?? {},
    };
    customQuotaTemplates.push(template);
    return HttpResponse.json(template, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/quota-templates/:tid', async ({ params, request }) => {
    const templateId = getId(params, 'tid');
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      overrides_json?: Record<string, unknown>;
    };
    const index = customQuotaTemplates.findIndex((t) => t.id === templateId);
    if (index === -1) {
      return HttpResponse.json({ error: 'Quota template not found' }, { status: 404 });
    }
    if (body.name !== undefined) customQuotaTemplates[index].name = body.name;
    if (body.description !== undefined) customQuotaTemplates[index].description = body.description;
    if (body.overrides_json !== undefined) customQuotaTemplates[index].overrides_json = body.overrides_json;
    return HttpResponse.json(customQuotaTemplates[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/quota-templates/:tid', ({ params }) => {
    const templateId = getId(params, 'tid');
    const index = customQuotaTemplates.findIndex((t) => t.id === templateId);
    if (index === -1) {
      return HttpResponse.json({ error: 'Quota template not found' }, { status: 404 });
    }
    customQuotaTemplates.splice(index, 1);
    return HttpResponse.json(null, { status: 204 });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/quota-templates/:tid/apply', async ({ params, request }) => {
    const templateId = getId(params, 'tid');
    const body = (await request.json()) as { member_ids: string[] };
    const template = customQuotaTemplates.find((t) => t.id === templateId);
    if (!template) {
      return HttpResponse.json({ error: 'Quota template not found' }, { status: 404 });
    }
    const count = body.member_ids?.length ?? 0;
    return HttpResponse.json({ applied_count: count });
  }),

  // Member Change History
  http.get('/api/workspaces/:ws/projects/:prj/members/:member/change-history', () => {
    // Return empty change history for now
    return HttpResponse.json({ items: [] });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/join-requests/:join/reject', ({ params }) => {
    const joinId = getId(params, 'join');
    const index = joinRequestFixtures.findIndex((j) => j.id === joinId);
    if (index !== -1) {
      joinRequestFixtures[index].status = 'rejected';
      joinRequestFixtures[index].reviewed_at = new Date().toISOString();
      joinRequestFixtures[index].reviewed_by = 'user_001';
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Audit & Usage
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/audit', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    
    // Filter by project_id
    let filtered = auditEventFixtures.filter((e) => e.project_id === projectId);
    
    // Apply filters
    const startTime = url.searchParams.get('start_time');
    const endTime = url.searchParams.get('end_time');
    const action = url.searchParams.get('action');
    const actorType = url.searchParams.get('actor_type');
    const actorId = url.searchParams.get('actor_id');
    const endUserId = url.searchParams.get('end_user_id');
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const result = url.searchParams.get('result');
    
    if (startTime) {
      filtered = filtered.filter((e) => e.timestamp >= startTime);
    }
    if (endTime) {
      filtered = filtered.filter((e) => e.timestamp <= endTime);
    }
    if (action) {
      filtered = filtered.filter((e) => e.action === action);
    }
    if (actorType) {
      filtered = filtered.filter((e) => e.actor_type === actorType);
    }
    if (actorId) {
      filtered = filtered.filter((e) => e.actor_id.includes(actorId));
    }
    if (endUserId) {
      filtered = filtered.filter((e) => e.end_user_id === endUserId);
    }
    if (resourceType) {
      filtered = filtered.filter((e) => e.resource_type === resourceType);
    }
    if (resourceId) {
      filtered = filtered.filter((e) => e.resource_id?.includes(resourceId));
    }
    if (result) {
      filtered = filtered.filter((e) => e.result === result);
    }
    
    // Sort by timestamp (default desc)
    const sortOrder = url.searchParams.get('sort_order') || 'desc';
    filtered.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
    });
    
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/usage/kpi', ({ params, request }) => {
    const url = new URL(request.url);
    const projectId = getId(params, 'prj');
    const endUserId = url.searchParams.get('end_user_id');

    // Filter usage records by project and calculate KPI
    let filtered = usageRecordFixtures.filter((r) => r.project_id === projectId);
    if (endUserId) {
      filtered = filtered.filter((r) => r.end_user_id === endUserId);
    }
    const startTime = url.searchParams.get('start_time');
    const endTime = url.searchParams.get('end_time');
    
    const kpiData = { ...usageKPI };
    
    if (startTime && endTime) {
      // Calculate from filtered records
      const timeFiltered = filtered.filter((r) => {
        const bucketTime = new Date(r.time_bucket).getTime();
        return bucketTime >= new Date(startTime).getTime() && bucketTime <= new Date(endTime).getTime();
      });
      
      kpiData.requests_today = timeFiltered.reduce((sum, r) => sum + r.requests, 0);
      kpiData.tokens_today = timeFiltered.reduce((sum, r) => sum + (r.tokens || 0), 0);
    }
    
    return HttpResponse.json(kpiData);
  }),

  http.get('/api/workspaces/:ws/projects/:prj/usage', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    
    // Filter by project_id
    let filtered = usageRecordFixtures.filter((r) => r.project_id === projectId);
    
    // Apply filters
    const startTime = url.searchParams.get('start_time');
    const endTime = url.searchParams.get('end_time');
    const resourceType = url.searchParams.get('resource_type');
    const agentId = url.searchParams.get('agent_id');
    const endUserId = url.searchParams.get('end_user_id');
    
    if (startTime) {
      filtered = filtered.filter((r) => {
        const bucketTime = new Date(r.time_bucket).getTime();
        return bucketTime >= new Date(startTime).getTime();
      });
    }
    if (endTime) {
      filtered = filtered.filter((r) => {
        const bucketTime = new Date(r.time_bucket).getTime();
        return bucketTime <= new Date(endTime).getTime();
      });
    }
    if (resourceType) {
      filtered = filtered.filter((r) => r.resource_type === resourceType);
    }
    if (agentId) {
      filtered = filtered.filter((r) => r.agent_id === agentId);
    }
    if (endUserId) {
      filtered = filtered.filter((r) => r.end_user_id === endUserId);
    }
    
    // Sort by time_bucket (default desc)
    const sortOrder = url.searchParams.get('sort_order') || 'desc';
    filtered.sort((a, b) => {
      const aTime = new Date(a.time_bucket).getTime();
      const bTime = new Date(b.time_bucket).getTime();
      return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
    });
    
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  // ============================================================
  // User API Keys
  // ============================================================

  http.get('/api/user/keys', () => {
    return HttpResponse.json({ items: userAPIKeyFixtures, total: userAPIKeyFixtures.length });
  }),

  http.post('/api/user/keys', async ({ request }) => {
    const body: any = await request.json();
    const secret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const fullKey = `usk_${secret}`;
    const keyPrefix = `usk-***${secret.slice(-9)}`;
    const newKey = {
      id: `key_${Date.now()}`,
      user_id: 'user_001',
      key_prefix: keyPrefix,
      status: 'active' as const,
      note: body.note,
      created_at: new Date().toISOString(),
      expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 24 * 60 * 60 * 1000).toISOString() : undefined,
      key: fullKey, // Full key returned only once on create
    };
    const { key: _key, ...stored } = newKey;
    userAPIKeyFixtures.unshift(stored as any);
    return HttpResponse.json(newKey, { status: 201 });
  }),

  http.delete('/api/user/keys/:key', ({ params }) => {
    const keyId = getId(params, 'key');
    const index = userAPIKeyFixtures.findIndex((k) => k.id === keyId);
    if (index !== -1) {
      userAPIKeyFixtures[index].status = 'revoked';
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Me - Profile & Notifications
  // ============================================================

  http.get('/api/me/profile', () => {
    return HttpResponse.json({ ...userProfileFixture });
  }),

  http.patch('/api/me/profile', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(userProfileFixture, body);
    return HttpResponse.json({ ...userProfileFixture });
  }),

  http.get('/api/me/notifications', ({ request }) => {
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get('unread_only') === 'true';
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    let items = userNotificationFixtures;
    if (unreadOnly) {
      items = items.filter((n) => !n.read_at);
    }
    const total = items.length;
    const paginatedItems = items.slice(offset, offset + limit);
    const unreadCount = userNotificationFixtures.filter((n) => !n.read_at).length;
    return HttpResponse.json({
      items: paginatedItems,
      total,
      unread_count: unreadCount,
    });
  }),

  http.get('/api/me/notifications/unread-count', () => {
    const count = userNotificationFixtures.filter((n) => !n.read_at).length;
    return HttpResponse.json({ unread_count: count });
  }),

  http.post('/api/me/notifications/:id/read', ({ params }) => {
    const id = getId(params, 'id');
    const notif = userNotificationFixtures.find((n) => n.id === id);
    if (notif) {
      notif.read_at = new Date().toISOString();
    }
    return HttpResponse.json(notif || {});
  }),

  http.post('/api/me/notifications/read-all', () => {
    const count = userNotificationFixtures.filter((n) => !n.read_at).length;
    userNotificationFixtures.forEach((n) => {
      n.read_at = new Date().toISOString();
    });
    return HttpResponse.json({ marked_count: count });
  }),

  // ============================================================
  // Chat
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const sessions = chatSessionFixtures.filter((s) => s.project_id === projectId);
    return HttpResponse.json(paginated(sessions, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions/:session', ({ params }) => {
    const sessionId = getId(params, 'session');
    const session = chatSessionFixtures.find((s) => s.id === sessionId);
    if (!session) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Session not found' }, { status: 404 });
    }
    return HttpResponse.json(session);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions', async ({ params, request }) => {
    const projectId = getId(params, 'prj');
    const body: any = await request.json().catch(() => ({}));
    const newSession = {
      id: `chat_${Date.now()}`,
      project_id: projectId,
      title: body?.title || 'New Chat',
      model: body?.model || 'gpt-4o',
      endpoint_id: body?.endpoint_id || 'endpoint_001',
      pinned: false,
      starred: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
      total_tokens: 0,
    };
    chatSessionFixtures.unshift(newSession);
    return HttpResponse.json(newSession, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/chat/sessions/:session', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const body: any = await request.json().catch(() => ({}));
    const idx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Session not found' }, { status: 404 });
    }
    chatSessionFixtures[idx] = {
      ...chatSessionFixtures[idx],
      ...body,
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(chatSessionFixtures[idx]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/chat/sessions/:session', ({ params }) => {
    const sessionId = getId(params, 'session');
    const idx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Session not found' }, { status: 404 });
    }
    chatSessionFixtures.splice(idx, 1);
    for (let i = chatMessageFixtures.length - 1; i >= 0; i--) {
      if (chatMessageFixtures[i].session_id === sessionId) chatMessageFixtures.splice(i, 1);
    }
    for (let i = attachmentFixtures.length - 1; i >= 0; i--) {
      if (attachmentFixtures[i].session_id === sessionId) attachmentFixtures.splice(i, 1);
    }
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const sessionId = getId(params, 'session');
    const messages = chatMessageFixtures.filter((m) => m.session_id === sessionId);
    return HttpResponse.json(paginated(messages, page, pageSize));
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages', async ({ params, request }) => {
    const body: any = await request.json();
    const sessionId = getId(params, 'session');
    const prev = [...chatMessageFixtures].reverse().find((m) => m.session_id === sessionId);
    const newMessage: any = {
      id: `msg_${Date.now()}`,
      session_id: sessionId,
      role: body.role,
      content: body.content,
      created_at: new Date().toISOString(),
      parent_id: body.parent_id ?? prev?.id ?? null,
    };
    chatMessageFixtures.push(newMessage);
    const sidx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (sidx !== -1) {
      chatSessionFixtures[sidx].updated_at = new Date().toISOString();
      chatSessionFixtures[sidx].message_count += 1;
    }
    return HttpResponse.json(newMessage, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages/:message', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const messageId = getId(params, 'message');
    const body: any = await request.json().catch(() => ({}));
    const original = chatMessageFixtures.find((m) => m.id === messageId && m.session_id === sessionId);
    if (!original) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Message not found' }, { status: 404 });
    }
    const logicalId = original.logical_id || `log_${messageId}`;
    const revisionIndex =
      Math.max(
        0,
        ...chatMessageFixtures
          .filter((m: any) => m.session_id === sessionId && m.logical_id === logicalId)
          .map((m: any) => m.revision_index ?? 0),
      ) + 1;
    const now = new Date().toISOString();

    const revision: any = {
      id: `msg_${Date.now()}`,
      session_id: sessionId,
      role: original.role,
      content: body.content,
      created_at: now,
      parent_id: original.parent_id ?? null,
      logical_id: logicalId,
      revision_of: original.id,
      revision_index: revisionIndex,
    };

    chatMessageFixtures.push(revision);
    const sidx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (sidx !== -1) chatSessionFixtures[sidx].updated_at = now;
    return HttpResponse.json(revision);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages/stream', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const body: any = await request.json().catch(() => ({}));

    const encoder = new TextEncoder();
    const streamId = `str_${Date.now()}`;

    const fromMessageId = body.from_message_id as string | undefined;
    const branchLeafMessageId = body.branch_leaf_message_id as string | undefined;
    const fromMessage = fromMessageId ? (chatMessageFixtures as any[]).find((m) => m.id === fromMessageId) : null;
    const parentForFrom = fromMessage?.parent_id
      ? (chatMessageFixtures as any[]).find((m) => m.id === fromMessage.parent_id)
      : null;
    const prompt =
      body?.input?.content ||
      (fromMessage?.role === 'assistant' ? parentForFrom?.content : fromMessage?.content) ||
      '';

    const answer = `**Echo** (mock)\n\n${prompt}\n\n- streaming: ok\n- gfm: ok\n`;

    const sourceMessage = fromMessageId ? (chatMessageFixtures as any[]).find((m) => m.id === fromMessageId) : null;
    const sourceParentId = sourceMessage?.parent_id || null;
    const baseGroupId = sourceMessage?.variant_group_id || (sourceParentId ? `vg_${sourceParentId}` : undefined);
    const vg = baseGroupId || `vg_${fromMessageId || branchLeafMessageId || sessionId}`;
    const existingVariants = (chatMessageFixtures as any[]).filter((m) => m.session_id === sessionId && m.variant_group_id === vg);
    const variantIndex = existingVariants.length;
    const assistantMessageId = `msg_${Date.now() + 1}`;

    const sse = new ReadableStream({
      start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        send('meta', { stream_id: streamId, session_id: sessionId, model: body.model, endpoint_id: body.endpoint_id });

        const chunkSize = 10;
        let idx = 0;

        const tick = () => {
          if (idx >= answer.length) {
            // Persist assistant message (final content)
            (chatMessageFixtures as any[]).push({
              id: assistantMessageId,
              session_id: sessionId,
              role: 'assistant',
              content: answer,
              created_at: new Date().toISOString(),
              parent_id: sourceMessage?.role === 'assistant' ? sourceParentId : (branchLeafMessageId || fromMessageId || null),
              variant_group_id: vg,
              variant_index: variantIndex,
              is_stale: false,
            });
            const sidx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
            if (sidx !== -1) {
              chatSessionFixtures[sidx].updated_at = new Date().toISOString();
              chatSessionFixtures[sidx].message_count += 1;
            }
            send('done', { message_id: assistantMessageId, finish_reason: 'stop', tokens: 120 });
            controller.close();
            return;
          }
          const delta = answer.slice(idx, idx + chunkSize);
          idx += chunkSize;
          send('delta', { message_id: assistantMessageId, variant_group_id: vg, variant_index: variantIndex, delta });
          setTimeout(tick, 40);
        };

        tick();
      },
    });

    return new HttpResponse(sse, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/streams/:stream_id/cancel', () => {
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attachments = attachmentFixtures.filter((a) => a.session_id === sessionId);
    return HttpResponse.json({ items: attachments, total: attachments.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/init', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const body: any = await request.json().catch(() => ({}));
    const attId = `att_${Date.now()}`;
    const att: any = {
      id: attId,
      session_id: sessionId,
      file_name: body.file_name,
      file_type: body.file_type,
      file_size: body.file_size,
      upload_status: 'uploading',
      created_at: new Date().toISOString(),
    };
    attachmentFixtures.push(att);
    return HttpResponse.json(
      {
        attachment: att,
        upload_url: `/api/workspaces/${getId(params, 'ws')}/projects/${getId(params, 'prj')}/chat/sessions/${sessionId}/attachments/${attId}/upload`,
      },
      { status: 201 },
    );
  }),

  http.put('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att/upload', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures[idx].upload_status = 'processing';
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att/complete', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures[idx].upload_status = 'ready';
    attachmentFixtures[idx].error_message = undefined;
    return HttpResponse.json(attachmentFixtures[idx]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures.splice(idx, 1);
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att/retry', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures[idx].upload_status = 'processing';
    attachmentFixtures[idx].error_message = undefined;
    setTimeout(() => {
      const again = attachmentFixtures.find((a) => a.id === attId && a.session_id === sessionId);
      if (again) again.upload_status = 'ready';
    }, 600);
    return HttpResponse.json(attachmentFixtures[idx]);
  }),

  // ============================================================
  // Workbench
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/sources', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const workspaceId = getId(params, 'ws');
    const filtered = sourceFileFixtures.filter((f) => f.project_id === projectId);
    const mapped = filtered.map((f) => ({
      id: f.id,
      workspace_id: workspaceId,
      project_id: f.project_id,
      owner_user_id: 'user_001',
      filename: f.file_name,
      file_type: f.file_type,
      file_size: f.file_size,
      object_ref: { bucket: 'mock', key: f.id },
      version: 1,
      created_at: f.created_at,
      updated_at: f.updated_at,
      ai_ready: f.status === 'ready' ? { id: `ar_${f.id}`, source_file_id: f.id, status: 'ready' as const, created_at: f.created_at, updated_at: f.updated_at } : f.status === 'processing' ? { id: `ar_${f.id}`, source_file_id: f.id, status: 'preparing' as const, created_at: f.created_at, updated_at: f.updated_at } : f.status === 'failed' ? { id: `ar_${f.id}`, source_file_id: f.id, status: 'failed' as const, error_message: f.error_message, created_at: f.created_at, updated_at: f.updated_at } : undefined,
      ai_ready_usage: f.status === 'ready' ? { docdb_bytes: 1024, vectordb_bytes: 2048, chunks_count: 5 } : undefined,
    }));
    return HttpResponse.json(paginated(mapped, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/threads', () => {
    return HttpResponse.json({ items: agentThreadFixtures, total: agentThreadFixtures.length });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/threads/:thread', ({ params }) => {
    const threadId = getId(params, 'thread');
    const thread = agentThreadFixtures.find((t) => t.id === threadId);
    if (!thread) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Thread not found' }, { status: 404 });
    }
    return HttpResponse.json(thread);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/threads', async ({ params, request }) => {
    const body: any = await request.json();
    const newThread = {
      id: `thread_${Date.now()}`,
      project_id: getId(params, 'prj'),
      end_user_id: body.end_user_id,
      current_agent_id: body.agent_id,
      title: body.title,
      status: 'active' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentThreadFixtures.push(newThread);
    return HttpResponse.json(newThread, { status: 201 });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/threads/:thread/turns', ({ params }) => {
    const threadId = getId(params, 'thread');
    const turns = turnFixtures.filter((t) => t.agent_thread_id === threadId);
    return HttpResponse.json({ items: turns, total: turns.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/threads/:thread/turns', async ({ params, request }) => {
    const body: any = await request.json();
    const newTurn = {
      id: `turn_${Date.now()}`,
      agent_thread_id: getId(params, 'thread'),
      status: 'queued' as const,
      input_message: body.message,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    turnFixtures.push(newTurn);
    return HttpResponse.json(newTurn, { status: 201 });
  }),

  // ============================================================
  // Recipes
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/recipes', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const filtered = recipeFixtures.filter((r) => r.project_id === projectId);
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/recipes/:recipe', ({ params }) => {
    const recipeId = getId(params, 'recipe');
    const projectId = getId(params, 'prj');
    // Find recipe by ID and also filter by project to ensure it belongs to the project
    const recipe = recipeFixtures.find((r) => r.id === recipeId && r.project_id === projectId);
    if (!recipe) {
      // Debug: log available recipes for troubleshooting
      console.log('[MSW] Recipe not found:', { recipeId, projectId, availableRecipes: recipeFixtures.map(r => ({ id: r.id, project_id: r.project_id })) });
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Recipe not found' }, { status: 404 });
    }
    return HttpResponse.json(recipe);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/recipes', async ({ params, request }) => {
    const body: any = await request.json();
    const projectId = getId(params, 'prj');
    const workspaceId = getId(params, 'ws');
    const agent = agentFixtures.find((a) => a.id === body.agent_id);
    const recipeId = `recipe_${Date.now()}`;
    const now = new Date().toISOString();
    const newRecipe = {
      id: recipeId,
      workspace_id: workspaceId,
      project_id: projectId,
      owner_user_id: 'user_001',
      title: body.title,
      agent_id: body.agent_id,
      agent_name: agent?.name || 'Unknown Agent',
      status: 'active' as const,
      attached_source_ids: body.initial_source_ids || [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    recipeFixtures.push(newRecipe);
    // Debug: log created recipe
    console.log('[MSW] Created recipe:', { recipeId, projectId, workspaceId, totalRecipes: recipeFixtures.length });
    return HttpResponse.json(newRecipe, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/recipes/:recipe', async ({ params, request }) => {
    const recipeId = getId(params, 'recipe');
    const body: any = await request.json();
    const index = recipeFixtures.findIndex((r) => r.id === recipeId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Recipe not found' }, { status: 404 });
    }
    recipeFixtures[index] = {
      ...recipeFixtures[index],
      ...body,
      updated_at: new Date().toISOString(),
      last_activity_at: body.status ? new Date().toISOString() : recipeFixtures[index].last_activity_at,
    };
    return HttpResponse.json(recipeFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/recipes/:recipe', ({ params }) => {
    const recipeId = getId(params, 'recipe');
    const index = recipeFixtures.findIndex((r) => r.id === recipeId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Recipe not found' }, { status: 404 });
    }
    recipeFixtures.splice(index, 1);
    // Also remove related messages and artifacts
    const messageIndices: number[] = [];
    recipeMessageFixtures.forEach((m, i) => {
      if (m.recipe_id === recipeId) messageIndices.push(i);
    });
    messageIndices.reverse().forEach((i) => recipeMessageFixtures.splice(i, 1));
    const artifactIndices: number[] = [];
    artifactFixtures.forEach((a, i) => {
      if (a.recipe_id === recipeId) artifactIndices.push(i);
    });
    artifactIndices.reverse().forEach((i) => artifactFixtures.splice(i, 1));
    return HttpResponse.json({ success: true });
  }),

  // Recipe Sources
  http.post('/api/workspaces/:ws/projects/:prj/recipes/:recipe/sources', async ({ params, request }) => {
    const recipeId = getId(params, 'recipe');
    const body: any = await request.json();
    const index = recipeFixtures.findIndex((r) => r.id === recipeId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Recipe not found' }, { status: 404 });
    }
    const sourceIds = body.source_ids || [];
    recipeFixtures[index].attached_source_ids = [
      ...new Set([...recipeFixtures[index].attached_source_ids, ...sourceIds]),
    ];
    recipeFixtures[index].updated_at = new Date().toISOString();
    return HttpResponse.json(recipeFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/recipes/:recipe/sources/:source', ({ params }) => {
    const recipeId = getId(params, 'recipe');
    const sourceId = getId(params, 'source');
    const index = recipeFixtures.findIndex((r) => r.id === recipeId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Recipe not found' }, { status: 404 });
    }
    recipeFixtures[index].attached_source_ids = recipeFixtures[index].attached_source_ids.filter(
      (id) => id !== sourceId,
    );
    recipeFixtures[index].updated_at = new Date().toISOString();
    return HttpResponse.json(recipeFixtures[index]);
  }),

  // Recipe Messages
  http.get('/api/workspaces/:ws/projects/:prj/recipes/:recipe/messages', ({ params }) => {
    const recipeId = getId(params, 'recipe');
    const messages = recipeMessageFixtures.filter((m) => m.recipe_id === recipeId);
    return HttpResponse.json(messages);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/recipes/:recipe/messages', async ({ params, request }) => {
    const recipeId = getId(params, 'recipe');
    const body: any = await request.json();
    const newMessage = {
      id: `msg_${Date.now()}`,
      recipe_id: recipeId,
      role: 'user' as const,
      content: body.content,
      created_at: new Date().toISOString(),
    };
    recipeMessageFixtures.push(newMessage);
    
    // Update recipe last_activity_at
    const recipeIndex = recipeFixtures.findIndex((r) => r.id === recipeId);
    if (recipeIndex !== -1) {
      recipeFixtures[recipeIndex].last_activity_at = new Date().toISOString();
      recipeFixtures[recipeIndex].updated_at = new Date().toISOString();
    }

    // Simulate agent response after a delay
    setTimeout(() => {
      const agentMessage: RecipeMessage = {
        id: `msg_${Date.now() + 1}`,
        recipe_id: recipeId,
        role: 'agent',
        content: `This is a mock response to: "${body.content}"\n\nThe agent has processed your request and generated this response.`,
        created_at: new Date().toISOString(),
      };
      recipeMessageFixtures.push(agentMessage);
      
      // Update recipe again
      if (recipeIndex !== -1) {
        recipeFixtures[recipeIndex].last_activity_at = new Date().toISOString();
      }
    }, 1000);

    return HttpResponse.json(newMessage, { status: 201 });
  }),

  // Recipe Artifacts
  http.get('/api/workspaces/:ws/projects/:prj/recipes/:recipe/artifacts', ({ params }) => {
    const recipeId = getId(params, 'recipe');
    const artifacts = artifactFixtures.filter((a) => a.recipe_id === recipeId);
    return HttpResponse.json(artifacts);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/recipes/:recipe/artifacts/:artifact/save', async ({ params, request }) => {
    const artifactId = getId(params, 'artifact');
    const body: any = await request.json();
    const artifact = artifactFixtures.find((a) => a.id === artifactId);
    if (!artifact) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Artifact not found' }, { status: 404 });
    }
    // Create a new source file from artifact
    // Note: This creates a SourceFile in workbench fixtures format
    const newSource = {
      id: `src_${Date.now()}`,
      project_id: getId(params, 'prj'),
      file_name: body.filename || artifact.title || `artifact-${artifactId}`,
      file_type: artifact.type === 'image' ? 'image/png' : 'text/plain',
      file_size: artifact.file_size || 0,
      status: 'ready' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    sourceFileFixtures.push(newSource);
    
    // Return in the format expected by SourceFile type
    const sourceFileResponse = {
      id: newSource.id,
      workspace_id: getId(params, 'ws'),
      project_id: newSource.project_id,
      owner_user_id: 'user_001',
      filename: newSource.file_name,
      file_type: newSource.file_type,
      file_size: newSource.file_size,
      upload_status: 'ready' as const,
      created_at: newSource.created_at,
    };
    return HttpResponse.json(sourceFileResponse, { status: 201 });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/recipes/:recipe/artifacts/:artifact/download', ({ params }) => {
    const artifactId = getId(params, 'artifact');
    const artifact = artifactFixtures.find((a) => a.id === artifactId);
    if (!artifact) {
      return new Response('Artifact not found', { status: 404 });
    }
    // Return a mock blob
    const content = artifact.content || 'Mock artifact content';
    const blob = new Blob([content], { type: artifact.mime_type || 'text/plain' });
    return new Response(blob);
  }),

  // Recipe SSE Events (mock)
  http.get('/api/workspaces/:ws/projects/:prj/recipes/:recipe/events', ({ params }) => {
    const recipeId = getId(params, 'recipe');
    // Return a simple SSE stream that sends a connection event
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ recipe_id: recipeId })}\n\n`));
        // Keep connection open
        setTimeout(() => {
          // Send periodic heartbeat
          const interval = setInterval(() => {
            controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`));
          }, 30000);
          // Cleanup on close
          return () => clearInterval(interval);
        }, 100);
      },
    });
    return new HttpResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),
];

// Export for MSW setup
export default handlers;
