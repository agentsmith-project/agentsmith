import { test, expect, goTo, projectUrl } from './fixtures/test-base';

test.describe('Governance Mainline', () => {
  test('lets project owners approve and grant project administration, then verify the result in settings', async ({ authedPage }) => {
    await goTo(authedPage, `${projectUrl('members')}?member_tab=requests`);

    const approveAndGrant = authedPage.getByRole('button', { name: /approve and grant project admin/i }).first();
    await expect(approveAndGrant).toBeVisible({ timeout: 10_000 });
    await approveAndGrant.click();
    await expect(authedPage.getByText(/join request approved and project administration granted/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      authedPage.getByText(/approved with project administration access/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    const projectAdminIds = await authedPage.evaluate(async () => {
      const response = await fetch('/api/v1/workspaces/ws_default/projects/proj_001');
      const payload = await response.json();
      return Array.isArray(payload?.governance_json?.project_admins)
        ? payload.governance_json.project_admins
        : [];
    });
    expect(projectAdminIds).toContain('user_006');

    await authedPage.getByRole('link', { name: 'Settings' }).click();
    await expect(authedPage).toHaveURL(new RegExp(`${projectUrl('settings').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
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
    await authorizeResourceId.fill('endpoint_001');
    await authorizeRun.click();
    await expect(authorizeResult).toContainText(/Allowed/i);

    await expect(openResourcePolicy).toBeVisible();
    const resourcePolicyHref = await openResourcePolicy.getAttribute('href');
    expect(resourcePolicyHref).toBeTruthy();
    await authedPage.goto(new URL(resourcePolicyHref!, authedPage.url()).toString(), { waitUntil: 'domcontentloaded' });
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
    await authedPage.goto(new URL(memberAccessHref!, authedPage.url()).toString(), { waitUntil: 'domcontentloaded' });
    await expect(authedPage).toHaveURL(/\/members\?/);
    const memberReturnSurface = await authedPage.getByRole('dialog').isVisible().catch(() => false)
      ? authedPage.getByRole('dialog')
      : authedPage;
    await expect(memberReturnSurface.getByTestId('member-detail__authorization-check').first()).toBeVisible({ timeout: 10_000 });
    await expect(memberReturnSurface.getByTestId('member-detail__authorize-resource-id').first()).toHaveValue('ep_1');
  });
});
