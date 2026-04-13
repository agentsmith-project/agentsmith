import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { projectFixtures } from '../fixtures/projects';
import { memberProjectMembershipFixtures } from '../fixtures/members';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docProjectFixtures, docProjectMembershipFixtures } from '../doc-fixtures/workspace-projects';
import type { Project } from '@/lib/api/types';
import { PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS } from '@/lib/constants/permissions';
import { PROJECT_BUILT_IN_GROUP_IDS, PROJECT_BUILT_IN_TEMPLATE_IDS } from '@/lib/governance/member-groups';
import { readWorkspacePermissionsForUser } from './workspace';
import { readMockAuthActorFromRequest } from '../utils/mock-auth-token';

export const projects = DOC_FIXTURES_ENABLED
  ? [...docProjectFixtures]
  : [...(p0.projects.length ? p0.projects : projectFixtures)];

const membershipsSource = DOC_FIXTURES_ENABLED ? docProjectMembershipFixtures : memberProjectMembershipFixtures;

function getRequestUserId(request: Request): string {
  return readMockAuthActorFromRequest(request).userId;
}

function getProjectMembershipForUser(projectId: string, userId: string) {
  return membershipsSource.find((m) => m.project_id === projectId && m.user_id === userId);
}

function getMembershipStatus(project: Project, userId: string): 'active' | 'pending' | 'suspended' | 'none' {
  if (project.owner_id === userId) return 'active';
  const membership = getProjectMembershipForUser(project.id, userId);
  if (!membership || membership.status === 'removed') return 'none';
  if (membership.status === 'pending' || membership.status === 'suspended') return membership.status;
  return 'active';
}

function isProjectVisibleToUser(project: Project, userId: string): boolean {
  if (project.visibility === 'public') return true;
  if (project.owner_id === userId) return true;
  return getMembershipStatus(project, userId) === 'active';
}

function isProjectGovernanceVisibleToUser(project: Project, userId: string): boolean {
  if (isProjectVisibleToUser(project, userId)) return true;
  return readWorkspacePermissionsForUser(userId).includes('workspace:governance:update');
}

function buildProjectResponse(project: Project, userId: string) {
  const membership = getProjectMembershipForUser(project.id, userId);
  const isOwner = project.owner_id === userId;
  const membershipStatus = getMembershipStatus(project, userId);
  const isActiveMember = membershipStatus === 'active';
  return {
    ...project,
    permissions: isOwner
      ? [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner]
      : (isActiveMember ? (membership?.permissions ?? []) : []),
    groups: isOwner
      ? [{
          id: PROJECT_BUILT_IN_GROUP_IDS.owner,
          name: 'Project owner',
          permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
          built_in: true,
          system_key: 'owner',
        }]
      : (isActiveMember ? (membership?.groups ?? []) : []),
    membership_status: membershipStatus,
    admin_member_ids: membershipsSource
      .filter((m) => m.project_id === project.id && m.status === 'active')
      .filter((m) => m.groups?.some((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins))
      .map((m) => m.user_id),
  };
}

export const projectHandlers = [
  http.get('/api/v1/workspaces/:ws/projects', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const workspaceId = params.ws as string;
    const items = projects
      .filter((project) => project.workspace_id === workspaceId)
      .filter((project) => isProjectVisibleToUser(project, userId))
      .map((project) => buildProjectResponse(project, userId));
    return HttpResponse.json({ items });
  }),
  http.get('/api/v1/workspaces/:ws/governable-projects', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const workspaceId = params.ws as string;
    const workspacePermissions = readWorkspacePermissionsForUser(userId);
    if (!workspacePermissions.includes('workspace:governance:update')) {
      return HttpResponse.json(
        { error_code: 'PERMISSION_DENIED', message: 'workspace_governance_update_required' },
        { status: 403 },
      );
    }
    const items = projects
      .filter((project) => project.workspace_id === workspaceId)
      .filter((project) => isProjectGovernanceVisibleToUser(project, userId))
      .map((project) => buildProjectResponse(project, userId));
    return HttpResponse.json({ items });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const workspaceId = params.ws as string;
    const projectId = params.prj as string;
    const project = projects.find((p) => p.workspace_id === workspaceId && p.id === projectId);
    if (!project) {
      return HttpResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    if (!isProjectVisibleToUser(project, userId)) {
      return HttpResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    return HttpResponse.json(buildProjectResponse(project, userId));
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
