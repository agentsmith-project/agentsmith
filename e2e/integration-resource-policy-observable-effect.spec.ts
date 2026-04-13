import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import {
  createInviteViaUi,
  readUserIdFromJwt,
  runEndpointProxyChatCompletion,
  updateEndpointPolicyAllowListViaUi,
} from './integration-governance-runtime-support';
import { readStoredAuthToken } from './integration-workspace-access';

const STORY = loadStoryDefinitionSync('e2e/stories/backend-real/resource-policy-change-to-observable-effect.story.md');
const BINDING = buildTraceStoryBinding(STORY);
const WORKSPACE_ID = STORY.seedData?.[0] ?? 'ws_default';

type RuntimeData = {
  projectNamePrefix: string;
  memberEmail: string;
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  allowedTokenPrefix: string;
};

function requireRuntime(): RuntimeData {
  const runtimeRoot = STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.resourcePolicyObservable as Record<string, unknown> | undefined;
  if (!runtime) throw new Error('missing_resource_policy_observable_runtime');
  for (const key of ['projectNamePrefix', 'memberEmail', 'credentialNamePrefix', 'endpointNamePrefix', 'allowedTokenPrefix'] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_resource_policy_observable_runtime:${key}`);
    }
  }
  return runtime as unknown as RuntimeData;
}

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function runExplainability(args: {
  page: import('@playwright/test').Page;
  subjectId: string;
}) {
  await args.page.getByTestId('resource-policy__explain-subject-type').selectOption('user');
  await args.page.getByTestId('resource-policy__explain-subject-id').selectOption(args.subjectId);
  await args.page.getByTestId('resource-policy__explain-action').fill('invoke');
  await args.page.getByTestId('resource-policy__explain-run').click();
  await expect(args.page.getByTestId('resource-policy__explain-result')).toBeVisible({ timeout: 30_000 });
}

test.describe('@lane-real resource policy change leads to observable effect', () => {
  test('owner sees deny in explainability and member really loses then regains endpoint use', async ({ browser, page }) => {
    test.setTimeout(900_000);
    const runtime = requireRuntime();
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-resource-policy-observable-effect',
      storyId: STORY.storyId,
      title: STORY.title,
      actor: STORY.actor,
      route: STORY.entryRoute,
      specFile: 'e2e/integration-resource-policy-observable-effect.spec.ts',
      browser: 'chromium',
      goal: STORY.goal,
      preconditions: [...(STORY.preconditions ?? [])],
      seedData: [...(STORY.seedData ?? [])],
      storyBinding: BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });
      const ownerToken = await readStoredAuthToken(page);
      const ownerUserId = readUserIdFromJwt(ownerToken);

      const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, `${runtime.projectNamePrefix} ${Date.now()}`, {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });
      const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, apiKey);
      const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
        endpointName: `${runtime.endpointNamePrefix} ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
      });

      const inviteToken = await createInviteViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        invitedEmail: runtime.memberEmail,
      });

      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      try {
        await keycloakLoginToWorkspace(memberPage, WORKSPACE_ID, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
          ensureProjectCreatorAccess: false,
        });
        await memberPage.goto(`/${LOCALE}/join?token=${inviteToken}`);
        await expect(memberPage.getByTestId('join__auto-accepting')).toBeVisible({ timeout: 30_000 });
        await memberPage.waitForURL((url) => {
          const parsed = new URL(url.toString());
          return parsed.pathname === `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/overview`;
        }, { timeout: 30_000 });
        await expect(memberPage.getByTestId('project-hub__page')).toBeVisible({ timeout: 30_000 });
        const memberToken = await readStoredAuthToken(memberPage);
        const memberUserId = readUserIdFromJwt(memberToken);

        await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/resource-policy`);
        await expect(page.getByTestId('resource-policy__table')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId(`resource-policy__row--endpoint--${endpointId}`).click();
        await expect(page.getByTestId('resource-policy__effective-summary')).toBeVisible({ timeout: 30_000 });
        await runExplainability({ page, subjectId: memberUserId });
        await expect(page.getByTestId('resource-policy__explain-result')).toContainText(/Allowed/i);
        const allowedBaseline = await runEndpointProxyChatCompletion({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          endpointId,
          content: `Reply briefly about ${runtime.allowedTokenPrefix}_BASELINE_${Date.now()}.`,
        });
        expect(allowedBaseline.status).toBe(200);
        expect(allowedBaseline.bodyText).toContain('choices');
        await trace.capture(page, { stepId: 'baseline-member-can-use-endpoint' });

        await updateEndpointPolicyAllowListViaUi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          endpointId,
          userIds: [ownerUserId],
          explainSubjectId: memberUserId,
        });
        await expect(page.getByTestId('resource-policy__explain-result')).toContainText(/Denied/i);
        await expect(page.getByTestId('resource-policy__matched-policy')).toContainText(/allow/i);
        await trace.capture(page, { stepId: 'tighten-policy-and-explain-deny' });

        const deniedUse = await runEndpointProxyChatCompletion({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          endpointId,
          content: 'blocked by resource policy deny',
        });
        expect(deniedUse.status).toBe(403);
        expect(deniedUse.bodyText).toContain('RESOURCE_POLICY_DENIED');
        await trace.capture(page, { stepId: 'member-hit-policy-denial' });

        await updateEndpointPolicyAllowListViaUi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          endpointId,
          userIds: [ownerUserId, memberUserId],
          explainSubjectId: memberUserId,
        });
        await expect(page.getByTestId('resource-policy__explain-result')).toContainText(/Allowed/i);
        const restoredUse = await runEndpointProxyChatCompletion({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          endpointId,
          content: `Reply briefly about ${runtime.allowedTokenPrefix}_RESTORED_${Date.now()}.`,
        });
        expect(restoredUse.status).toBe(200);
        expect(restoredUse.bodyText).toContain('choices');
        await trace.capture(page, { stepId: 'reopen-policy-and-restore-use' });

        outcome = 'pass';
      } finally {
        await memberContext.close();
      }
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });
});
