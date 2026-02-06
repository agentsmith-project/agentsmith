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

  test('table renders with member rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('members__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="members__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
  });

  test('displays member names and emails from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    // Member names from memberFixtures (proj_001): Alice Chen, Bob Smith, Charlie Wilson
    await expect(authedPage.getByText('Alice Chen')).toBeVisible();
    await expect(authedPage.getByText('Bob Smith')).toBeVisible();
    await expect(authedPage.getByText('alice@example.com')).toBeVisible();
  });

  test('invite dialog opens with email field', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    const inviteBtn = authedPage.getByTestId('members__invite-btn');
    await expect(inviteBtn).toBeVisible();
    await inviteBtn.click();

    const dialog = authedPage.getByTestId('members__invite-dialog');
    await expect(dialog).toBeVisible();

    // Verify the dialog has email input and role selector
    await expect(dialog.locator('#invite-email')).toBeVisible();
    await expect(dialog.locator('#invite-role')).toBeVisible();
  });

  test('member detail drawer opens with tabs', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    // Open the row action dropdown on a non-owner member and click "Edit Permissions & Quota"
    const rows = authedPage.getByTestId('members__table__row');
    await expect(rows.first()).toBeVisible();
    // Click the action menu on the second row (Bob Smith – admin, not owner)
    const actionBtn = rows.nth(1).getByRole('button', { name: /more/i }).or(
      rows.nth(1).locator('button:has(svg)')
    ).last();
    await actionBtn.click();

    // Click "Edit Permissions & Quota" from the dropdown
    const editPermsItem = authedPage.getByRole('menuitem', { name: /edit permissions/i });
    await editPermsItem.click();

    // The MemberDetailDrawer (Sheet) should open with tabs: Permissions, Quota, ACL
    // Use the drawer/sheet container to scope our search (avoids strict mode with multiple tablists)
    const drawer = authedPage.locator('[role="dialog"], [data-state="open"]').last();
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByRole('tab', { name: /permissions/i })).toBeVisible();
    await expect(drawer.getByRole('tab', { name: /quota/i })).toBeVisible();
    await expect(drawer.getByRole('tab', { name: /resource access|acl/i })).toBeVisible();
  });

  test('role badges are displayed for each member', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('members__table')).toBeVisible({ timeout: 10000 });

    // Roles from p0.json: owner, admin, member (displayed capitalized in UI)
    await expect(authedPage.getByText(/owner/i).first()).toBeVisible();
    await expect(authedPage.getByText(/admin/i).first()).toBeVisible();
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
});
