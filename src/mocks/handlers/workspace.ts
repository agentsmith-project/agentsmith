import { bypass, http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { workspaceFixtures } from '../fixtures/workspaces';
import { PLATFORM_PERMISSIONS } from '@/lib/constants/permissions';
import { CURRENT_USER_ID } from '../fixtures/projects';

const workspaceItems = (() => {
  const fromP0 = p0.workspaces ?? [];
  if (!fromP0.length) {
    return workspaceFixtures;
  }
  const hasDefault = fromP0.some((workspace) => workspace.id === 'ws_default');
  return hasDefault ? fromP0 : [...workspaceFixtures, ...fromP0];
})();

const workspaceMembers = (() => {
  const getWorkspacePermissionsForRole = (role: 'owner' | 'admin' | 'developer' | 'user') => {
    if (role === 'owner' || role === 'admin') {
      return [...PLATFORM_PERMISSIONS.WORKSPACE];
    }
    if (role === 'developer') {
      return ['workspace:read'];
    }
    return ['workspace:read'];
  };

  const fromP0 = (p0.workspace_members ?? []).map((member) => {
    const memberRecord = member as Record<string, unknown>;
    const userId = String(member.id ?? '');
    const role = member.role === 'owner' || member.role === 'admin' || member.role === 'developer'
      ? member.role
      : 'user';
    const governanceGroup = memberRecord['governance_group'];
    const explicitPermissions = memberRecord['permissions'];
    return {
      id: `wm_${userId}`,
      user_id: userId,
      name: member.name ?? member.email ?? userId,
      email: member.email ?? `${userId}@example.com`,
      role,
      governance_group:
        governanceGroup === 'wheel' || governanceGroup === 'user'
          ? governanceGroup
          : role === 'owner' || role === 'admin'
            ? 'wheel'
            : 'user',
      permissions: Array.isArray(explicitPermissions) ? explicitPermissions : getWorkspacePermissionsForRole(role),
      status: 'active' as const,
      joined_at: '2026-01-01T00:00:00Z',
    };
  });

  if (!fromP0.some((member) => member.user_id === CURRENT_USER_ID)) {
    fromP0.push({
      id: `wm_${CURRENT_USER_ID}`,
      user_id: CURRENT_USER_ID,
      name: p0.auth.user.name,
      email: p0.auth.user.email,
      role: 'owner',
      governance_group: 'wheel',
      permissions: [...PLATFORM_PERMISSIONS.WORKSPACE],
      status: 'active' as const,
      joined_at: '2026-01-01T00:00:00Z',
    });
  }

  return fromP0;
})();

const workspaceProjectCreators = workspaceMembers
  .filter((member) => member.user_id === 'u_2')
  .map((member) => ({
    id: member.user_id,
    user_id: member.user_id,
    name: member.name,
    email: member.email,
  }));

function withDerivedWorkspacePermissions() {
  return workspaceMembers.map((member) => {
    const shouldCreateProjects = workspaceProjectCreators.some(
      (creator) => creator.user_id === member.user_id || creator.email === member.email,
    );
    const nextPermissions = new Set(member.permissions);
    if (shouldCreateProjects) {
      nextPermissions.add('workspace:project:create');
    } else if (!member.permissions.includes('workspace:governance:update')) {
      nextPermissions.delete('workspace:project:create');
    }
    return {
      ...member,
      permissions: [...nextPermissions],
    };
  });
}

type SystemWorkspaceRecord = {
  id: string;
  name: string;
  provisioning_status?: string | null;
  idp?: {
    kind?: 'keycloak';
    url?: string;
    realm?: string;
    client_id?: string;
  } | null;
  created_at?: string;
  updated_at?: string;
};

async function readSystemWorkspaces(request: Request): Promise<SystemWorkspaceRecord[]> {
  try {
    const url = new URL('/api/system/workspaces', request.url);
    const response = await fetch(
      bypass(
        new Request(url, {
          method: 'GET',
          headers: request.headers,
        }),
      ),
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { items?: SystemWorkspaceRecord[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

function mapSystemWorkspaceToPublicConfig(workspace: SystemWorkspaceRecord) {
  if (
    workspace.provisioning_status !== 'ready' ||
    workspace.idp?.kind !== 'keycloak' ||
    !workspace.idp.url ||
    !workspace.idp.realm ||
    !workspace.idp.client_id
  ) {
    return null;
  }

  return {
    id: workspace.id,
    name: workspace.name,
    idp: {
      kind: 'keycloak' as const,
      url: workspace.idp.url,
      realm: workspace.idp.realm,
      client_id: workspace.idp.client_id,
    },
  };
}

async function readAvailableWorkspaces(request: Request) {
  const systemWorkspaces = await readSystemWorkspaces(request);
  const readySystemWorkspaces = systemWorkspaces
    .filter((workspace) => workspace.provisioning_status === 'ready')
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      created_at: workspace.created_at ?? new Date().toISOString(),
      updated_at: workspace.updated_at ?? new Date().toISOString(),
    }));

  const seen = new Set<string>();
  const merged = [...workspaceItems, ...readySystemWorkspaces].filter((workspace) => {
    if (seen.has(workspace.id)) return false;
    seen.add(workspace.id);
    return true;
  });

  return { merged, systemWorkspaces };
}

export const workspaceHandlers = [
  http.get('/api/v1/workspaces', async ({ request }) => {
    const { merged } = await readAvailableWorkspaces(request);
    return HttpResponse.json({ items: merged });
  }),
  http.get('/api/public/workspaces/:id', async ({ params, request }) => {
    const workspaceId = String(params.id ?? '');
    const workspace = workspaceItems.find((item) => item.id === workspaceId);
    if (workspace) {
      return HttpResponse.json({
        id: workspace.id,
        name: workspace.name,
        idp: {
          kind: 'keycloak',
          url: process.env.NEXT_PUBLIC_KEYCLOAK_URL?.trim() || 'http://localhost:8080',
          realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM?.trim() || 'mbos',
          client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID?.trim() || 'agentsmith-web',
        },
      });
    }

    const systemWorkspace = (await readSystemWorkspaces(request)).find((item) => item.id === workspaceId);
    const publicConfig = systemWorkspace ? mapSystemWorkspaceToPublicConfig(systemWorkspace) : null;
    if (publicConfig) return HttpResponse.json(publicConfig);

    return HttpResponse.json({ error_code: 'WORKSPACE_NOT_FOUND', error_message: 'workspace_not_found' }, { status: 404 });
  }),
  http.get('/api/v1/workspaces/:ws', async ({ params, request }) => {
    const workspaceId = String(params.ws ?? '');
    const { merged } = await readAvailableWorkspaces(request);
    const workspace = merged.find((item) => item.id === workspaceId);
    if (!workspace) {
      return HttpResponse.json({ error: 'workspace_not_found' }, { status: 404 });
    }
    return HttpResponse.json(workspace);
  }),
  http.get('/api/v1/workspaces/:ws/members', () => {
    const members = withDerivedWorkspacePermissions();
    return HttpResponse.json({ items: members, total: members.length });
  }),
  http.get('/api/v1/workspaces/:ws/project-creators', () =>
    HttpResponse.json({ items: workspaceProjectCreators, total: workspaceProjectCreators.length })),
  http.patch('/api/v1/workspaces/:ws/project-creators', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { project_creators?: string[] };
    const nextCreators = Array.isArray(body.project_creators)
      ? body.project_creators
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];
    workspaceProjectCreators.splice(
      0,
      workspaceProjectCreators.length,
      ...nextCreators.map((identifier) => ({
        id: identifier,
        user_id: identifier,
        name: identifier,
        email: identifier.includes('@') ? identifier : `${identifier}@workspace.local`,
      })),
    );
    return HttpResponse.json({ items: workspaceProjectCreators, total: workspaceProjectCreators.length });
  }),
  http.patch('/api/v1/workspaces/:ws/members/:memberId/governance', async ({ params, request }) => {
    const memberId = String(params.memberId ?? '');
    const body = (await request.json().catch(() => ({}))) as { governance_group?: 'wheel' | 'user' };
    const target = workspaceMembers.find((member) => member.id === memberId || member.user_id === memberId);
    if (!target) {
      return HttpResponse.json({ error: 'workspace_member_not_found' }, { status: 404 });
    }
    if (body.governance_group !== 'wheel' && body.governance_group !== 'user') {
      return HttpResponse.json({ error: 'invalid_governance_group' }, { status: 400 });
    }
    target.governance_group = body.governance_group;
    return HttpResponse.json(target);
  }),
];
