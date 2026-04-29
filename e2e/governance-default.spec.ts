import { test, expect, goTo, projectUrl } from './fixtures/test-base';
import { clickProjectSidebarNav, waitForPageReady } from './utils/navigation';

const ACTIVE_ENDPOINT_ID = 'ep_1';

test.describe('Governance Mainline', () => {
  test('lets project owners approve and grant project administration, then verify the result in settings', async ({ authedPage }) => {
    await goTo(authedPage, `${projectUrl('members')}?member_tab=requests`);

    const approveAndGrant = authedPage.getByRole('button', { name: /approve and grant project admin/i }).first();
    await expect(approveAndGrant).toBeVisible({ timeout: 10_000 });
    await approveAndGrant.click();
    await expect(
      authedPage.getByText(/approved with project administration access/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await clickProjectSidebarNav(authedPage, {
      item: 'settings',
      expectedPath: projectUrl('settings'),
      readyTestId: 'settings__general-section',
    });
    const projectAdminOption = authedPage.getByTestId('settings__project-admin-option--user_006');
    await expect(projectAdminOption).toBeVisible({ timeout: 10_000 });
    await expect(projectAdminOption.getByRole('checkbox')).toBeChecked();
  });

  test('lets admins explain member access and validate resource policy decisions', async ({ authedPage }) => {
    await goTo(authedPage, `${projectUrl('members')}?member_tab=people`);

    await authedPage.getByRole('row', { name: /Charlie Wilson/i }).click();
    const memberSurface = await authedPage.getByRole('dialog').isVisible().catch(() => false)
      ? authedPage.getByRole('dialog')
      : authedPage;
    const authorizationCheck = memberSurface.getByTestId('member-detail__authorization-check').first();
    const authorizeResourceId = memberSurface.getByTestId('member-detail__authorize-resource-id').first();
    const authorizeRun = memberSurface.getByTestId('member-detail__authorize-run').first();
    const authorizeResult = memberSurface.getByTestId('member-detail__authorize-result').first();
    const openResourcePolicy = memberSurface.getByTestId('member-detail__open-resource-policy').first();

    await expect(authorizationCheck).toBeVisible({ timeout: 10_000 });
    await authorizeResourceId.fill(ACTIVE_ENDPOINT_ID);
    await authorizeRun.click();
    await expect(authorizeResult).toContainText(/Allowed/i);

    await expect(openResourcePolicy).toBeVisible();
    await expect(openResourcePolicy).toHaveAttribute('href', new RegExp(`resource_id=${ACTIVE_ENDPOINT_ID}`));
    await Promise.all([
      authedPage.waitForURL(/\/resource-policy\?/, { timeout: 20_000 }),
      openResourcePolicy.click(),
    ]);
    await waitForPageReady(authedPage);
    await expect(authedPage).toHaveURL(/\/resource-policy\?/);
    const resourcePolicyEditor = authedPage.getByTestId('resource-policy__editor').first();
    await expect(resourcePolicyEditor).toBeVisible({ timeout: 10_000 });
    const explainSubjectType = resourcePolicyEditor.getByTestId('resource-policy__explain-subject-type');
    const explainSubjectId = resourcePolicyEditor.getByTestId('resource-policy__explain-subject-id');
    const explainAction = resourcePolicyEditor.getByTestId('resource-policy__explain-action');
    const explainRun = resourcePolicyEditor.getByTestId('resource-policy__explain-run');
    const explainResult = resourcePolicyEditor.getByTestId('resource-policy__explain-result');
    const openMemberAccess = resourcePolicyEditor.getByTestId('resource-policy__open-member-access');

    await explainSubjectType.selectOption('user');
    await explainSubjectId.selectOption({ label: 'Charlie Wilson (charlie@example.com)' });
    await explainAction.fill('invoke');
    await explainRun.click();

    await expect(explainResult).toContainText(/Allowed/i);
    await expect(explainResult).toContainText(/Project Default|Current resource allows all project members/i);

    const memberAccessHref = await openMemberAccess.getAttribute('href');
    expect(memberAccessHref).toBeTruthy();
    await expect(openMemberAccess).toHaveAttribute('href', new RegExp(`authorize_resource_id=${ACTIVE_ENDPOINT_ID}`));
    await Promise.all([
      authedPage.waitForURL(/\/members\?/, { timeout: 20_000 }),
      openMemberAccess.click(),
    ]);
    await waitForPageReady(authedPage);
    await expect(authedPage).toHaveURL(/\/members\?/);
    const memberReturnSurface = await authedPage.getByRole('dialog').isVisible().catch(() => false)
      ? authedPage.getByRole('dialog')
      : authedPage;
    await expect(memberReturnSurface.getByTestId('member-detail__authorization-check').first()).toBeVisible({ timeout: 10_000 });
    await expect(memberReturnSurface.getByTestId('member-detail__authorize-resource-id').first()).toHaveValue(ACTIVE_ENDPOINT_ID);
  });
});
