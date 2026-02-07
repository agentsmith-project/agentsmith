import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { memberFixtures, memberProjectMembershipFixtures } from '../fixtures/members';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';

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
};

type ResourcePolicy = {
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: Array<{
    subject_type: 'group' | 'user';
    subject_id: string;
    rate_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
    quota_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
  }>;
  rate_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
  quota_limits?: { rules: Array<{ key: string; value: number; window?: 'day' | null }> };
};

const customPermissionTemplates: PermissionTemplate[] = [];
const projectGroups: ProjectGroup[] = [];
const resourcePolicyStore: Record<string, ResourcePolicy> = {};

function getDefaultPolicy(resourceType: 'endpoint' | 'source_library' | 'agent', resourceId: string): ResourcePolicy {
  if (resourceType === 'agent') {
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'agent.max_concurrency', value: 2 }],
      },
    };
  }

  if (resourceType === 'source_library') {
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      quota_limits: {
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
    quota_limits: {
      rules: [{ key: 'endpoint.daily_token_limit', value: 200000, window: 'day' }],
    },
  };
}

export const memberHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/members', () =>
    HttpResponse.json({ items: members }),
  ),
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
  http.get('/api/v1/workspaces/:ws/projects/:prj/members/:id/permissions', ({ params }) => {
    const member = members.find((m) => m.id === params.id);
    const memberRole = member?.role;
    const rolePermissions =
      memberRole === 'owner' || memberRole === 'admin' || memberRole === 'developer' || memberRole === 'user'
        ? [...ROLE_TEMPLATES[memberRole]]
        : null;
    const membership = memberProjectMembershipFixtures.find((m) => m.user_id === params.id);

    return HttpResponse.json({
      platform_permissions: rolePermissions ?? membership?.permissions ?? ['project:read'],
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
      quota_limits: body.quota_limits,
    };
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/permission-templates', () => {
    const defaults: PermissionTemplate[] = [
      {
        id: 'owner',
        name: 'Owner',
        description: 'Full access to all project resources',
        permissions: [...ROLE_TEMPLATES.owner],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'admin',
        name: 'Admin',
        description: 'Project admin permissions',
        permissions: [...ROLE_TEMPLATES.admin],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'developer',
        name: 'Developer',
        description: 'Development permissions',
        permissions: [...ROLE_TEMPLATES.developer],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'user',
        name: 'User',
        description: 'Basic permissions',
        permissions: [...ROLE_TEMPLATES.user],
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
    return HttpResponse.json({ items: projectGroups.filter((item) => item.project_id === projectId) });
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
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
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
    const roleKey = group.permission_template_id as keyof typeof ROLE_TEMPLATES;
    const templatePermissions = custom?.permissions ?? (ROLE_TEMPLATES[roleKey] ? [...ROLE_TEMPLATES[roleKey]] : []);

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
