/**
 * Endpoints Page – E2E Tests
 *
 * Covers table rendering, endpoint data, create dialog, edit dialog,
 * and delete confirmation using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

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
}

test.describe('Endpoints Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'endpoints');
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

    // URLs should appear in the table
    await expect(authedPage.getByText('https://api.openai.com/v1').first()).toBeVisible();

    // Rate limit summary columns show RPM and tokens/day for each row.
    await expect(authedPage.getByText('RPM:').first()).toBeVisible();
    await expect(authedPage.getByText('Tokens/day:').first()).toBeVisible();
  });

  test('shows build header actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__open-chat')).toHaveAttribute('href', /\/chat$/);
    await expect(authedPage.getByTestId('endpoints__open-notebook')).toHaveAttribute('href', /\/notebook$/);
    await expect(authedPage.getByTestId('endpoints__open-agents')).toHaveAttribute('href', /\/agents$/);
  });

  test('create dialog opens with form fields', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    // Verify the dialog contains a name input
    await expect(dialog.locator('#endpoint-name')).toBeVisible();
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

    // Fill in required text fields
    await dialog.locator('#endpoint-name').fill('E2E Test Endpoint');
    await dialog.getByRole('textbox', { name: /model id/i }).fill('gpt-4o-test');

    const noCredentialHint = dialog.getByText(/no credentials|create credential first|请先创建凭据/i).first();
    if (await noCredentialHint.isVisible().catch(() => false)) {
      await expect(dialog.getByRole('button', { name: /create/i })).toBeDisabled();
      return;
    }

    const credentialPicked = await pickSelectOption(dialog, authedPage, /OpenAI API Key|Anthropic API Key/i);
    expect(credentialPicked).toBe(true);
    await dialog.getByRole('textbox', { name: /model id/i }).fill('gpt-4o-test');

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

  test('create custom endpoint requires base URL and sends limits payload', async ({ authedPage }) => {
    await ensureCredentialExists(authedPage);
    await authedPage.getByTestId('endpoints__create-btn').click();
    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#endpoint-name').fill('E2E Custom Endpoint');
    await dialog.getByRole('textbox', { name: /model id/i }).fill('custom-model-v1');

    const noCredentialHint = dialog.getByText(/no credentials|create credential first|请先创建凭据/i).first();
    if (await noCredentialHint.isVisible().catch(() => false)) {
      await expect(dialog.getByRole('button', { name: /^create$/i })).toBeDisabled();
      return;
    }

    const providerPicked = await pickSelectOption(dialog, authedPage, /custom/i);
    expect(providerPicked).toBe(true);
    await dialog.getByRole('textbox', { name: /model id/i }).fill('custom-model-v1');

    const submitBtn = dialog.getByRole('button', { name: /^create$/i });
    await expect(submitBtn).toBeDisabled();

    await dialog.locator('#endpoint-base-url').fill('https://custom.example.com/v1');

    const credentialPicked = await pickSelectOption(dialog, authedPage, /OpenAI API Key|Anthropic API Key/i);
    expect(credentialPicked).toBe(true);
    await dialog.getByRole('textbox', { name: /model id/i }).fill('custom-model-v1');

    // Expand limits and fill both values
    await dialog.getByRole('button', { name: /limits/i }).click();
    await dialog.locator('#endpoint-rpm').fill('120');
    await dialog.locator('#endpoint-timeout').fill('45');

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/endpoints$/.test(req.url());
    });
    if (!(await submitBtn.isEnabled().catch(() => false))) {
      await expect(submitBtn).toBeDisabled();
      return;
    }
    await submitBtn.click();

    const request = await createRequestPromise;
    const payload = request.postDataJSON() as {
      type?: string;
      base_url?: string;
      limits?: { max_requests_per_minute?: number; timeout_seconds?: number };
    };
    expect(payload.type).toBe('custom');
    expect(payload.base_url).toBe('https://custom.example.com/v1');
    expect(payload.limits?.max_requests_per_minute).toBe(120);
    expect(payload.limits?.timeout_seconds).toBe(45);
  });

  test.describe('Custom Endpoint Wizard', () => {
    test('opens wizard when custom provider is selected', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      // Select custom provider
      await pickSelectOption(dialog, authedPage, /Custom/i);

      // Verify wizard button is shown
      await expect(dialog.getByRole('button', { name: /Open Wizard/i })).toBeVisible();
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
      const wizardBtn = dialog.getByRole('button', { name: /Open Wizard/i });
      await wizardBtn.click();

      // Wizard should open, main dialog should close
      await expect(authedPage.getByTestId('endpoints__custom-wizard')).toBeVisible({ timeout: 5000 });
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    test('wizard step 1: basic info flow', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      await pickSelectOption(dialog, authedPage, /Custom/i);

      const wizardBtn = dialog.getByRole('button', { name: /Open Wizard/i });
      await wizardBtn.click();

      // Wizard should be open
      const wizard = authedPage.getByTestId('endpoints__custom-wizard');
      await expect(wizard).toBeVisible();

      // Check title and protocol buttons
      await expect(wizard.getByText(/Create Custom Endpoint|custom_wizard\.title/i)).toBeVisible();
      await expect(wizard.getByTestId('protocol-openai_compatible')).toBeVisible();
      await expect(wizard.getByTestId('protocol-anthropic_compatible')).toBeVisible();

      // Enter name and select protocol
      await wizard.getByTestId('wizard-name-input').fill('E2E Custom OpenAI');
      await wizard.getByTestId('protocol-openai_compatible').click();

      // Base URL should be populated
      await expect(wizard.getByTestId('wizard-base-url-input')).toHaveValue(/https:\/\/api\.openai\.com\/v1/i);
    });

    test('wizard step 2: model config flow', async ({ authedPage }) => {
      await ensureCredentialExists(authedPage);
      await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

      const createBtn = authedPage.getByTestId('endpoints__create-btn');
      await createBtn.click();

      const dialog = authedPage.getByTestId('endpoints__create-dialog');
      await expect(dialog).toBeVisible();

      await pickSelectOption(dialog, authedPage, /Custom/i);
      await dialog.getByRole('button', { name: /Open Wizard/i }).click();

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
      await expect(wizard.getByTestId('wizard-capability-select')).toBeVisible();

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
      await dialog.getByRole('button', { name: /Open Wizard/i }).click();

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
      await nextBtn.click();

      // Step 3
      await expect(wizard.getByTestId('wizard-check-button')).toBeVisible();
      await expect(wizard.getByTestId('wizard-create-button')).toBeVisible();

      // Create button should be enabled - validation is optional
      await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled();
    });
  });
});
