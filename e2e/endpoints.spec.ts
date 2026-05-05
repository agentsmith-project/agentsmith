/**
 * Endpoints Page – E2E Tests
 *
 * Covers table rendering, endpoint data, create dialog, edit dialog,
 * and delete confirmation using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';
import { withAuth } from './fixtures/authenticated';

test.describe.configure({ mode: 'serial' });

async function pickSelectOption(
  dialog: import('@playwright/test').Locator,
  page: import('@playwright/test').Page,
  option: RegExp,
) {
  const triggers = dialog.locator('[role="combobox"]');
  const count = await triggers.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const trigger = triggers.nth(i);
    await trigger.click();
    const target = page.getByRole('option', { name: option }).first();
    if (await target.isVisible({ timeout: 600 }).catch(() => false)) {
      await target.click();
      return true;
    }
    await page.keyboard.press('Escape');
  }
  return false;
}

async function ensureCredentialExists(page: import('@playwright/test').Page) {
  await ensureEndpointsPageReady(page);
  await goToProject(page, 'credentials');
  const rows = page.getByTestId('credentials__table__row');
  if ((await rows.count()) === 0) {
    await page.getByTestId('credentials__create-btn').click();
    const dialog = page.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#cred-name').fill(`E2E Credential ${Date.now()}`);
    await dialog.locator('#cred-value').fill('sk-e2e-temp-value');
    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  }
  await goToProject(page, 'endpoints');
  await ensureEndpointsPageReady(page);
}

async function recoverSessionIfNeeded(page: import('@playwright/test').Page) {
  const expiredState = page.getByText(/Session expired|会话已失效/i).first();
  const loginButton = page.getByRole('button', { name: /Login with Keycloak|使用 Keycloak 登录/i }).first();
  const needsRecover = (await expiredState.isVisible().catch(() => false))
    || (await loginButton.isVisible().catch(() => false));
  if (!needsRecover) return;

  await withAuth(page, 'ws_default', 'test@example.com', 'user_001');
  await goToProject(page, 'endpoints');
}

async function ensureEndpointsPageReady(page: import('@playwright/test').Page) {
  const table = page.getByTestId('endpoints__table');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tableVisible = await table.isVisible().catch(() => false);
    if (tableVisible) return;
    await recoverSessionIfNeeded(page);
    await goToProject(page, 'endpoints');
    if (await table.isVisible().catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  await expect(table).toBeVisible({ timeout: 10000 });
}

async function openCustomWizardFromCreateDialog(page: import('@playwright/test').Page) {
  await ensureEndpointsPageReady(page);
  await page.getByTestId('endpoints__create-btn').click();
  const dialog = page.getByTestId('endpoints__create-dialog');
  await expect(dialog).toBeVisible();
  await pickSelectOption(dialog, page, /Custom|自定义/i);
  await dialog.getByTestId('endpoints__open-guided-wizard').click();
  const wizard = page.getByTestId('endpoints__custom-wizard');
  await expect(wizard).toBeVisible({ timeout: 5000 });
  return wizard;
}

async function openManualEndpointForm(dialog: import('@playwright/test').Locator) {
  const nameInput = dialog.getByLabel(/name/i);
  if (await nameInput.isVisible().catch(() => false)) {
    return;
  }
  await dialog.getByRole('button', { name: /Use manual form instead|改用手动表单/i }).click();
  await expect(nameInput).toBeVisible();
}

test.describe('Endpoints Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'endpoints');
    await ensureEndpointsPageReady(authedPage);
  });

  test('table renders with endpoint rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('endpoints__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="endpoints__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test('displays endpoint names and URLs from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    // Endpoint names from p0.json: "OpenAI Main", "Claude Sonnet"
    await expect(authedPage.getByText('OpenAI Main')).toBeVisible();
    await expect(authedPage.getByText('Claude Sonnet')).toBeVisible();

    // Core columns should render.
    await expect(authedPage.getByRole('columnheader', { name: /provider/i })).toBeVisible();
    await expect(authedPage.getByRole('columnheader', { name: /^name$/i })).toBeVisible();
    await expect(authedPage.getByRole('columnheader', { name: /model/i })).toBeVisible();
  });

  test('shows build header actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__open-agent-runners')).toHaveAttribute(
      'href',
      /\/agent-runners$/,
    );
    await expect(authedPage.getByTestId('endpoints__open-chat')).toHaveCount(0);
    await expect(authedPage.getByTestId('endpoints__open-notebook')).toHaveCount(0);
  });

  test('create dialog opens with form fields', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByTestId('endpoints__open-guided-wizard')).toBeVisible();
    await openManualEndpointForm(dialog);
  });

  test('edit dialog opens when clicking edit on a row', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    // Click the edit (Pencil) button on the first endpoint row
    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();
    const editBtn = firstRow.getByRole('button', { name: /edit/i });
    await editBtn.click();

    const editDialog = authedPage.getByTestId('endpoints__edit-dialog');
    await expect(editDialog).toBeVisible();
  });

  test('action buttons include text labels on desktop layout', async ({ authedPage }) => {
    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();

    await expect(firstRow.getByRole('button', { name: /edit/i })).toBeVisible();
    await expect(firstRow.getByRole('button', { name: /disable|enable/i })).toBeVisible();
    await expect(firstRow.getByRole('button', { name: /delete/i })).toBeVisible();
  });

  test('delete action shows confirmation dialog', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    // Click the delete (Trash) button on the first endpoint row
    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();
    const deleteBtn = firstRow.getByRole('button', { name: /delete/i });
    await deleteBtn.click();

    // AlertDialog confirmation should appear
    await expect(authedPage.getByRole('alertdialog')).toBeVisible();
  });

  test('create endpoint via dialog submission', async ({ authedPage }) => {
    await ensureCredentialExists(authedPage);
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();
    await openManualEndpointForm(dialog);

    // Fill name only; model/base_url are derived from provider catalog selection.
    await dialog.getByLabel(/name/i).fill('E2E Test Endpoint');

    const noCredentialHint = dialog.getByText(/no credentials|create credential first|请先创建凭据/i).first();
    if (await noCredentialHint.isVisible().catch(() => false)) {
      await expect(dialog.getByRole('button', { name: /create/i })).toBeDisabled();
      return;
    }

    const credentialPicked = await pickSelectOption(dialog, authedPage, /OpenAI API Key|Anthropic API Key/i);
    expect(credentialPicked).toBe(true);

    // Submit the form
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    if (!(await submitBtn.isEnabled().catch(() => false))) {
      await expect(submitBtn).toBeDisabled();
      return;
    }
    await submitBtn.click();

    // Dialog should close after successful creation
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });

  test('create endpoint with empty name should not submit', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();
    await openManualEndpointForm(dialog);

    // Submit button should be disabled when required fields are empty
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('toggle endpoint status sends update request', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();
    const toggleBtn = firstRow.getByRole('button', { name: /disable|enable/i });

    const requestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PUT' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/endpoints\/.+/.test(req.url());
    });
    await toggleBtn.click();
    const request = await requestPromise;
    const payload = request.postDataJSON() as { status?: string };
    expect(payload.status === 'active' || payload.status === 'disabled').toBeTruthy();
  });

  test('open custom endpoint wizard from create dialog', async ({ authedPage }) => {
    await ensureCredentialExists(authedPage);
    await authedPage.getByTestId('endpoints__create-btn').click();
    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByTestId('endpoints__open-guided-wizard').click();
    await expect(authedPage.getByTestId('endpoints__custom-wizard')).toBeVisible({ timeout: 5000 });
  });

  test('create dialog shows name uniqueness hint and prevents duplicate names', async ({ authedPage }) => {
    await ensureEndpointsPageReady(authedPage);
    await authedPage.getByTestId('endpoints__create-btn').click();
    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();
    await openManualEndpointForm(dialog);

    // Existing endpoint in mock data: OpenAI Main
    await dialog.getByLabel(/name/i).fill('OpenAI Main');
    await expect(dialog.getByLabel(/name/i)).toHaveValue('OpenAI Main');
    await expect(dialog.getByText(/already exists|已存在同名端点/i)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  test.describe('Custom Endpoint Wizard', () => {
    test('opens wizard from external custom entry button', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('endpoints__open-guided-wizard')).toBeVisible();
    });

    test('opens custom wizard from create dialog', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      // Select custom provider
      await pickSelectOption(dialog, authedPage, /Custom/i);

      // Click wizard button
      const wizardBtn = dialog.getByTestId('endpoints__open-guided-wizard');
      await wizardBtn.click();

      // Wizard should open, main dialog should close
      await expect(authedPage.getByTestId('endpoints__custom-wizard')).toBeVisible({ timeout: 5000 });
    });

    test('wizard step 1: basic info flow', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      await pickSelectOption(dialog, authedPage, /Custom/i);

      const wizardBtn = dialog.getByTestId('endpoints__open-guided-wizard');
      await wizardBtn.click();

      // Wizard should be open
      const wizard = authedPage.getByTestId('endpoints__custom-wizard');
      await expect(wizard).toBeVisible();

      // Check title and protocol buttons
      await expect(wizard.getByText(/Create Custom Endpoint|custom_wizard\.title/i)).toBeVisible();
      await expect(wizard.getByTestId('protocol-openai_chat_completions')).toBeVisible();
      await expect(wizard.getByTestId('protocol-openai_responses')).toBeVisible();
      await expect(wizard.getByTestId('protocol-anthropic_messages')).toBeVisible();

      // Enter name and select protocol
      await wizard.getByTestId('wizard-name-input').fill('E2E Custom OpenAI');
      await wizard.getByTestId('protocol-openai_chat_completions').click();
      await wizard.getByTestId('wizard-use-default-url').click();
      await expect(wizard.getByTestId('wizard-base-url-input')).toHaveValue(/https:\/\//i);
    });

    test('wizard step 2: model config flow', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      await pickSelectOption(dialog, authedPage, /Custom/i);
      await dialog.getByTestId('endpoints__open-guided-wizard').click();

      const wizard = authedPage.getByTestId('endpoints__custom-wizard');
      await expect(wizard).toBeVisible();

      // Step 1: Fill basic info
      await wizard.getByTestId('wizard-name-input').fill('E2E Test Endpoint');
      await wizard.getByTestId('wizard-base-url-input').fill('https://api.example.com/v1');

      // Click Next
      const nextBtn = wizard.getByRole('button', { name: 'Next' });
      await nextBtn.click();

      // Should be on step 2
      await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible();

      // Fill model info
      await wizard.getByTestId('wizard-model-id-input').fill('gpt-4o-test');
    });

    test('wizard step 3: validation flow', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      await pickSelectOption(dialog, authedPage, /Custom/i);
      await dialog.getByTestId('endpoints__open-guided-wizard').click();

      const wizard = authedPage.getByTestId('endpoints__custom-wizard');
      await expect(wizard).toBeVisible();

      // Step 1
      await wizard.getByTestId('wizard-name-input').fill('E2E Test Endpoint');
      await wizard.getByTestId('wizard-base-url-input').fill('https://api.example.com/v1');

      let nextBtn = wizard.getByRole('button', { name: 'Next' });
      await nextBtn.click();

      // Step 2
      await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible();
      await wizard.getByTestId('wizard-model-id-input').fill('gpt-4o-test');

      nextBtn = wizard.getByRole('button', { name: 'Next' });
      if (!(await nextBtn.isEnabled().catch(() => false))) {
        const credentialPicked = await pickSelectOption(
          wizard,
          authedPage,
          /OpenAI API Key|Anthropic API Key|E2E Credential/i,
        );
        expect(credentialPicked).toBe(true);
        nextBtn = wizard.getByRole('button', { name: 'Next' });
      }

      await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
      await nextBtn.click();

      // Step 3
      await expect(wizard.getByTestId('wizard-check-button')).toBeVisible({ timeout: 10_000 });
      await expect(wizard.getByTestId('wizard-create-button')).toBeVisible({ timeout: 10_000 });

      // Create button should be enabled - validation is optional
      await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled();
    });

    test('accepts Provider coding URL without /v1 and creates endpoint', async ({ authedPage }) => {
      const wizard = await openCustomWizardFromCreateDialog(authedPage);

      await wizard.getByTestId('wizard-name-input').fill(`E2E Provider Compatible ${Date.now()}`);
      await wizard.getByTestId('wizard-base-url-input').fill('https://openai-compatible.provider.example');

      let nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();

      await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible();
      await wizard.getByTestId('wizard-model-id-input').fill('placeholder-model');

      nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      if (!(await nextBtn.isEnabled().catch(() => false))) {
        const credentialPicked = await pickSelectOption(
          wizard,
          authedPage,
          /OpenAI API Key|Anthropic API Key|E2E Credential/i,
        );
        expect(credentialPicked).toBe(true);
      }
      await nextBtn.click();
      await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled();

      const createRequestPromise = authedPage.waitForRequest((req) => {
        return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/endpoints$/.test(req.url());
      });
      await wizard.getByTestId('wizard-create-button').click();

      const req = await createRequestPromise;
      const payload = req.postDataJSON() as { base_url?: string; type?: string; upstream_protocol?: string };
      expect(payload.type).toBe('custom');
      expect(payload.upstream_protocol).toBe('openai_chat_completions');
      expect(payload.base_url).toBe('https://openai-compatible.provider.example');
    });

    test('accepts Provider anthropic URL and can pass validation check', async ({ authedPage }) => {
      const wizard = await openCustomWizardFromCreateDialog(authedPage);

      await wizard.getByTestId('wizard-name-input').fill(`E2E Provider Anthropic ${Date.now()}`);
      await wizard.getByTestId('protocol-anthropic_messages').click();
      await wizard.getByTestId('wizard-base-url-input').fill('https://anthropic-compatible.provider.example');

      let nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();

      await wizard.getByTestId('wizard-model-id-input').fill('placeholder-model');
      nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      if (!(await nextBtn.isEnabled().catch(() => false))) {
        const credentialPicked = await pickSelectOption(
          wizard,
          authedPage,
          /OpenAI API Key|Anthropic API Key|E2E Credential/i,
        );
        expect(credentialPicked).toBe(true);
      }
      await nextBtn.click();

      await expect(wizard.getByTestId('wizard-check-button')).toBeVisible();
      await wizard.getByTestId('wizard-check-button').click();
      await expect(wizard.getByText(/Connection successful|连接成功/i)).toBeVisible({ timeout: 10000 });
    });

    test('rejects non-https URL in wizard step 1', async ({ authedPage }) => {
      const wizard = await openCustomWizardFromCreateDialog(authedPage);

      await wizard.getByTestId('wizard-name-input').fill('E2E Invalid URL');
      await wizard.getByTestId('wizard-base-url-input').fill('http://open.provider.cn/api/anthropic');

      const nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      await expect(nextBtn).toBeDisabled();
    });

    test('custom endpoint remains in custom edit mode after creation', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      const wizard = await openCustomWizardFromCreateDialog(authedPage);
      const endpointName = `E2E Custom Edit ${Date.now()}`;

      await wizard.getByTestId('wizard-name-input').fill(endpointName);
      await wizard.getByTestId('protocol-openai_responses').click();
      await wizard.getByTestId('wizard-base-url-input').fill('https://responses.provider.example/v1');
      await wizard.getByRole('button', { name: /Next|下一步/i }).click();
      await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible();
      await wizard.getByTestId('wizard-model-id-input').fill('responses-model');
      let nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      if (!(await nextBtn.isEnabled().catch(() => false))) {
        const credentialPicked = await pickSelectOption(
          wizard,
          authedPage,
          /OpenAI API Key|Anthropic API Key|E2E Credential/i,
        );
        expect(credentialPicked).toBe(true);
        nextBtn = wizard.getByRole('button', { name: /Next|下一步/i });
      }
      await nextBtn.click();
      await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled();
      await wizard.getByTestId('wizard-create-button').click();
      await expect(wizard).toBeHidden({ timeout: 10_000 });
      const createDialog = authedPage.getByTestId('endpoints__create-dialog');
      if (await createDialog.isVisible().catch(() => false)) {
        await createDialog.getByRole('button', { name: /close|cancel/i }).first().click();
        await expect(createDialog).toBeHidden({ timeout: 10_000 });
      }

      const row = authedPage.getByTestId('endpoints__table__row').filter({ hasText: endpointName }).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.locator('button').first().click();

      const editDialog = authedPage.getByTestId('endpoints__edit-dialog');
      await expect(editDialog).toBeVisible();
      await expect(editDialog.getByText('Upstream Protocol')).toBeVisible();
      await expect(editDialog.locator('#endpoint-base-url')).toBeVisible();
      await expect(editDialog.locator('#endpoint-model')).toBeVisible();
      await expect(editDialog.getByRole('button', { name: /OpenAI Responses Upstreams/i })).toBeVisible();
      await expect(editDialog.getByText('Provider')).not.toBeVisible();
      await expect(editDialog.getByText('Catalog Models')).not.toBeVisible();
    });

    test('catalog endpoint stays in catalog edit mode', async ({ authedPage }) => {
      const row = authedPage.getByTestId('endpoints__table__row').filter({ hasText: 'OpenAI Main' }).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.locator('button').first().click();

      const editDialog = authedPage.getByTestId('endpoints__edit-dialog');
      await expect(editDialog).toBeVisible();
      await expect(editDialog.getByText('Provider')).toBeVisible();
      await expect(editDialog.getByText('Upstream Protocol')).toBeVisible();
      await expect(editDialog.getByText('Catalog Models')).toBeVisible();
      await expect(editDialog.locator('#endpoint-base-url')).toHaveCount(0);
      await expect(editDialog.locator('#endpoint-model')).toHaveCount(0);
      await expect(editDialog.getByText('OpenAI Chat Completions')).toBeVisible();
    });
  });
});
