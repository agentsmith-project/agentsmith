import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  ensureExternalTestKeycloak,
  EXTERNAL_KEYCLOAK_BASE_URL,
  KEYCLOAK_DEV_ADMIN_EMAIL,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_DIRECTORY_CLIENT_ID,
  KEYCLOAK_DIRECTORY_CLIENT_SECRET,
  KEYCLOAK_INTEGRATION_GUEST_EMAIL,
  KEYCLOAK_INTEGRATION_GUEST_PASSWORD,
  KEYCLOAK_INTEGRATION_GUEST_USERNAME,
  KEYCLOAK_INTEGRATION_INVITEE_EMAIL,
  KEYCLOAK_INTEGRATION_INVITEE_PASSWORD,
  KEYCLOAK_INTEGRATION_INVITEE_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_EMAIL,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  KEYCLOAK_INTEGRATION_USER_EMAIL,
  keycloakLoginToWorkspace,
  LOCALE,
  selectWorkspaceAdminFromDirectory,
  teardownExternalTestKeycloak,
  ensureWorkspaceProjectCreatorViaUi,
  SYSTEM_ADMIN_PASSWORD,
  SYSTEM_ADMIN_USERNAME,
} from './integration-real-helpers';
import { ensureWorkspaceProjectCreatorAccess, readStoredAuthToken } from './integration-workspace-access';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter, type UxTraceBundleWriter } from './trace-bundle-support';

const GOVERNANCE_ONBOARDING_STORY = loadStoryDefinitionSync('project-governance-onboarding');
const GOVERNANCE_ONBOARDING_BINDING = buildTraceStoryBinding(GOVERNANCE_ONBOARDING_STORY);
const MEMBERSHIP_CHANGE_STORY = loadStoryDefinitionSync('membership-change-and-effective-access');
const MEMBERSHIP_CHANGE_BINDING = buildTraceStoryBinding(MEMBERSHIP_CHANGE_STORY);
const WORKSPACE_ADMIN_BOUNDARY_STORY = loadStoryDefinitionSync('workspace-admin-boundary-and-project-creator');
const WORKSPACE_ADMIN_BOUNDARY_BINDING = buildTraceStoryBinding(WORKSPACE_ADMIN_BOUNDARY_STORY);
const MATRIX_SETUP = GOVERNANCE_ONBOARDING_STORY.runtimeData?.matrixSetup as
  | {
      workspaceNamePrefix?: string;
      projectNamePrefix?: string;
      defaultIdpLabel?: string;
      externalIdpLabel?: string;
    }
  | undefined;
const MEMBERSHIP_RUNTIME = MEMBERSHIP_CHANGE_STORY.runtimeData?.membershipChange as
  | {
      projectNamePrefix?: string;
      memberDisplayName?: string;
      memberEmail?: string;
      joinedMemberPermissions?: string[];
      promotedMemberPermissions?: string[];
    }
  | undefined;

type WorkspaceAdminBoundaryRuntime = {
  creatorEmail: string;
  projectNamePrefix: string;
};

function requireWorkspaceAdminBoundaryRuntime(): WorkspaceAdminBoundaryRuntime {
  const runtimeRoot = WORKSPACE_ADMIN_BOUNDARY_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.workspaceAdminProjectCreatorBoundary as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_workspace_admin_boundary_runtime');
  }
  for (const field of ['creatorEmail', 'projectNamePrefix'] as const) {
    if (typeof runtime[field] !== 'string' || runtime[field].trim().length === 0) {
      throw new Error(`missing_workspace_admin_boundary_runtime:${field}`);
    }
  }
  return runtime as unknown as WorkspaceAdminBoundaryRuntime;
}

async function createProjectViaProjectsUi(args: {
  page: Page;
  workspaceId: string;
  projectName: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects`);
  await expect(args.page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('projects__create-btn').click();
  const dialog = args.page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('#project-name').fill(args.projectName);
  await Promise.all([
    args.page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${args.workspaceId}/projects/.+/overview(?:$|\\?)`), { timeout: 30_000 }),
    dialog.getByRole('button', { name: /Create|创建/i }).click(),
  ]);
}

type UserIdentity = {
  token: string;
  userId: string;
  email: string;
  name: string;
};

type MatrixProjects = {
  publicOpen: { projectId: string; projectName: string };
  publicApproval: { projectId: string; projectName: string };
  privateOpen: { projectId: string; projectName: string };
  privateApproval: { projectId: string; projectName: string };
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readUserIdFromJwt(token: string): string {
  const jwt = decodeJwtPayload(token);
  const userId = typeof jwt.sub === 'string' ? jwt.sub.trim() : '';
  if (!userId) {
    throw new Error('member_identity_user_id_missing');
  }
  return userId;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loginAndReadIdentity(args: {
  page: Page;
  workspaceId: string;
  username: string;
  password: string;
}): Promise<UserIdentity> {
  await keycloakLoginToWorkspace(args.page, args.workspaceId, args.username, args.password, {
    ensureProjectCreatorAccess: false,
  });
  const token = await readStoredAuthToken(args.page);
  const res = await args.page.request.get(`${API_BASE}/api/v1/me/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const profile = (await res.json()) as { id?: string; user_id?: string; email?: string; name?: string };
  const jwt = decodeJwtPayload(token);
  const userId =
    profile.id ??
    profile.user_id ??
    (typeof jwt.sub === 'string' ? jwt.sub : undefined);
  const email =
    profile.email ??
    (typeof jwt.email === 'string' ? jwt.email : undefined) ??
    '';
  const name =
    profile.name ??
    (typeof jwt.name === 'string' ? jwt.name : undefined) ??
    '';
  if (!userId) {
    throw new Error(`identity_user_id_missing:${args.username}`);
  }
  return { token, userId, email, name };
}

async function apiRequest(args: {
  page: Page;
  token: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  return args.page.request.fetch(`${API_BASE}${args.path}`, {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.token}`,
      ...(args.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(args.headers ?? {}),
    },
    data: args.body,
  });
}

async function createProjectMatrix(args: {
  page: Page;
  workspaceId: string;
  prefix: string;
}): Promise<MatrixProjects> {
  return {
    publicOpen: await createProjectInWorkspace(args.page, args.workspaceId, `${args.prefix} Public Open`, {
      visibility: 'public',
      joinPolicy: 'open',
    }),
    publicApproval: await createProjectInWorkspace(args.page, args.workspaceId, `${args.prefix} Public Approval`, {
      visibility: 'public',
      joinPolicy: 'approval_required',
    }),
    privateOpen: await createProjectInWorkspace(args.page, args.workspaceId, `${args.prefix} Private Open`, {
      visibility: 'private',
      joinPolicy: 'open',
    }),
    privateApproval: await createProjectInWorkspace(args.page, args.workspaceId, `${args.prefix} Private Approval`, {
      visibility: 'private',
      joinPolicy: 'approval_required',
    }),
  };
}

async function assertProjectListVisibility(args: {
  page: Page;
  workspaceId: string;
  visibleNames: string[];
  hiddenNames: string[];
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects`);
  await expect(args.page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
  for (const name of args.visibleNames) {
    await expect(args.page.getByText(name)).toBeVisible();
  }
  for (const name of args.hiddenNames) {
    await expect(args.page.getByText(name)).toHaveCount(0);
  }
}

async function assertProjectOverviewAccessible(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/overview`);
  await expect(args.page.getByTestId('page-state__success')).toBeVisible({ timeout: 30_000 });
}

async function createInviteViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  invitedEmail: string;
}): Promise<string> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members`);
  await expect(args.page.getByTestId('members__invite-btn')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('members__invite-btn').click();
  const dialog = args.page.getByTestId('members__invite-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.locator('#invite-email').fill(args.invitedEmail);
  await dialog.getByRole('button', { name: /create invite|invite/i }).click();
  const inviteInput = dialog.locator('input[readonly]').first();
  await expect(inviteInput).toBeVisible({ timeout: 30_000 });
  const inviteUrl = (await inviteInput.inputValue()).trim();
  const token = new URL(inviteUrl).searchParams.get('token');
  if (!token) {
    throw new Error('invite_token_missing_from_ui_invite');
  }
  await dialog.getByRole('button', { name: /done/i }).click();
  return token;
}

async function createInviteViaApi(args: {
  page: Page;
  token: string;
  workspaceId: string;
  projectId: string;
  invitedEmail: string;
}): Promise<string> {
  const res = await apiRequest({
    page: args.page,
    token: args.token,
    method: 'POST',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/invites`,
    body: {
      email: args.invitedEmail,
      expires_in_hours: 24,
    },
  });
  expect(res.ok()).toBeTruthy();
  const payload = (await res.json()) as { invite_url: string };
  const token = new URL(payload.invite_url, 'http://localhost').searchParams.get('token');
  if (!token) {
    throw new Error('invite_token_missing');
  }
  return token;
}

async function assertOnlyProjectMemberGroup(args: {
  page: Page;
  token: string;
  workspaceId: string;
  projectId: string;
  invitedUserId: string;
}) {
  const groupsRes = await apiRequest({
    page: args.page,
    token: args.token,
    method: 'GET',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/groups`,
  });
  expect(groupsRes.ok()).toBeTruthy();
  const groupsBody = (await groupsRes.json()) as {
    items: Array<{ id: string; member_ids?: string[] }>;
  };
  const memberIds = groupsBody.items.find((group) => group.id === 'grp_project_members')?.member_ids ?? [];
  const adminIds = groupsBody.items.find((group) => group.id === 'grp_project_admins')?.member_ids ?? [];
  expect(memberIds).toContain(args.invitedUserId);
  expect(adminIds).not.toContain(args.invitedUserId);
}

async function assertMemberVisibleInMembersPage(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  member: Pick<UserIdentity, 'userId' | 'email' | 'name'>;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members`);
  await expect(args.page.getByTestId('members__table')).toBeVisible({ timeout: 30_000 });
  const memberRow = args.page.getByTestId('members__table__row').filter({
    has: args.page.getByText(args.member.email, { exact: true }),
  });
  await expect(memberRow).toHaveCount(1);
  if (args.member.name) {
    await expect(memberRow.getByText(args.member.name, { exact: true })).toBeVisible();
  }
  await expect(memberRow.getByText(args.member.userId, { exact: true })).toHaveCount(0);
  await expect(memberRow.getByText(`${args.member.userId}@example.com`, { exact: true })).toHaveCount(0);
}

async function requireMembershipChangeRuntime() {
  if (!MEMBERSHIP_RUNTIME) {
    throw new Error('missing_membership_change_runtime_data');
  }
  for (const key of ['projectNamePrefix', 'memberDisplayName', 'memberEmail'] as const) {
    if (typeof MEMBERSHIP_RUNTIME[key] !== 'string' || MEMBERSHIP_RUNTIME[key].trim().length === 0) {
      throw new Error(`missing_membership_change_runtime_data:${key}`);
    }
  }
  if (!Array.isArray(MEMBERSHIP_RUNTIME.joinedMemberPermissions)) {
    throw new Error('missing_membership_change_runtime_data:joinedMemberPermissions');
  }
  if (!Array.isArray(MEMBERSHIP_RUNTIME.promotedMemberPermissions)) {
    throw new Error('missing_membership_change_runtime_data:promotedMemberPermissions');
  }
  return MEMBERSHIP_RUNTIME as {
    projectNamePrefix: string;
    memberDisplayName: string;
    memberEmail: string;
    joinedMemberPermissions: string[];
    promotedMemberPermissions: string[];
  };
}

async function openMemberDrawerByEmail(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  memberEmail: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members?member_tab=people`);
  await expect(args.page.getByTestId('members__table')).toBeVisible({ timeout: 30_000 });
  const memberRow = args.page.getByTestId('members__table__row').filter({
    has: args.page.getByText(args.memberEmail, { exact: true }),
  });
  await expect(memberRow).toBeVisible({ timeout: 30_000 });
  await memberRow.click();
  await expect(args.page.getByRole('tabpanel', { name: /effective access/i })).toBeVisible({ timeout: 30_000 });
}

async function setProjectAdminMembership(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  memberUserId: string;
  shouldBeAdmin: boolean;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/settings`);
  await expect(args.page.getByTestId('settings__project-admins-section')).toBeVisible({ timeout: 30_000 });
  const option = args.page.getByTestId(`settings__project-admin-option--${args.memberUserId}`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  const checkbox = option.getByRole('checkbox');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== args.shouldBeAdmin) {
    await option.click();
  }
  const saveResponse = args.page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'PATCH'
      && candidate.url().includes(`/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/groups/`),
    { timeout: 30_000 },
  );
  await args.page.getByTestId('settings__project-admins-save').click();
  const response = await saveResponse;
  expect(response.ok()).toBeTruthy();
}

async function removeProjectMemberByRowMenu(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberEmail: string;
}) {
  const token = await readStoredAuthToken(args.page);
  if (!token) {
    throw new Error('remove_member_token_missing');
  }
  const response = await apiRequest({
    page: args.page,
    token,
    method: 'DELETE',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/memberships/${args.memberId}`,
  });
  expect(response.ok()).toBeTruthy();
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members?member_tab=people`);
  await expect(args.page.getByTestId('members__table')).toBeVisible({ timeout: 30_000 });
  const memberRow = args.page.getByTestId('members__table__row').filter({
    has: args.page.getByText(args.memberEmail, { exact: true }),
  });
  await expect(memberRow).toHaveCount(0, { timeout: 30_000 });
}

async function assertMemberDrawerEffectiveState(args: {
  page: Page;
  expectedAccessGroup: RegExp;
  expectedMembershipStatus: RegExp;
  expectedPermissions: string[];
}) {
  const effectiveAccessPanel = args.page.getByRole('tabpanel', { name: /effective access/i });
  await expect(effectiveAccessPanel.getByTestId('member-detail__effective-access-summary')).toBeVisible({ timeout: 30_000 });
  await expect(effectiveAccessPanel.getByTestId('member-detail__groups')).toHaveText(args.expectedAccessGroup);
  await expect(effectiveAccessPanel.getByTestId('member-detail__membership-status')).toHaveText(args.expectedMembershipStatus);
  if (args.expectedPermissions.length === 0) {
    await expect(effectiveAccessPanel.getByText('No effective permissions', { exact: true })).toBeVisible();
    return;
  }
  for (const permission of args.expectedPermissions) {
    await expect(effectiveAccessPanel.getByText(permission, { exact: true })).toBeVisible();
  }
}

async function loginAsSystemAdminViaVisibleHeading(page: Page) {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/system/login`);
  await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-login__username').fill(SYSTEM_ADMIN_USERNAME);
  await page.getByTestId('system-login__password').fill(SYSTEM_ADMIN_PASSWORD);

  let loginResponseOk = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes('/api/system/session') && response.request().method() === 'POST',
        { timeout: 5_000 },
      )
      .catch(() => null);
    await page.getByTestId('system-login__submit').click();
    const response = await responsePromise;
    if (response) {
      loginResponseOk = response.ok();
      break;
    }
    await page.waitForTimeout(1_000);
  }

  expect(loginResponseOk).toBe(true);
  await expect
    .poll(() => page.url(), { timeout: 30_000 })
    .toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
  await expect(page.getByRole('heading', { name: /system workspaces/i })).toBeVisible({ timeout: 30_000 });
}

async function createAndPublishWorkspaceWithVisibleHeading(args: {
  page: Page;
  workspaceName: string;
}) {
  const createResponse = await args.page.request.post('/api/system/workspaces', {
    headers: {
      'content-type': 'application/json',
    },
    data: {
      name: args.workspaceName,
      workspace_admin_mode: 'email_pending',
      workspace_admin_email: KEYCLOAK_DEV_ADMIN_EMAIL,
      login_idp_url: process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
      login_idp_realm: process.env.KEYCLOAK_REALM ?? 'mbos',
      login_client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith',
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json().catch(() => null)) as { id?: string } | null;
  const workspaceId = created?.id?.trim();
  if (!workspaceId) {
    throw new Error('workspace_id_not_found_after_create');
  }

  const publishResponse = await args.page.request.post(`/api/system/workspaces/${workspaceId}/publish`, {});
  expect(publishResponse.ok()).toBeTruthy();
  await expect
    .poll(
      async () => args.page.request.get('/api/system/workspaces').then(async (response) => {
        const payload = (await response.json()) as {
          items?: Array<{ id: string; provisioning_status: string; last_init_error?: string | null }>;
        };
        const item = payload.items?.find((candidate) => candidate.id === workspaceId);
        return item ? `${item.provisioning_status}:${item.last_init_error ?? ''}` : 'missing';
      }),
      { timeout: 40_000 },
    )
    .toMatch(/^ready:/);

  return workspaceId;
}

async function runProjectMatrix(args: {
  page: Page;
  workspaceId: string;
  creator: UserIdentity;
  member: UserIdentity;
  guest: UserIdentity;
  invitee: UserIdentity;
  prefix: string;
  trace?: UxTraceBundleWriter;
  traceEnabled?: boolean;
}) {
  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  const projects = await createProjectMatrix({
    page: args.page,
    workspaceId: args.workspaceId,
    prefix: args.prefix,
  });

  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_GUEST_USERNAME, KEYCLOAK_INTEGRATION_GUEST_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  await assertProjectListVisibility({
    page: args.page,
    workspaceId: args.workspaceId,
    visibleNames: [projects.publicOpen.projectName, projects.publicApproval.projectName],
    hiddenNames: [projects.privateOpen.projectName, projects.privateApproval.projectName],
  });
  if (args.traceEnabled !== false && args.trace) {
    await args.trace.capture(args.page, {
      stepId: 'public-project-discovery',
      note: '公共项目可见且可创建',
    });
  }

  const publicOpenJoin = await apiRequest({
    page: args.page,
    token: args.guest.token,
    method: 'POST',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${projects.publicOpen.projectId}/join-requests`,
    body: { reason: 'join public open' },
  });
  expect(publicOpenJoin.status()).toBe(201);
  expect(await publicOpenJoin.json()).toMatchObject({ outcome: 'joined', membership_status: 'active' });
  await assertProjectOverviewAccessible({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: projects.publicOpen.projectId,
  });

  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  await assertMemberVisibleInMembersPage({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: projects.publicOpen.projectId,
    member: args.guest,
  });

  const publicApprovalJoin = await apiRequest({
    page: args.page,
    token: args.member.token,
    method: 'POST',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${projects.publicApproval.projectId}/join-requests`,
    body: { reason: 'need access' },
  });
  expect(publicApprovalJoin.status()).toBe(201);
  const publicApprovalPayload = (await publicApprovalJoin.json()) as { outcome: string; join_request_id: string };
  expect(publicApprovalPayload.outcome).toBe('pending');
  const approveJoin = await apiRequest({
    page: args.page,
    token: args.creator.token,
    method: 'POST',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${projects.publicApproval.projectId}/join-requests/${publicApprovalPayload.join_request_id}/approve`,
  });
  expect(approveJoin.status()).toBe(204);

  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  await assertProjectOverviewAccessible({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: projects.publicApproval.projectId,
  });

  const privateOpenJoinDenied = await apiRequest({
    page: args.page,
    token: args.guest.token,
    method: 'POST',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${projects.privateOpen.projectId}/join-requests`,
    body: { reason: 'should fail' },
  });
  expect(privateOpenJoinDenied.status()).toBe(403);
  const privateOpenGet = await apiRequest({
    page: args.page,
    token: args.guest.token,
    method: 'GET',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${projects.privateOpen.projectId}`,
  });
  expect(privateOpenGet.status()).toBe(404);

  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  const privateOpenInviteToken = await createInviteViaUi({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: projects.privateOpen.projectId,
    invitedEmail: args.invitee.email,
  });
  const acceptPrivateOpen = await apiRequest({
    page: args.page,
    token: args.invitee.token,
    method: 'POST',
    path: '/api/v1/join/accept',
    body: { token: privateOpenInviteToken },
  });
  expect(acceptPrivateOpen.status()).toBe(200);
  await assertOnlyProjectMemberGroup({
    page: args.page,
    token: args.creator.token,
    workspaceId: args.workspaceId,
    projectId: projects.privateOpen.projectId,
    invitedUserId: args.invitee.userId,
  });

  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_INVITEE_USERNAME, KEYCLOAK_INTEGRATION_INVITEE_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  await assertProjectOverviewAccessible({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: projects.privateOpen.projectId,
  });

  const privateApprovalJoinDenied = await apiRequest({
    page: args.page,
    token: args.member.token,
    method: 'POST',
    path: `/api/v1/workspaces/${args.workspaceId}/projects/${projects.privateApproval.projectId}/join-requests`,
    body: { reason: 'should fail' },
  });
  expect(privateApprovalJoinDenied.status()).toBe(403);

  const privateApprovalInviteDeclineToken = await createInviteViaApi({
    page: args.page,
    token: args.creator.token,
    workspaceId: args.workspaceId,
    projectId: projects.privateApproval.projectId,
    invitedEmail: args.guest.email,
  });
  const declinePrivateApproval = await apiRequest({
    page: args.page,
    token: args.guest.token,
    method: 'POST',
    path: '/api/v1/join/decline',
    body: { token: privateApprovalInviteDeclineToken },
  });
  expect(declinePrivateApproval.status()).toBe(200);

  const privateApprovalInviteAcceptToken = await createInviteViaApi({
    page: args.page,
    token: args.creator.token,
    workspaceId: args.workspaceId,
    projectId: projects.privateApproval.projectId,
    invitedEmail: args.guest.email,
  });
  const acceptPrivateApproval = await apiRequest({
    page: args.page,
    token: args.guest.token,
    method: 'POST',
    path: '/api/v1/join/accept',
    body: { token: privateApprovalInviteAcceptToken },
  });
  expect(acceptPrivateApproval.status()).toBe(200);
  await assertOnlyProjectMemberGroup({
    page: args.page,
    token: args.creator.token,
    workspaceId: args.workspaceId,
    projectId: projects.privateApproval.projectId,
    invitedUserId: args.guest.userId,
  });
  if (args.traceEnabled !== false && args.trace) {
    await args.trace.capture(args.page, {
      stepId: 'private-project-governance',
      note: '私有项目的 join policy 和审批路径已验证',
    });
  }

  await keycloakLoginToWorkspace(args.page, args.workspaceId, KEYCLOAK_INTEGRATION_GUEST_USERNAME, KEYCLOAK_INTEGRATION_GUEST_PASSWORD, {
    ensureProjectCreatorAccess: false,
  });
  await assertProjectOverviewAccessible({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: projects.privateApproval.projectId,
  });
}

test.describe('@lane-real integration workspace project governance matrix', () => {
  test.afterAll(async () => {
    await teardownExternalTestKeycloak();
  });


test('workspace admin delegates project creator without granting workspace admin capability', async ({ page }) => {
    test.setTimeout(300_000);

    const runtime = requireWorkspaceAdminBoundaryRuntime();
    const workspaceId = (WORKSPACE_ADMIN_BOUNDARY_STORY.seedData?.[0] ?? 'ws_default').toString();
    const projectName = `${runtime.projectNamePrefix} ${Date.now()}`;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-project-governance-matrix',
      storyId: WORKSPACE_ADMIN_BOUNDARY_STORY.storyId,
      title: WORKSPACE_ADMIN_BOUNDARY_STORY.title,
      actor: WORKSPACE_ADMIN_BOUNDARY_STORY.actor,
      route: WORKSPACE_ADMIN_BOUNDARY_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-project-governance-matrix.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_ADMIN_BOUNDARY_STORY.goal,
      preconditions: [...(WORKSPACE_ADMIN_BOUNDARY_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_ADMIN_BOUNDARY_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_ADMIN_BOUNDARY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await ensureIntegrationKeycloakUsers();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/settings`);
      await expect(page.getByTestId('ws-settings__project-creators')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'open-workspace-creator-management' });

      await ensureWorkspaceProjectCreatorViaUi({
        page,
        workspaceId,
        creatorEmail: runtime.creatorEmail,
      });
      await trace.capture(page, { stepId: 'save-project-creator' });

      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_INTEGRATION_USER_USERNAME, KEYCLOAK_INTEGRATION_USER_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });
      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
      await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar__nav-item--settings')).toHaveCount(0);
      await trace.capture(page, { stepId: 'creator-project-entry' });

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/settings`);
      await expect(page.getByTestId('page-state__error')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('ws-settings__project-creators')).toHaveCount(0);
      await trace.capture(page, { stepId: 'creator-workspace-boundary' });

      await createProjectViaProjectsUi({
        page,
        workspaceId,
        projectName,
      });
      await expect(page.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar__nav-item--settings')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('sidebar__nav-item--settings').click();
      await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/.+/settings(?:$|\\?)`), { timeout: 30_000 });
      await expect(page.getByTestId('settings__project-owner-save')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'creator-create-project' });

      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });


  test('membership change updates effective access immediately for a joined member', async ({ page }) => {
    test.setTimeout(900_000);

    const runtime = await requireMembershipChangeRuntime();
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-project-governance-matrix',
      storyId: MEMBERSHIP_CHANGE_STORY.storyId,
      title: MEMBERSHIP_CHANGE_STORY.title,
      actor: MEMBERSHIP_CHANGE_STORY.actor,
      route: MEMBERSHIP_CHANGE_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-project-governance-matrix.spec.ts',
      browser: 'chromium',
      goal: MEMBERSHIP_CHANGE_STORY.goal,
      preconditions: [...(MEMBERSHIP_CHANGE_STORY.preconditions ?? [])],
      seedData: [...(MEMBERSHIP_CHANGE_STORY.seedData ?? [])],
      storyBinding: MEMBERSHIP_CHANGE_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await ensureIntegrationKeycloakUsers();
      await page.goto(`/${LOCALE}/system/login`);
      await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
      await loginAsSystemAdminViaVisibleHeading(page);

      const workspaceName = `${runtime.projectNamePrefix} Workspace ${Date.now()}`;
      const workspaceId = await createAndPublishWorkspaceWithVisibleHeading({
        page,
        workspaceName,
      });

      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });
      const project = await createProjectInWorkspace(page, workspaceId, `${runtime.projectNamePrefix} ${Date.now()}`, {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });

      const inviteToken = await createInviteViaUi({
        page,
        workspaceId,
        projectId: project.projectId,
        invitedEmail: runtime.memberEmail,
      });
      await trace.capture(page, { stepId: 'issue-project-invite' });

      const memberContext = await page.context().browser()?.newContext();
      if (!memberContext) {
        throw new Error('member_context_not_available');
      }
      const memberPage = await memberContext.newPage();
      try {
        await keycloakLoginToWorkspace(memberPage, workspaceId, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
          ensureProjectCreatorAccess: false,
        });
        await memberPage.goto(`/${LOCALE}/join?token=${inviteToken}`);
        await expect(memberPage.getByTestId('join__accept-btn')).toBeVisible({ timeout: 30_000 });
        await memberPage.getByTestId('join__accept-btn').click();
        await memberPage.waitForURL(/\/login\/workspace/, { timeout: 30_000 });
        await trace.capture(memberPage, { stepId: 'accept-project-invite' });

        const memberToken = await readStoredAuthToken(memberPage);
        if (!memberToken) {
          throw new Error('member_token_missing_after_join');
        }
        const memberUserId = readUserIdFromJwt(memberToken);
        const memberProfile = {
          userId: memberUserId,
          email: runtime.memberEmail,
          name: runtime.memberDisplayName,
        };

        const memberOverviewResponse = await memberPage.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${project.projectId}`,
          { headers: { Authorization: `Bearer ${memberToken}` } },
        );
        expect(memberOverviewResponse.ok()).toBeTruthy();

        await assertMemberVisibleInMembersPage({
          page,
          workspaceId,
          projectId: project.projectId,
          member: memberProfile,
        });
        await openMemberDrawerByEmail({
          page,
          workspaceId,
          projectId: project.projectId,
          memberEmail: memberProfile.email,
        });
        await assertMemberDrawerEffectiveState({
          page,
          expectedAccessGroup: /member/i,
          expectedMembershipStatus: /active/i,
          expectedPermissions: runtime.joinedMemberPermissions,
        });
        await trace.capture(page, { stepId: 'open-member-effective-access' });

        await setProjectAdminMembership({
          page,
          workspaceId,
          projectId: project.projectId,
          memberUserId: memberProfile.userId,
          shouldBeAdmin: true,
        });
        await trace.note({
          stepId: 'promote-member-admin',
          note: '成员已加入 Project Admins，等待 drawer 用真实 effective access 反映新能力',
        });
        await openMemberDrawerByEmail({
          page,
          workspaceId,
          projectId: project.projectId,
          memberEmail: memberProfile.email,
        });
        await assertMemberDrawerEffectiveState({
          page,
          expectedAccessGroup: /manager|admin/i,
          expectedMembershipStatus: /active/i,
          expectedPermissions: runtime.promotedMemberPermissions,
        });
        await trace.capture(page, { stepId: 'reopen-member-effective-access-after-promotion' });

        await setProjectAdminMembership({
          page,
          workspaceId,
          projectId: project.projectId,
          memberUserId: memberProfile.userId,
          shouldBeAdmin: false,
        });
        await openMemberDrawerByEmail({
          page,
          workspaceId,
          projectId: project.projectId,
          memberEmail: memberProfile.email,
        });
        await assertMemberDrawerEffectiveState({
          page,
          expectedAccessGroup: /member/i,
          expectedMembershipStatus: /active/i,
          expectedPermissions: runtime.joinedMemberPermissions,
        });
        await trace.capture(page, { stepId: 'demote-member-back' });

        await removeProjectMemberByRowMenu({
          page,
          workspaceId,
          projectId: project.projectId,
          memberId: memberProfile.userId,
          memberEmail: memberProfile.email,
        });
        await trace.note({
          stepId: 'remove-member',
          note: '成员已从项目中移除，成员列表立即收口',
        });

        const verificationContext = await page.context().browser()?.newContext();
        if (!verificationContext) {
          throw new Error('verification_context_not_available');
        }
        const verificationPage = await verificationContext.newPage();
        try {
          await keycloakLoginToWorkspace(verificationPage, workspaceId, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
            ensureProjectCreatorAccess: false,
          });
          const removedProjectListResponse = await verificationPage.request.get(
            `${API_BASE}/api/v1/workspaces/${workspaceId}/projects`,
            { headers: { Authorization: `Bearer ${memberToken}` } },
          );
          expect(removedProjectListResponse.ok()).toBeTruthy();
          const removedProjectListBody = await removedProjectListResponse.json() as { items?: Array<{ id: string; name: string }> };
          expect(removedProjectListBody.items?.some((item) => item.id === project.projectId || item.name === project.projectName)).toBe(false);

          const removedProjectResponse = await verificationPage.request.get(
            `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${project.projectId}`,
            { headers: { Authorization: `Bearer ${memberToken}` } },
          );
          expect(removedProjectResponse.status()).toBe(404);
          await verificationPage.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/overview`);
          await expect(verificationPage.getByTestId('project-shell__project-not-found')).toBeVisible({ timeout: 30_000 });
          await expect(verificationPage.getByText('Project unavailable', { exact: true })).toBeVisible({ timeout: 30_000 });
          await expect(verificationPage.getByText('This project is no longer available. It may have been removed, or its workspace may no longer be accessible.', { exact: true })).toBeVisible({ timeout: 30_000 });
          await expect(verificationPage.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 30_000 });
          await trace.capture(verificationPage, { stepId: 'verify-removed-access' });
          outcome = 'pass';
        } finally {
          await verificationContext.close();
        }
      } finally {
        await memberContext.close();
      }
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });

  test('creates a workspace, grants project creators, verifies the 2x2 matrix, then repeats after switching to an external keycloak', async ({ page }) => {
    test.setTimeout(1_200_000);

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-project-governance-matrix',
      storyId: GOVERNANCE_ONBOARDING_STORY.storyId,
      title: GOVERNANCE_ONBOARDING_STORY.title,
      actor: GOVERNANCE_ONBOARDING_STORY.actor,
      route: GOVERNANCE_ONBOARDING_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-project-governance-matrix.spec.ts',
      browser: 'chromium',
      goal: GOVERNANCE_ONBOARDING_STORY.goal,
      preconditions: [...(GOVERNANCE_ONBOARDING_STORY.preconditions ?? [])],
      seedData: [...(GOVERNANCE_ONBOARDING_STORY.seedData ?? [])],
      storyBinding: GOVERNANCE_ONBOARDING_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await ensureIntegrationKeycloakUsers();
      await page.goto(`/${LOCALE}/system/login`);
      await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'system-login' });
      await loginAsSystemAdminViaVisibleHeading(page);
      const workspaceNamePrefix = MATRIX_SETUP?.workspaceNamePrefix ?? 'Governance Matrix';
      const workspaceName = `${workspaceNamePrefix} ${Date.now()}`;
      const workspaceId = await createAndPublishWorkspaceWithVisibleHeading({
        page,
        workspaceName,
      });
      await trace.note({
        stepId: 'workspace-created-published',
        note: '新工作区创建并发布完成',
      });

      const admin = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_DEV_ADMIN_USERNAME,
        password: KEYCLOAK_DEV_ADMIN_PASSWORD,
      });
      await ensureWorkspaceProjectCreatorAccess({
        page,
        apiBase: API_BASE,
        token: admin.token,
        username: KEYCLOAK_INTEGRATION_USER_USERNAME,
        workspaceId,
      });
      await trace.note({
        stepId: 'workspace-project-creators-granted',
        note: '工作区 project creators 已配置完成',
      });

      const creator = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_USER_USERNAME,
        password: KEYCLOAK_INTEGRATION_USER_PASSWORD,
      });
      const projectPrefix = MATRIX_SETUP?.projectNamePrefix ?? MATRIX_SETUP?.workspaceNamePrefix ?? 'Governance Matrix';
      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
      await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar__nav-item--settings')).toHaveCount(0);
      await trace.capture(page, { stepId: 'public-project-discovery' });

      const member = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        password: KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      });
      member.email ||= KEYCLOAK_INTEGRATION_MEMBER_EMAIL;
      const memberCreateAttempt = await apiRequest({
        page,
        token: member.token,
        method: 'POST',
        path: `/api/v1/workspaces/${workspaceId}/projects`,
        body: {
          name: 'Blocked Project Creator Attempt',
          visibility: 'private',
          join_policy: 'approval_required',
        },
      });
      expect(memberCreateAttempt.status()).toBe(403);

      const guest = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_GUEST_USERNAME,
        password: KEYCLOAK_INTEGRATION_GUEST_PASSWORD,
      });
      guest.email ||= KEYCLOAK_INTEGRATION_GUEST_EMAIL;
      const invitee = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_INVITEE_USERNAME,
        password: KEYCLOAK_INTEGRATION_INVITEE_PASSWORD,
      });
      invitee.email ||= KEYCLOAK_INTEGRATION_INVITEE_EMAIL;

      await runProjectMatrix({
        page,
        workspaceId,
        creator,
        member,
        guest,
        invitee,
        prefix: `${projectPrefix} ${MATRIX_SETUP?.defaultIdpLabel ?? 'Default IdP'}`,
        trace,
        traceEnabled: true,
      });

      await ensureExternalTestKeycloak();
      await loginAsSystemAdminViaVisibleHeading(page);
      await page.goto(`/${LOCALE}/system/workspaces?workspace=${workspaceId}`);
      await expect(page.getByRole('heading', { name: /system workspaces/i })).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('system-workspaces__enable-edit').click();
      await page.getByTestId('system-workspaces__draft-idp-url').fill(EXTERNAL_KEYCLOAK_BASE_URL);
      await page.getByTestId('system-workspaces__draft-idp-realm').fill(process.env.KEYCLOAK_REALM ?? 'mbos');
      await page.getByTestId('system-workspaces__draft-idp-client-id').fill(process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith');
      await page.getByTestId('system-workspaces__draft-directory-client-id').fill(KEYCLOAK_DIRECTORY_CLIENT_ID);
      await page.getByTestId('system-workspaces__draft-idp-client-secret').fill(KEYCLOAK_DIRECTORY_CLIENT_SECRET);
      const verifyExternalResponse = page.waitForResponse(
        (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await page.getByTestId('system-workspaces__verify-idp').click();
      expect((await verifyExternalResponse).ok()).toBeTruthy();
      await page.getByTestId('system-workspaces__admin-mode--directory').click();
      await selectWorkspaceAdminFromDirectory(page, 'dev-admin@example.com');
      await page.getByTestId('system-workspaces__save').click();
      await expect(page.getByTestId('system-workspaces__save-notice')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('system-workspaces__publish').click();
      await expect(page.getByTestId('system-workspaces__save-notice')).toBeVisible({ timeout: 20_000 });

      await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_DEV_ADMIN_USERNAME,
        password: KEYCLOAK_DEV_ADMIN_PASSWORD,
      });
      await ensureWorkspaceProjectCreatorAccess({
        page,
        apiBase: API_BASE,
        token: admin.token,
        username: KEYCLOAK_INTEGRATION_USER_USERNAME,
        workspaceId,
      });

      const switchedCreator = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_USER_USERNAME,
        password: KEYCLOAK_INTEGRATION_USER_PASSWORD,
      });
      switchedCreator.email ||= KEYCLOAK_INTEGRATION_USER_EMAIL;
      const switchedMember = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        password: KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      });
      switchedMember.email ||= KEYCLOAK_INTEGRATION_MEMBER_EMAIL;
      const switchedGuest = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_GUEST_USERNAME,
        password: KEYCLOAK_INTEGRATION_GUEST_PASSWORD,
      });
      switchedGuest.email ||= KEYCLOAK_INTEGRATION_GUEST_EMAIL;
      const switchedInvitee = await loginAndReadIdentity({
        page,
        workspaceId,
        username: KEYCLOAK_INTEGRATION_INVITEE_USERNAME,
        password: KEYCLOAK_INTEGRATION_INVITEE_PASSWORD,
      });
      switchedInvitee.email ||= KEYCLOAK_INTEGRATION_INVITEE_EMAIL;

      await runProjectMatrix({
        page,
        workspaceId,
        creator: switchedCreator,
        member: switchedMember,
        guest: switchedGuest,
        invitee: switchedInvitee,
        prefix: `${projectPrefix} ${MATRIX_SETUP?.externalIdpLabel ?? 'External IdP'}`,
        trace,
        traceEnabled: false,
      });

      const adminMembersRes = await apiRequest({
        page,
        token: admin.token,
        method: 'GET',
        path: `/api/v1/workspaces/${workspaceId}/members`,
      });
      expect(adminMembersRes.ok()).toBeTruthy();
      await trace.note({
        stepId: 'matrix-verification',
        note: 'workspace / project 访问矩阵已收敛到预期状态',
      });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
