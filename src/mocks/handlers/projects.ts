import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { projectFixtures, projectMembershipFixtures, CURRENT_USER_ID } from '../fixtures/projects';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docProjectFixtures, docProjectMembershipFixtures } from '../doc-fixtures/workspace-projects';
import type { Project } from '@/lib/api/types';
import { PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS } from '@/lib/constants/permissions';
import { PROJECT_BUILT_IN_GROUP_IDS, PROJECT_BUILT_IN_TEMPLATE_IDS } from '@/lib/governance/member-groups';

export const projects = DOC_FIXTURES_ENABLED
  ? [...docProjectFixtures]
  : [...(p0.projects.length ? p0.projects : projectFixtures)];

const membershipsSource = DOC_FIXTURES_ENABLED ? docProjectMembershipFixtures : projectMembershipFixtures;

function getRequestUserId(request: Request): string {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader) return CURRENT_USER_ID;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token.startsWith('mock_token_')) return CURRENT_USER_ID;
  const rest = token.slice('mock_token_'.length);
  const separator = rest.lastIndexOf('_');
  if (separator <= 0) return CURRENT_USER_ID;
  return rest.slice(0, separator);
}

export const projectHandlers = [
  http.get('/api/v1/workspaces/:ws/projects', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const workspaceId = params.ws as string;
    const items = projects
      .filter((project) => project.workspace_id === workspaceId)
      .map((project) => {
      const membership =
        membershipsSource.find(
          (m) => m.project_id === project.id && m.user_id === userId,
        ) ??
        membershipsSource.find(
          (m) => m.project_id === project.id && m.user_id === project.owner_id,
        );
        return {
          ...project,
          permissions: membership?.permissions ?? [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner],
          groups: membership?.groups ?? [{
            id: PROJECT_BUILT_IN_GROUP_IDS.owner,
            name: 'Project owner',
            permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
            built_in: true,
            system_key: 'owner',
          }],
          admin_member_ids: membershipsSource
            .filter((m) => m.project_id === project.id)
            .filter((m) => m.groups?.some((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins))
            .map((m) => m.user_id),
        };
      });
    return HttpResponse.json({ items });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const workspaceId = params.ws as string;
    const projectId = params.prj as string;
    const project = projects.find((p) => p.workspace_id === workspaceId && p.id === projectId);
    const membership =
      membershipsSource.find(
        (m) => m.project_id === projectId && m.user_id === userId,
      ) ??
      membershipsSource.find(
        (m) => m.project_id === projectId && m.user_id === project?.owner_id,
      );
    if (!project) {
      return HttpResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    return HttpResponse.json({
      ...project,
      permissions: membership?.permissions ?? [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner],
      groups: membership?.groups ?? [{
        id: PROJECT_BUILT_IN_GROUP_IDS.owner,
        name: 'Project owner',
        permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
        built_in: true,
        system_key: 'owner',
      }],
      admin_member_ids: membershipsSource
        .filter((m) => m.project_id === projectId)
        .filter((m) => m.groups?.some((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins))
        .map((m) => m.user_id),
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects', async ({ params, request }) => {
    const userId = getRequestUserId(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const visibility: 'public' | 'private' =
      body.visibility === 'public' ? 'public' : 'private';
    const joinPolicy: 'open' | 'approval_required' =
      body.join_policy === 'open' ? 'open' : 'approval_required';
    const created: Project = {
      id: `proj_${Date.now()}`,
      workspace_id: params.ws as string,
      name: (body.name as string) ?? 'New Project',
      description: (body.description as string) ?? '',
      visibility,
      join_policy: joinPolicy,
      owner_id: userId,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    projects.push(created);
    membershipsSource.push({
      project_id: created.id,
      user_id: userId,
      groups: [{
        id: PROJECT_BUILT_IN_GROUP_IDS.owner,
        name: 'Project owner',
        permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
        built_in: true,
        system_key: 'owner',
      }],
      permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner],
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idx = projects.findIndex((p) => p.workspace_id === params.ws && p.id === params.prj);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    const previous = projects[idx];
    const nextOwnerId =
      typeof body.owner_id === 'string' && body.owner_id.trim().length > 0
        ? body.owner_id.trim()
        : previous.owner_id;
    const governanceJson =
      body.governance_json && typeof body.governance_json === 'object' && !Array.isArray(body.governance_json)
        ? body.governance_json as Record<string, unknown>
        : previous.governance_json ?? {};
    if (nextOwnerId !== previous.owner_id) {
      const previousOwnerMembership = membershipsSource.find(
        (membership) => membership.project_id === previous.id && membership.user_id === previous.owner_id,
      );
      if (previousOwnerMembership) {
        previousOwnerMembership.groups = [{
          id: PROJECT_BUILT_IN_GROUP_IDS.admins,
          name: 'Project admins',
          permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
          built_in: true,
          system_key: 'admins',
        }];
        previousOwnerMembership.permissions = [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.admin];
      }
      const nextOwnerMembership = membershipsSource.find(
        (membership) => membership.project_id === previous.id && membership.user_id === nextOwnerId,
      );
      if (nextOwnerMembership) {
        nextOwnerMembership.groups = [{
          id: PROJECT_BUILT_IN_GROUP_IDS.owner,
          name: 'Project owner',
          permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
          built_in: true,
          system_key: 'owner',
        }];
        nextOwnerMembership.permissions = [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner];
      } else {
        membershipsSource.push({
          project_id: previous.id,
          user_id: nextOwnerId,
          groups: [{
            id: PROJECT_BUILT_IN_GROUP_IDS.owner,
            name: 'Project owner',
            permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
            built_in: true,
            system_key: 'owner',
          }],
          permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner],
          status: 'active',
          joined_at: new Date().toISOString(),
        });
      }
    }
    projects[idx] = {
      ...previous,
      ...body,
      governance_json: governanceJson,
      owner_id: nextOwnerId,
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(projects[idx]);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj', ({ params }) => {
    const idx = projects.findIndex((p) => p.workspace_id === params.ws && p.id === params.prj);
    if (idx >= 0) projects.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
];
