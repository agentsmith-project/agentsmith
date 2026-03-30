import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  createAndPublishWorkspaceWithDirectoryAdmin,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  ensureExternalTestKeycloak,
  ensureWorkspaceProjectCreatorViaUi,
  EXTERNAL_KEYCLOAK_BASE_URL,
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
  loginAsSystemAdmin,
  LOCALE,
  selectWorkspaceAdminFromDirectory,
  teardownExternalTestKeycloak,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

type UserIdentity = {
  token: string;
  userId: string;
  email: string;
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
  const profile = (await res.json()) as { id?: string; user_id?: string; email?: string };
  const jwt = decodeJwtPayload(token);
  const userId =
    profile.id ??
    profile.user_id ??
    (typeof jwt.sub === 'string' ? jwt.sub : undefined);
  const email =
    profile.email ??
    (typeof jwt.email === 'string' ? jwt.email : undefined) ??
    '';
  if (!userId) {
    throw new Error(`identity_user_id_missing:${args.username}`);
  }
  return { token, userId, email };
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
  await expect(args.page.getByText('permission_denied_title')).toHaveCount(0);
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

async function runProjectMatrix(args: {
  page: Page;
  workspaceId: string;
  creator: UserIdentity;
  member: UserIdentity;
  guest: UserIdentity;
  invitee: UserIdentity;
  prefix: string;
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

  test('creates a workspace, grants project creators, verifies the 2x2 matrix, then repeats after switching to an external keycloak', async ({ page }) => {
    test.setTimeout(1_200_000);

    await ensureIntegrationKeycloakUsers();
    await loginAsSystemAdmin(page);
    const workspaceName = `Governance Matrix ${Date.now()}`;
    const workspaceId = await createAndPublishWorkspaceWithDirectoryAdmin({
      page,
      workspaceName,
    });

    const admin = await loginAndReadIdentity({
      page,
      workspaceId,
      username: KEYCLOAK_DEV_ADMIN_USERNAME,
      password: KEYCLOAK_DEV_ADMIN_PASSWORD,
    });
    await ensureWorkspaceProjectCreatorViaUi({
      page,
      workspaceId,
      creatorEmail: 'integration-user@example.com',
    });

    const creator = await loginAndReadIdentity({
      page,
      workspaceId,
      username: KEYCLOAK_INTEGRATION_USER_USERNAME,
      password: KEYCLOAK_INTEGRATION_USER_PASSWORD,
    });
    await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
    await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sidebar__nav-item--settings')).toHaveCount(0);

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
      prefix: 'Default IdP',
    });

    await ensureExternalTestKeycloak();
    await loginAsSystemAdmin(page);
    await page.goto(`/${LOCALE}/system/workspaces?workspace=${workspaceId}`);
    await expect(page.getByTestId('system-workspaces__heading')).toBeVisible({ timeout: 30_000 });
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
    await ensureWorkspaceProjectCreatorViaUi({
      page,
      workspaceId,
      creatorEmail: 'integration-user@example.com',
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
      prefix: 'External IdP',
    });

    const adminMembersRes = await apiRequest({
      page,
      token: admin.token,
      method: 'GET',
      path: `/api/v1/workspaces/${workspaceId}/members`,
    });
    expect(adminMembersRes.ok()).toBeTruthy();
  });
});
