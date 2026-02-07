/**
 * Endpoints Page – E2E Tests
 *
 * Covers table rendering, endpoint data, create dialog, edit dialog,
 * and delete confirmation using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

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
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    // Fill in required text fields
    await dialog.locator('#endpoint-name').fill('E2E Test Endpoint');
    await dialog.locator('#endpoint-model').fill('gpt-4o-test');

    // Select a credential using the Radix Select component
    // The credential select is the last Select trigger in the dialog (after Provider)
    const selectTriggers = dialog.locator('[role="combobox"]');
    const credentialTrigger = selectTriggers.last();

    if (await credentialTrigger.isVisible().catch(() => false)) {
      await credentialTrigger.click();
      await authedPage.waitForTimeout(300);

      // Select the first available credential option
      const option = authedPage.locator('[role="option"]').first();
      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.click();
        await authedPage.waitForTimeout(300);

        // Submit the form
        const submitBtn = dialog.getByRole('button', { name: /create/i });
        await expect(submitBtn).toBeEnabled({ timeout: 5000 });
        await submitBtn.click();

        // Dialog should close after successful creation
        await expect(dialog).toBeHidden({ timeout: 10000 });
      }
    }
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
    await authedPage.getByTestId('endpoints__create-btn').click();
    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#endpoint-name').fill('E2E Custom Endpoint');
    await dialog.locator('#endpoint-model').fill('custom-model-v1');

    const selects = dialog.locator('[role="combobox"]');
    const providerSelect = selects.first();
    await providerSelect.click();
    await authedPage.getByRole('option', { name: /custom/i }).click();

    const submitBtn = dialog.getByRole('button', { name: /^create$/i });
    await expect(submitBtn).toBeDisabled();

    await dialog.locator('#endpoint-base-url').fill('https://custom.example.com/v1');

    // Select first credential option
    const credentialSelect = dialog.locator('[role="combobox"]').last();
    await credentialSelect.click();
    await authedPage.locator('[role="option"]').first().click();

    // Expand limits and fill both values
    await dialog.getByRole('button', { name: /limits/i }).click();
    await dialog.locator('#endpoint-rpm').fill('120');
    await dialog.locator('#endpoint-timeout').fill('45');

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/endpoints$/.test(req.url());
    });
    await expect(submitBtn).toBeEnabled();
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
});
