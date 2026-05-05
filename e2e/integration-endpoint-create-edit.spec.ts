import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const RUNTIME_SETUP_STORY = loadStoryDefinitionSync('project-governance-runtime-setup');
const RUNTIME_SETUP_BINDING = buildTraceStoryBinding(RUNTIME_SETUP_STORY);
const WORKSPACE_ID = RUNTIME_SETUP_STORY.seedData?.[0];

type EndpointFlowRuntime = {
  custom: {
    namePrefix: string;
    upstreamProtocol: string;
    baseUrl: string;
    model: string;
  };
  catalog: {
    namePrefix: string;
    upstreamProtocol: string;
    baseUrl: string;
    model: string;
  };
};

type AgentSetupRuntime = {
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  agentTaskRunnerTitlePrefix: string;
  memberTaskTitlePrefix: string;
};

function requireWorkspaceId(): string {
  if (typeof WORKSPACE_ID !== 'string' || WORKSPACE_ID.trim().length === 0) {
    throw new Error('missing_project_governance_runtime_workspace_seed');
  }
  return WORKSPACE_ID;
}

function requireEndpointFlowRuntime(): EndpointFlowRuntime {
  const runtimeRoot = RUNTIME_SETUP_STORY.runtimeData as Record<string, unknown> | undefined;
  const endpointFlows = runtimeRoot?.endpointFlows as Record<string, unknown> | undefined;
  const custom = endpointFlows?.custom as Record<string, unknown> | undefined;
  const catalog = endpointFlows?.catalog as Record<string, unknown> | undefined;
  if (!custom || !catalog) {
    throw new Error('missing_project_governance_runtime:endpointFlows');
  }
  for (const [scope, config] of Object.entries({ custom, catalog })) {
    for (const field of ['namePrefix', 'upstreamProtocol', 'baseUrl', 'model'] as const) {
      if (typeof config[field] !== 'string' || config[field].trim().length === 0) {
        throw new Error(`missing_project_governance_runtime:endpointFlows.${scope}.${field}`);
      }
    }
  }
  return { custom, catalog } as unknown as EndpointFlowRuntime;
}

function requireAgentSetupRuntime(): AgentSetupRuntime {
  const runtimeRoot = RUNTIME_SETUP_STORY.runtimeData as Record<string, unknown> | undefined;
  const agentSetup = runtimeRoot?.agentSetup as Record<string, unknown> | undefined;
  if (!agentSetup) {
    throw new Error('missing_project_governance_runtime:agentSetup');
  }
  for (const field of ['credentialNamePrefix', 'endpointNamePrefix', 'agentTaskRunnerTitlePrefix', 'memberTaskTitlePrefix'] as const) {
    if (typeof agentSetup[field] !== 'string' || agentSetup[field].trim().length === 0) {
      throw new Error(`missing_project_governance_runtime:agentSetup.${field}`);
    }
  }
  return agentSetup as unknown as AgentSetupRuntime;
}

const RUNTIME_SETUP = requireEndpointFlowRuntime();
const AGENT_SETUP = requireAgentSetupRuntime();

async function gotoProjectSection(page: Page, workspaceId: string, projectId: string, section: string) {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/${section}`);
}

async function openEndpointRowEditDialog(page: Page, endpointName: string): Promise<Locator> {
  const row = page.getByTestId('endpoints__table__row').filter({ hasText: endpointName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('button').first().click();
  const dialog = page.getByTestId('endpoints__edit-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test.describe('@lane-real integration endpoint create/edit flows', () => {
  test('custom endpoint create and edit keep custom UX and responses protocol', async ({ page }) => {
    test.setTimeout(300_000);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-endpoint-create-edit',
      storyId: RUNTIME_SETUP_STORY.storyId,
      title: RUNTIME_SETUP_STORY.title,
      actor: RUNTIME_SETUP_STORY.actor,
      route: RUNTIME_SETUP_STORY.entryRoute,
      specFile: 'e2e/integration-endpoint-create-edit.spec.ts',
      browser: 'chromium',
      goal: RUNTIME_SETUP_STORY.goal,
      preconditions: [...(RUNTIME_SETUP_STORY.preconditions ?? [])],
      seedData: [...(RUNTIME_SETUP_STORY.seedData ?? [])],
      storyBinding: RUNTIME_SETUP_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      const workspaceId = requireWorkspaceId();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Endpoint Create Edit');
      const credentialName = `${AGENT_SETUP.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, credentialName, 'sk-endpoint-ux');
      await trace.capture(page, { stepId: 'credentials-list' });

      await gotoProjectSection(page, workspaceId, projectId, 'endpoints');
      await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('endpoints__create-btn').click();
      const dialog = page.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /use guided setup/i }).click();

      const wizard = page.getByTestId('endpoints__custom-wizard');
      const endpointName = `${RUNTIME_SETUP.custom.namePrefix} ${Date.now()}`;
      await expect(wizard).toBeVisible({ timeout: 30_000 });
      await wizard.getByTestId('wizard-name-input').fill(endpointName);
      await wizard.getByTestId('protocol-openai_responses').click();
      await wizard.getByTestId('wizard-base-url-input').fill(RUNTIME_SETUP.custom.baseUrl);
      await wizard.getByRole('button', { name: /next|下一步/i }).click();
      await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible({ timeout: 30_000 });
      await wizard.getByTestId('wizard-model-id-input').fill(RUNTIME_SETUP.custom.model);
      await wizard.getByRole('button', { name: /next|下一步/i }).click();
      await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled({ timeout: 30_000 });
      await wizard.getByTestId('wizard-create-button').click();
      await expect(wizard).toBeHidden({ timeout: 30_000 });
      const createDialog = page.getByTestId('endpoints__create-dialog');
      if (await createDialog.isVisible().catch(() => false)) {
        await createDialog.getByRole('button', { name: /close|cancel/i }).first().click();
        await expect(createDialog).toBeHidden({ timeout: 30_000 });
      }

      let editDialog = await openEndpointRowEditDialog(page, endpointName);
      await expect(editDialog.locator('#endpoint-base-url')).toHaveValue(RUNTIME_SETUP.custom.baseUrl);
      await expect(editDialog.locator('#endpoint-model')).toHaveValue(RUNTIME_SETUP.custom.model);
      await expect(editDialog.getByRole('button', { name: /OpenAI Responses Upstreams/i })).toBeVisible();
      await expect(editDialog.getByText('Provider')).not.toBeVisible();
      await expect(editDialog.getByText('Catalog Models')).not.toBeVisible();

      await editDialog.locator('#endpoint-description').fill('Updated custom endpoint description');
      await editDialog.getByRole('button', { name: /save changes/i }).click();
      await expect(editDialog).toBeHidden({ timeout: 30_000 });

      editDialog = await openEndpointRowEditDialog(page, endpointName);
      await expect(editDialog.locator('#endpoint-description')).toHaveValue('Updated custom endpoint description');
      await expect(editDialog.locator('#endpoint-base-url')).toHaveValue(RUNTIME_SETUP.custom.baseUrl);
      await expect(editDialog.locator('#endpoint-model')).toHaveValue(RUNTIME_SETUP.custom.model);
      await expect(editDialog.getByRole('button', { name: /OpenAI Responses Upstreams/i })).toBeVisible();
      await expect(editDialog.getByText('Provider')).not.toBeVisible();
      await trace.capture(page, { stepId: 'endpoint-custom-created' });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });

  test('catalog endpoint edit keeps catalog UX and does not fall back to custom fields', async ({ page }) => {
    test.setTimeout(240_000);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-endpoint-create-edit',
      storyId: RUNTIME_SETUP_STORY.storyId,
      title: RUNTIME_SETUP_STORY.title,
      actor: RUNTIME_SETUP_STORY.actor,
      route: RUNTIME_SETUP_STORY.entryRoute,
      specFile: 'e2e/integration-endpoint-create-edit.spec.ts',
      browser: 'chromium',
      goal: RUNTIME_SETUP_STORY.goal,
      preconditions: [...(RUNTIME_SETUP_STORY.preconditions ?? [])],
      seedData: [...(RUNTIME_SETUP_STORY.seedData ?? [])],
      storyBinding: RUNTIME_SETUP_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      const workspaceId = requireWorkspaceId();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Endpoint Catalog Edit');
      const credentialName = `${AGENT_SETUP.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, credentialName, 'sk-endpoint-catalog');
      await trace.capture(page, { stepId: 'credentials-list' });

      const endpointName = `${RUNTIME_SETUP.catalog.namePrefix} ${Date.now()}`;
      await createEndpointViaApi(page, workspaceId, projectId, {
        endpointName,
        endpointModel: RUNTIME_SETUP.catalog.model,
        upstreamBaseUrl: RUNTIME_SETUP.catalog.baseUrl,
        credentialName,
        endpointType: 'catalog',
        providerFamily: 'anthropic',
        upstreamProtocol: RUNTIME_SETUP.catalog.upstreamProtocol,
      });

      await gotoProjectSection(page, workspaceId, projectId, 'endpoints');
      const editDialog = await openEndpointRowEditDialog(page, endpointName);
      await expect(editDialog.getByText('Provider')).toBeVisible();
      await expect(editDialog.getByText('Upstream Protocol')).toBeVisible();
      await expect(editDialog.getByText('Anthropic Messages')).toBeVisible();
      await expect(editDialog.locator('#endpoint-base-url')).toHaveCount(0);
      await expect(editDialog.locator('#endpoint-model')).toHaveCount(0);
      await expect(editDialog.getByText('Catalog Models')).toBeVisible();
      await trace.capture(page, { stepId: 'endpoint-catalog-edited' });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
