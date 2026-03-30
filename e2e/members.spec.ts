/**
 * Members Page – E2E Tests
 *
 * Covers table rendering, member data, invite dialog, member detail drawer,
 * and role badges using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Members Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'members');
  });

  test('does not render execution error state on initial load', async ({ authedPage }) => {
    const pageErrors: string[] = [];
    authedPage.on('pageerror', (error) => pageErrors.push(error.message));
    await authedPage.reload({ waitUntil: 'domcontentloaded' });

    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByText(/something went wrong/i)).not.toBeVisible();

    const dialogTitleContextError = pageErrors.find((message) =>
      message.includes('`DialogTitle` must be used within `Dialog`')
    );
    expect(dialogTitleContextError).toBeUndefined();
  });

  test('table renders with member rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('members__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="members__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
  });

  test('uses single top-level tab navigation', async ({ authedPage }) => {
    const tablists = authedPage.locator('[role="tablist"]');
    await expect(tablists).toHaveCount(1);

    await expect(authedPage.getByRole('tab', { name: 'People' })).toBeVisible();
    await expect(authedPage.getByRole('tab', { name: 'Join Requests' })).toBeVisible();
    await expect(authedPage.getByRole('tab', { name: 'Templates' })).toBeVisible();
    await expect(authedPage.getByRole('tab', { name: 'Groups' })).toBeVisible();
  });

  test('switches top-level tabs without rendering nested members tab bar', async ({ authedPage }) => {
    await authedPage.getByRole('tab', { name: 'Join Requests' }).click();
    await expect(authedPage.getByText(/pending requests|reviewed requests/i).first()).toBeVisible();

    // Ensure old nested tabs ("Members"/"Join Requests") are not rendered as a second tablist.
    const tablists = authedPage.locator('[role="tablist"]');
    await expect(tablists).toHaveCount(1);
  });

  test('displays member names and emails from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    // Member names from memberFixtures (proj_001): Alice Chen, Bob Smith, Charlie Wilson
    await expect(authedPage.getByText('Alice Chen')).toBeVisible();
    await expect(authedPage.getByText('Bob Smith')).toBeVisible();
    await expect(authedPage.getByText('alice@example.com')).toBeVisible();
  });

  test('shows govern header actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__open-credentials')).toHaveAttribute('href', /\/credentials$/);
    await expect(authedPage.getByTestId('members__open-resource-policy')).toHaveAttribute('href', /\/resource-policy$/);
    await expect(authedPage.getByTestId('members__open-audit')).toHaveAttribute('href', /\/audit$/);
  });

  test('invite dialog opens with email field', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    const inviteBtn = authedPage.getByTestId('members__invite-btn');
    await expect(inviteBtn).toBeVisible();
    await inviteBtn.click();

    const dialog = authedPage.getByTestId('members__invite-dialog');
    await expect(dialog).toBeVisible();

    // Verify the dialog has email input
    await expect(dialog.locator('#invite-email')).toBeVisible();
  });

  test('member detail drawer opens with tabs', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    // Open the row action dropdown on a non-owner member and click "Edit Permissions & Limit"
    const rows = authedPage.getByTestId('members__table__row');
    await expect(rows.first()).toBeVisible();
    // Click the action menu on the second row (Bob Smith – admin, not owner)
    const actionBtn = rows.nth(1).getByRole('button', { name: /more/i }).or(
      rows.nth(1).locator('button:has(svg)')
    ).last();
    await actionBtn.click();

    // Click "Edit Permissions & Limit" from the dropdown
    const editPermsItem = authedPage.getByRole('menuitem', { name: /edit permissions/i });
    await editPermsItem.click();

    // Detail editor may render as embedded side panel on wide viewport.
    await expect(authedPage.getByRole('tab', { name: /permissions/i }).last()).toBeVisible({ timeout: 5000 });
    await expect(authedPage.getByRole('tab', { name: /limit/i }).last()).toBeVisible();
  });

  test('permission template defaults to member existing permissions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    const rows = authedPage.getByTestId('members__table__row');
    await expect(rows.nth(1)).toBeVisible();

    // Open "Edit Permissions & Limit" for Bob Smith (admin in mock fixture)
    const actionBtn = rows.nth(1).getByRole('button', { name: /more/i }).or(
      rows.nth(1).locator('button:has(svg)')
    ).last();
    await actionBtn.click();
    await authedPage.getByRole('menuitem', { name: /edit permissions/i }).click();

    const permissionsTab = authedPage.getByRole('tab', { name: /permissions/i }).last();
    await expect(permissionsTab).toBeVisible({ timeout: 5000 });
    await permissionsTab.click();

    const templateSelect = authedPage.getByRole('combobox').last();
    await expect(templateSelect).toBeVisible();
    await expect(templateSelect).toContainText(/select template|owner|admin|governance|manager/i);
  });

  test('access group badges are displayed for each member', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    const table = authedPage.getByTestId('members__table');
    await expect(table.getByText(/governance/i).first()).toBeVisible();
    await expect(table.getByText(/manager/i).first()).toBeVisible();
  });

  test('invite member via dialog submission', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    const inviteBtn = authedPage.getByTestId('members__invite-btn');
    await inviteBtn.click();

    const dialog = authedPage.getByTestId('members__invite-dialog');
    await expect(dialog).toBeVisible();

    // Fill in the email
    await dialog.locator('#invite-email').fill('newmember@example.com');

    // Submit the invite
    const submitBtn = dialog.getByRole('button', { name: /create invite|invite/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // After successful creation, the dialog should show the invite link with a Copy button
    await expect(dialog.getByRole('button', { name: /copy link|done/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('invite dialog requires email before submit', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    const inviteBtn = authedPage.getByTestId('members__invite-btn');
    await inviteBtn.click();

    const dialog = authedPage.getByTestId('members__invite-dialog');
    await expect(dialog).toBeVisible();

    // Submit button should be disabled when email is empty
    const submitBtn = dialog.getByRole('button', { name: /create invite|invite/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('invite member failure keeps dialog in form mode', async ({ authedPage }) => {
    await authedPage.route('**/api/v1/workspaces/*/projects/*/invites', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'invite failed (e2e)' }),
      });
    });

    await authedPage.getByTestId('members__invite-btn').click();
    const dialog = authedPage.getByTestId('members__invite-dialog');
    await expect(dialog).toBeVisible();

    const emailInput = dialog.locator('#invite-email');
    const submitBtn = dialog.getByRole('button', { name: /create invite|invite/i });
    await emailInput.fill('invite-failure@example.com');

    await submitBtn.click();
    await expect(dialog).toBeVisible();
    await expect(emailInput).toBeVisible();
    await expect(dialog.getByRole('button', { name: /copy link|done/i })).not.toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  test('project groups flow: create preview apply and delete', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    await authedPage.getByRole('tab', { name: /groups/i }).first().click();

    const groupName = `e2e-group-${Date.now()}`;
    await authedPage.getByTestId('members__group-name-input').fill(groupName);
    const templateSelect = authedPage.getByTestId('members__group-template-select');
    await templateSelect.selectOption({ index: 1 });
    await authedPage.locator('[data-testid^="members__group-member-checkbox--"]').first().click();
    await authedPage.getByTestId('members__group-save-btn').click();

    await expect(authedPage.getByText(groupName)).toBeVisible();

    // Preview changes for the newest group row
    await authedPage.locator('[data-testid^="members__group-preview-btn--"]').last().click();
    await expect(authedPage.getByText(/permission changes preview/i)).toBeVisible();

    // Apply template and wait for result summary
    const applyBtn = authedPage.locator('[data-testid^="members__group-apply-btn--"]').last();
    const applyResult = authedPage.locator('[data-testid^="members__group-apply-result--"]').last();
    await applyBtn.click();
    await expect(applyResult).toBeVisible({ timeout: 10000 });

    // Delete with confirmation
    await authedPage.locator('[data-testid^="members__group-delete-btn--"]').last().click();
    await authedPage.getByTestId('members__group-delete-confirm-btn').click();
    await expect(authedPage.getByText(groupName)).not.toBeVisible({ timeout: 10000 });
  });

  test('access/status filter options are explicit and status does not include banned', async ({ authedPage }) => {
    const accessFilter = authedPage.getByTestId('members__role-filter');
    const statusFilter = authedPage.getByTestId('members__status-filter');

    await expect(accessFilter).toBeVisible();
    await expect(statusFilter).toBeVisible();

    await accessFilter.selectOption('governance');
    await expect(authedPage.getByTestId('members__filtered-count')).toBeVisible();
    await accessFilter.selectOption('resource_manage');
    await accessFilter.selectOption('access_only');
    await accessFilter.selectOption('all');

    await statusFilter.selectOption('active');
    await expect(authedPage.getByTestId('members__filtered-count')).toBeVisible();
    await statusFilter.selectOption('removed');
    await statusFilter.selectOption('all');

    const statusOptionValues = await statusFilter.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
    expect(statusOptionValues).not.toContain('banned');
  });

  test('search and access filters refine result set', async ({ authedPage }) => {
    const searchInput = authedPage.getByTestId('members__search-input');
    const accessFilter = authedPage.getByTestId('members__role-filter');

    await searchInput.fill('alice');
    await expect(authedPage.getByText('Alice Chen')).toBeVisible();
    await expect(authedPage.getByText('Bob Smith')).not.toBeVisible();

    await searchInput.clear();
    await accessFilter.selectOption('access_only');
    await expect(authedPage.getByText('Charlie Wilson')).toBeVisible();
    await expect(authedPage.getByTestId('members__filtered-count')).toContainText(/member/);

    await accessFilter.selectOption('all');
    await expect(authedPage.getByText('Bob Smith')).toBeVisible();
  });

  test('join request approve action sends approve request', async ({ authedPage }) => {
    await authedPage.getByRole('tab', { name: /join requests/i }).click();

    const approveBtn = authedPage.getByRole('button', { name: /^approve$/i }).first();
    if (!(await approveBtn.isVisible().catch(() => false))) {
      await expect(authedPage.getByText(/pending requests/i)).toBeVisible();
      return;
    }

    const approveRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/join-requests\/.*\/approve$/.test(req.url());
    });
    await approveBtn.click();
    await approveRequestPromise;
  });

  test('join request reject requires reason and sends payload', async ({ authedPage }) => {
    await authedPage.getByRole('tab', { name: /join requests/i }).click();

    const rejectBtn = authedPage.getByRole('button', { name: /reject/i }).first();
    if (!(await rejectBtn.isVisible().catch(() => false))) {
      await expect(authedPage.getByText(/pending requests/i)).toBeVisible();
      return;
    }
    await rejectBtn.click();

    const rejectDialog = authedPage.getByRole('dialog');
    await expect(rejectDialog).toBeVisible();
    const confirmRejectBtn = rejectDialog.getByRole('button', { name: /confirm reject/i });
    await expect(confirmRejectBtn).toBeDisabled();

    await rejectDialog.getByRole('textbox').fill('Not enough project context');
    await expect(confirmRejectBtn).toBeEnabled();

    const rejectRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/join-requests\/.*\/reject$/.test(req.url());
    });
    await confirmRejectBtn.click();
    const request = await rejectRequestPromise;
    const payload = request.postDataJSON() as { reason?: string };
    expect(payload.reason).toBe('Not enough project context');
  });

  test('permission template apply dialog applies to selected members', async ({ authedPage }) => {
    await authedPage.getByRole('tab', { name: /templates/i }).click();
    await expect(authedPage.getByText(/permission templates/i).first()).toBeVisible();

    await authedPage.getByRole('button', { name: /view details/i }).first().click();
    const detailDialog = authedPage.getByRole('dialog');
    await expect(detailDialog).toBeVisible();

    const applyToMemberBtn = detailDialog.getByRole('button', { name: /apply to member/i });
    await expect(applyToMemberBtn).toBeVisible();
    await applyToMemberBtn.click();

    const applyDialog = authedPage.getByRole('dialog').filter({ hasText: /select members/i }).last();
    await expect(applyDialog).toBeVisible();

    const memberCheckbox = applyDialog.getByRole('checkbox').first();
    await memberCheckbox.click();

    const applyRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/members\/.*\/permissions$/.test(req.url());
    });

    await applyDialog.getByRole('button', { name: /apply to members/i }).click();
    await applyRequestPromise;
  });

  test('permission template apply keeps dialog open when all selected members fail', async ({ authedPage }) => {
    await authedPage.route('**/api/v1/workspaces/*/projects/*/members/*/permissions', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'template apply failed (e2e)' }),
      });
    });

    await authedPage.getByRole('tab', { name: /templates/i }).click();
    await authedPage.getByRole('button', { name: /view details/i }).first().click();
    const detailDialog = authedPage.getByRole('dialog');
    await detailDialog.getByRole('button', { name: /apply to member/i }).click();

    const applyDialog = authedPage.getByRole('dialog').filter({ hasText: /select members/i }).last();
    await expect(applyDialog).toBeVisible();

    const memberCheckboxes = applyDialog.getByRole('checkbox');
    const checkboxCount = await memberCheckboxes.count();
    expect(checkboxCount).toBeGreaterThanOrEqual(2);
    await memberCheckboxes.nth(0).click();
    await memberCheckboxes.nth(1).click();
    const applyBtn = applyDialog.getByRole('button', { name: /apply to members/i });
    await applyBtn.click();

    await expect(applyDialog).toBeVisible();
    await expect(applyBtn).toBeEnabled();
  });
});
