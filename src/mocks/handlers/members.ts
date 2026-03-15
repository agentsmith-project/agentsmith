import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { memberFixtures, memberProjectMembershipFixtures, joinRequestFixtures } from '../fixtures/members';
import { ensureWorkspaceMember } from './workspace';
import { GROUP_TEMPLATES } from '@/lib/constants/permissions';
import {
  PROJECT_BUILT_IN_GROUP_IDS,
  PROJECT_BUILT_IN_TEMPLATE_IDS,
} from '@/lib/governance/member-groups';
import type { ChangeHistoryEntry } from '@/lib/api/types';
import { projects } from './projects';

const members = p0.members.length ? p0.members : memberFixtures.map((m, i) => ({
  ...m,
  role: memberProjectMembershipFixtures[i]?.role ?? 'member',
}));

type PermissionTemplate = {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  is_default?: boolean;
  is_readonly?: boolean;
};

type ProjectGroup = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permission_template_id: string;
  member_ids: string[];
  created_at: string;
  updated_at: string;
  built_in?: boolean;
  system_key?: string;
  membership_mode?: 'manual' | 'system_managed';
  deletable?: boolean;
};

type ResourcePolicy = {
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: Array<{
    subject_type: 'group' | 'user';
    subject_id: string;
    rate_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
    spending_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
  }>;
  rate_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
  spending_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
};

const customPermissionTemplates: PermissionTemplate[] = [];
const projectGroups: ProjectGroup[] = [];
const resourcePolicyStore: Record<string, ResourcePolicy> = {};
const memberChangeHistoryStore: Record<string, ChangeHistoryEntry[]> = {};

const joinRequests = [...joinRequestFixtures];

type BuiltInProjectGroupState = {
  owner: string[];
  admins: string[];
  members: string[];
};

function memberProjectKey(projectId: string, memberId: string): string {
  return `${projectId}:${memberId}`;
}

function buildInitialBuiltInProjectGroupState(projectId: string): BuiltInProjectGroupState {
  const project = projects.find((item) => item.id === projectId);
  const memberships = memberProjectMembershipFixtures.filter(
    (item) => item.project_id === projectId && item.status === 'active',
  );
  const owner = project?.owner_id ? [project.owner_id] : [];
  const admins = memberships
    .filter((item) => item.user_id !== project?.owner_id && item.role === 'admin')
    .map((item) => item.user_id);
  const members = memberships.map((item) => item.user_id);
  return { owner, admins, members };
}

const builtInProjectGroupsState = new Map<string, BuiltInProjectGroupState>();

function getBuiltInProjectGroupState(projectId: string): BuiltInProjectGroupState {
  const existing = builtInProjectGroupsState.get(projectId);
  if (existing) {
    return existing;
  }
  const seeded = buildInitialBuiltInProjectGroupState(projectId);
  builtInProjectGroupsState.set(projectId, seeded);
  return seeded;
}

function buildBuiltInProjectGroups(projectId: string): ProjectGroup[] {
  const state = getBuiltInProjectGroupState(projectId);
  const now = new Date().toISOString();
  return [
    {
      id: PROJECT_BUILT_IN_GROUP_IDS.owner,
      project_id: projectId,
      name: 'Project Owner',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
      member_ids: [...state.owner],
      created_at: now,
      updated_at: now,
      built_in: true,
      system_key: 'owner',
      membership_mode: 'system_managed',
      deletable: false,
    },
    {
      id: PROJECT_BUILT_IN_GROUP_IDS.admins,
      project_id: projectId,
      name: 'Project Admins',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
      member_ids: [...state.admins],
      created_at: now,
      updated_at: now,
      built_in: true,
      system_key: 'admins',
      membership_mode: 'system_managed',
      deletable: false,
    },
    {
      id: PROJECT_BUILT_IN_GROUP_IDS.members,
      project_id: projectId,
      name: 'Project Members',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
      member_ids: [...state.members],
      created_at: now,
      updated_at: now,
      built_in: true,
      system_key: 'members',
      membership_mode: 'system_managed',
      deletable: false,
    },
  ];
}

function syncMembershipPermissionsFromBuiltInGroups(projectId: string): void {
  const state = getBuiltInProjectGroupState(projectId);
  const ownerIds = new Set(state.owner);
  const adminIds = new Set(state.admins);
  const memberIds = new Set(state.members);
  for (const membership of memberProjectMembershipFixtures) {
    if (membership.project_id !== projectId) continue;
    if (ownerIds.has(membership.user_id)) {
      membership.role = 'owner';
      membership.permissions = [...GROUP_TEMPLATES.owner];
      continue;
    }
    if (adminIds.has(membership.user_id)) {
      membership.role = 'admin';
      membership.permissions = [...GROUP_TEMPLATES.admin];
      continue;
    }
    if (memberIds.has(membership.user_id)) {
      membership.role = 'user';
      membership.permissions = [...GROUP_TEMPLATES.user];
    }
  }
}

function getResolvedProjectGroupIdsForUser(projectId: string, userId: string): string[] {
  const builtIns = buildBuiltInProjectGroups(projectId)
    .filter((group) => group.member_ids.includes(userId))
    .map((group) => group.id);
  const custom = projectGroups
    .filter((group) => group.project_id === projectId && group.member_ids.includes(userId))
    .map((group) => group.id);
  return [...new Set([...builtIns, ...custom])];
}

function appendMemberChangeHistory(projectId: string, memberId: string, entry: Omit<ChangeHistoryEntry, 'id' | 'timestamp'>): void {
  const key = memberProjectKey(projectId, memberId);
  const history = memberChangeHistoryStore[key] ?? [];
  history.unshift({
    id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  memberChangeHistoryStore[key] = history.slice(0, 100);
}

function getDefaultPolicy(resourceType: 'endpoint' | 'source_library' | 'agent', resourceId: string): ResourcePolicy {
  if (resourceType === 'agent') {
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
    };
  }

  if (resourceType === 'source_library') {
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'source_library.requests_per_minute', value: 120 }],
      },
      spending_limits: {
        rules: [
          { key: 'source_library.max_total_files', value: 2000 },
          { key: 'source_library.max_file_size_bytes', value: 104857600 },
        ],
      },
    };
  }

  return {
    resource_type: resourceType,
    resource_id: resourceId,
    access_mode: 'allow_all_members',
    allowed_subjects: [],
    spending_limits: {
      rules: [{ key: 'endpoint.usd_spending_per_day', value: 200000, window: 'day' }],
    },
  };
}

function getDefaultProjectGroupIdsForUser(projectId: string, userId: string): string[] {
  return buildBuiltInProjectGroups(projectId)
    .filter((group) => group.member_ids.includes(userId))
    .map((group) => group.id);
}

export const memberHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/members', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const items = members.map((member) => ({
      ...member,
      groups: getResolvedProjectGroupIdsForUser(projectId, member.id).map((groupId) => {
        const group =
          buildBuiltInProjectGroups(projectId).find((item) => item.id === groupId)
          ?? projectGroups.find((item) => item.project_id === projectId && item.id === groupId);
        return { id: groupId, name: group?.name ?? groupId };
      }),
    }));
    return HttpResponse.json({ items });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/members', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : 'new@example.com';
    const role = typeof body.role === 'string' ? body.role : 'member';
    const invited = {
      id: `u_${Date.now()}`,
      email,
      name: email.split('@')[0] ?? 'New User',
      role,
      status: 'active',
      created_at: new Date().toISOString(),
    };
    members.push(invited);
    return HttpResponse.json(invited, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/members/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const member = members.find((m) => m.id === params.id);
    if (!member) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json({ ...member, ...body });
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/members/:id', ({ params }) => {
    const idx = members.findIndex((m) => m.id === params.id);
    if (idx >= 0) members.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/join-requests', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const items = joinRequests.filter((item) => item.project_id === projectId);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/approve', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const request = joinRequests.find((item) => item.id === params.id);
    if (!request) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    request.status = 'approved';
    request.reviewed_at = new Date().toISOString();
    request.reviewed_by = 'user_001';
    if (!members.some((member) => member.id === request.user_id)) {
      members.push({
        id: request.user_id,
        email: request.user_email,
        name: request.user_name,
        role: 'user',
        status: 'active',
        created_at: new Date().toISOString(),
      });
    }
    ensureWorkspaceMember({
      user_id: request.user_id,
      email: request.user_email,
      name: request.user_name,
      role: 'user',
    });
    if (!memberProjectMembershipFixtures.some((item) => item.project_id === projectId && item.user_id === request.user_id)) {
      memberProjectMembershipFixtures.push({
        project_id: projectId,
        user_id: request.user_id,
        role: 'user',
        permissions: [...GROUP_TEMPLATES.user],
        status: 'active',
        joined_at: request.reviewed_at,
      });
    }
    const builtInState = getBuiltInProjectGroupState(projectId);
    if (!builtInState.members.includes(request.user_id)) {
      builtInState.members.push(request.user_id);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/reject', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const joinRequest = joinRequests.find((item) => item.id === params.id);
    if (!joinRequest) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    joinRequest.status = 'rejected';
    joinRequest.reviewed_at = new Date().toISOString();
    joinRequest.reviewed_by = 'user_001';
    if (typeof body.reason === 'string' && body.reason.length > 0) {
      joinRequest.reason = body.reason;
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/invites', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      expires_in_hours?: number;
    };
    const ttlHours = typeof body.expires_in_hours === 'number' && body.expires_in_hours > 0 ? body.expires_in_hours : 72;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    return HttpResponse.json(
      {
        invite_id: `invite_${Date.now()}`,
        invite_url: `https://example.com/invite/${Date.now()}`,
        expires_at: expiresAt,
      },
      { status: 201 },
    );
  }),
  http.post('/api/v1/join/accept', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    if (typeof body.token !== 'string' || body.token.trim().length === 0) {
      return HttpResponse.json({ error: 'invalid_token' }, { status: 400 });
    }
    return HttpResponse.json({ ok: true, workspace_id: 'ws_default', project_id: 'proj_001' });
  }),
  http.post('/api/v1/join/decline', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    if (typeof body.token !== 'string' || body.token.trim().length === 0) {
      return HttpResponse.json({ error: 'invalid_token' }, { status: 400 });
    }
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/members/:id/permissions', ({ params }) => {
    const membership = memberProjectMembershipFixtures.find((m) => m.user_id === params.id);

    return HttpResponse.json({
      platform_permissions: membership?.permissions ?? [...GROUP_TEMPLATES.user],
    });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/members/:id/permissions', async ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const memberId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as {
      template?: keyof typeof GROUP_TEMPLATES | null;
      permissions?: string[];
      mode?: 'template' | 'custom';
    };
    const membership = memberProjectMembershipFixtures.find(
      (item) => item.project_id === projectId && item.user_id === memberId
    );
    if (!membership) return HttpResponse.json({ error: 'not_found' }, { status: 404 });

    let nextPermissions = membership.permissions;
    if (body.mode === 'template' && body.template && GROUP_TEMPLATES[body.template]) {
      nextPermissions = [...GROUP_TEMPLATES[body.template]];
    } else if (Array.isArray(body.permissions)) {
      nextPermissions = body.permissions;
    }
    const previousPermissions = membership.permissions;
    membership.permissions = [...nextPermissions];

    appendMemberChangeHistory(projectId, memberId, {
      actor_id: 'user_001',
      actor_email: 'owner@example.com',
      change_type: 'permissions',
      changes: {
        updated: {
          platform_permissions: { from: previousPermissions, to: membership.permissions },
        },
      },
    });

    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/members/:id/change-history', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const memberId = String(params.id ?? '');
    const key = memberProjectKey(projectId, memberId);
    return HttpResponse.json({ items: memberChangeHistoryStore[key] ?? [] });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/memberships/:id', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const membership = memberProjectMembershipFixtures.find(
      (item) => item.project_id === projectId && item.user_id === params.id
    );
    if (!membership) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json({
      ...membership,
      groups: getResolvedProjectGroupIdsForUser(projectId, membership.user_id).map((groupId) => {
        const group =
          buildBuiltInProjectGroups(projectId).find((item) => item.id === groupId)
          ?? projectGroups.find((item) => item.project_id === projectId && item.id === groupId);
        return { id: groupId, name: group?.name ?? groupId };
      }),
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/resources/:type/:id/policy', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const resourceType = String(params.type ?? '') as 'endpoint' | 'source_library' | 'agent';
    const resourceId = String(params.id ?? '');
    const key = `${projectId}:${resourceType}:${resourceId}`;
    if (!resourcePolicyStore[key]) {
      resourcePolicyStore[key] = getDefaultPolicy(resourceType, resourceId);
    }
    return HttpResponse.json(resourcePolicyStore[key]);
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/resources/:type/:id/policy', async ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const resourceType = String(params.type ?? '') as 'endpoint' | 'source_library' | 'agent';
    const resourceId = String(params.id ?? '');
    const key = `${projectId}:${resourceType}:${resourceId}`;
    const body = (await request.json().catch(() => ({}))) as Omit<ResourcePolicy, 'resource_type' | 'resource_id'>;
    resourcePolicyStore[key] = {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: body.access_mode ?? 'allow_all_members',
      allowed_subjects: Array.isArray(body.allowed_subjects) ? body.allowed_subjects : [],
      rate_limits: body.rate_limits,
      spending_limits: body.spending_limits,
    };
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/authorize', async ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const body = (await request.json().catch(() => ({}))) as {
      subject?: { type?: 'user' | 'group'; id?: string };
      resource?: { type?: 'endpoint' | 'source_library' | 'agent'; id?: string };
      action?: string;
    };
    const resourceType = body.resource?.type;
    const resourceId = body.resource?.id;
    if (!resourceType || !resourceId) {
      return HttpResponse.json({ error: 'invalid_resource' }, { status: 400 });
    }

    const key = `${projectId}:${resourceType}:${resourceId}`;
    const policy = resourcePolicyStore[key] ?? getDefaultPolicy(resourceType, resourceId);
    const subjectType = body.subject?.type === 'group' ? 'group' : 'user';
    const subjectId = typeof body.subject?.id === 'string' ? body.subject.id : '';
    const directMatch = policy.allowed_subjects.find(
      (subject) => subject.subject_type === subjectType && subject.subject_id === subjectId
    );
    const explicitProjectGroupIds = projectGroups
      .filter((group) => group.project_id === projectId && group.member_ids.includes(subjectId))
      .map((group) => group.id);
    const defaultGroupIds = subjectType === 'user' ? getDefaultProjectGroupIdsForUser(projectId, subjectId) : [];
    const matchedSubject = directMatch
      ?? (subjectType === 'user'
        ? policy.allowed_subjects.find(
          (subject) =>
            subject.subject_type === 'group'
            && [...defaultGroupIds, ...explicitProjectGroupIds].includes(subject.subject_id),
        )
        : undefined);
    const allowed = policy.access_mode === 'allow_all_members' || Boolean(matchedSubject);

    return HttpResponse.json({
      allowed,
      decision: {
        source: allowed
          ? policy.access_mode === 'allow_all_members'
            ? 'project_default'
            : 'resource_policy'
          : 'resource_policy',
        reason: allowed
          ? policy.access_mode === 'allow_all_members'
            ? 'resource_default_allow_all'
            : 'subject_allow_listed'
          : 'subject_not_allow_listed',
      },
      matched_policy: {
        id: `policy_${resourceType}_${resourceId}`,
        resource_type: resourceType,
        resource_id: resourceId,
        access_mode: policy.access_mode,
        matched_subject: matchedSubject
          ? {
              type: matchedSubject.subject_type,
              id: matchedSubject.subject_id,
            }
          : undefined,
      },
      action: body.action ?? 'read',
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/permission-templates', () => {
    const defaults: PermissionTemplate[] = [
      {
        id: 'owner',
        name: 'Owner',
        description: 'Full access to all project resources',
        permissions: [...GROUP_TEMPLATES.owner],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'admin',
        name: 'Admin',
        description: 'Project admin permissions',
        permissions: [...GROUP_TEMPLATES.admin],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'developer',
        name: 'Developer',
        description: 'Development permissions',
        permissions: [...GROUP_TEMPLATES.developer],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'user',
        name: 'User',
        description: 'Basic permissions',
        permissions: [...GROUP_TEMPLATES.user],
        is_default: true,
        is_readonly: true,
      },
    ];
    return HttpResponse.json({ items: [...defaults, ...customPermissionTemplates] });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/permission-templates', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    if (!body.name || !Array.isArray(body.permissions)) {
      return HttpResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const template: PermissionTemplate = {
      id: `tpl_${Date.now()}`,
      name: body.name,
      description: body.description,
      permissions: body.permissions,
      is_default: false,
      is_readonly: false,
    };
    customPermissionTemplates.push(template);
    return HttpResponse.json(template, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/permission-templates/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    const template = customPermissionTemplates.find((item) => item.id === params.id);
    if (!template) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    if (typeof body.name === 'string') template.name = body.name;
    if (typeof body.description === 'string') template.description = body.description;
    if (Array.isArray(body.permissions)) template.permissions = body.permissions;
    return HttpResponse.json(template);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/permission-templates/:id', ({ params }) => {
    const index = customPermissionTemplates.findIndex((item) => item.id === params.id);
    if (index === -1) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    customPermissionTemplates.splice(index, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/groups', ({ params }) => {
    const projectId = String(params.prj ?? '');
    return HttpResponse.json({
      items: [...buildBuiltInProjectGroups(projectId), ...projectGroups.filter((item) => item.project_id === projectId)],
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/groups', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
    if (!body.name || !body.permission_template_id) {
      return HttpResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const group: ProjectGroup = {
      id: `grp_${Date.now()}`,
      project_id: String(params.prj ?? ''),
      name: body.name,
      description: body.description,
      permission_template_id: body.permission_template_id,
      member_ids: Array.isArray(body.member_ids) ? body.member_ids : [],
      created_at: now,
      updated_at: now,
    };
    projectGroups.push(group);
    return HttpResponse.json(group, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/groups/:id', async ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
    if (params.id === PROJECT_BUILT_IN_GROUP_IDS.admins) {
      const state = getBuiltInProjectGroupState(projectId);
      state.admins = Array.isArray(body.member_ids)
        ? [...new Set(body.member_ids.filter((value): value is string => typeof value === 'string'))]
        : state.admins;
      state.members = Array.from(
        new Set([
          ...state.members,
          ...state.owner,
          ...state.admins,
          ...memberProjectMembershipFixtures
            .filter((item) => item.project_id === projectId && item.status === 'active')
            .map((item) => item.user_id),
        ]),
      );
      syncMembershipPermissionsFromBuiltInGroups(projectId);
      const updatedGroup = buildBuiltInProjectGroups(projectId).find((group) => group.id === params.id);
      return HttpResponse.json(updatedGroup);
    }
    const group = projectGroups.find((item) => item.id === params.id);
    if (!group) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    if (typeof body.name === 'string') group.name = body.name;
    if (typeof body.description === 'string') group.description = body.description;
    if (typeof body.permission_template_id === 'string') group.permission_template_id = body.permission_template_id;
    if (Array.isArray(body.member_ids)) group.member_ids = body.member_ids;
    group.updated_at = new Date().toISOString();
    return HttpResponse.json(group);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/groups/:id', ({ params }) => {
    if (
      params.id === PROJECT_BUILT_IN_GROUP_IDS.owner
      || params.id === PROJECT_BUILT_IN_GROUP_IDS.admins
      || params.id === PROJECT_BUILT_IN_GROUP_IDS.members
    ) {
      return HttpResponse.json({ error: 'built_in_group_cannot_be_deleted' }, { status: 400 });
    }
    const index = projectGroups.findIndex((item) => item.id === params.id);
    if (index === -1) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    projectGroups.splice(index, 1);
    return HttpResponse.json(null, { status: 204 });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/groups/:id/apply-template', async ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const group = projectGroups.find((item) => item.id === params.id && item.project_id === projectId);
    if (!group) return HttpResponse.json({ error: 'not_found' }, { status: 404 });

    const custom = customPermissionTemplates.find((item) => item.id === group.permission_template_id);
    const roleKey = group.permission_template_id as keyof typeof GROUP_TEMPLATES;
    const templatePermissions = custom?.permissions ?? (GROUP_TEMPLATES[roleKey] ? [...GROUP_TEMPLATES[roleKey]] : []);

    const body = (await request.json().catch(() => ({}))) as { member_ids?: string[] };
    const targetMemberIds =
      Array.isArray(body.member_ids) && body.member_ids.length > 0 ? body.member_ids : group.member_ids;

    let appliedCount = 0;
    const results: Array<{ member_id: string; status: 'applied' | 'failed'; message?: string }> = [];
    for (const memberId of targetMemberIds) {
      const membership = memberProjectMembershipFixtures.find(
        (item) => item.project_id === projectId && item.user_id === memberId
      );
      if (!membership) {
        results.push({ member_id: memberId, status: 'failed', message: 'membership_not_found' });
        continue;
      }
      membership.permissions = [...templatePermissions];
      appliedCount += 1;
      results.push({ member_id: memberId, status: 'applied' });
    }

    return HttpResponse.json({ applied_count: appliedCount, results });
  }),
];
