import { test, expect, goTo, goToProject, WS_ID, LOCALE } from './fixtures/test-base';
import type { Page } from '@playwright/test';

const projectsPath = `/${LOCALE}/workspaces/${WS_ID}/projects`;

async function seedGuestNotifications(page: Page, notifications: Array<{
  id: string;
  type: string;
  title: string;
  body: string;
  link_url: string;
}>) {
  return page.evaluate(async ({ notifications }) => {
    const response = await fetch('/api/test/me/notifications/seed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'user_009',
        notifications,
      }),
    });
    return response.ok;
  }, { notifications });
}

test.describe('Projects Join Governance', () => {
  test('guest sees only public projects and can submit a join request from project entry', async ({ guestPage }) => {
    await goTo(guestPage, projectsPath);
    await expect(guestPage.getByTestId('projects__page')).toBeVisible({ timeout: 30000 });

    await expect(guestPage.getByText('AI Assistant Project')).toBeVisible();
    await expect(guestPage.getByText('Customer Support Bot')).toBeVisible();
    await expect(guestPage.getByText('Research Project')).not.toBeVisible();

    await guestPage.getByRole('button', { name: 'AI Assistant Project' }).click();
    await expect(guestPage.getByTestId('projects__join-request-dialog')).toBeVisible();
    await guestPage.getByTestId('projects__join-request-confirm').click();

    await expect(guestPage.getByTestId('projects__join-request-dialog')).toBeHidden({ timeout: 10000 });
    await expect(guestPage.getByTestId('projects__join-request-btn--proj_001')).toContainText('Request Pending');
    await expect(guestPage).toHaveURL(new RegExp(`${projectsPath}$`));
  });

  test('guest can directly join public open project from project entry', async ({ guestPage }) => {
    await goTo(guestPage, projectsPath);
    await expect(guestPage.getByTestId('projects__page')).toBeVisible({ timeout: 30000 });

    await guestPage.getByRole('button', { name: 'Customer Support Bot' }).click();
    await expect(guestPage.getByTestId('projects__join-now-dialog')).toBeVisible();
    await guestPage.getByTestId('projects__join-now-confirm').click();

    await guestPage.waitForURL(/\/projects\/proj_003\/overview$/, { timeout: 15000 });
    await expect(guestPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
  });

  test('manager can approve a pending join request from members governance', async ({ authedPage }) => {
    await goToProject(authedPage, 'members');
    await authedPage.getByRole('tab', { name: 'Join Requests' }).click();

    const requestCard = authedPage
      .locator('[data-testid^="members__join-request-card--"]')
      .filter({ hasText: 'frank@example.com' })
      .first();
    await expect(requestCard).toBeVisible();
    await requestCard.locator('[data-testid^="members__join-request-approve--"]').click();
    await expect(requestCard.getByText('Approved', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(requestCard.getByText(/Approved as a project member/i)).toBeVisible();
  });

  test('manager can reject a pending join request with a reason', async ({ authedPage }) => {
    await goToProject(authedPage, 'members');
    await authedPage.getByRole('tab', { name: 'Join Requests' }).click();

    const requestCard = authedPage
      .locator('[data-testid^="members__join-request-card--"]')
      .filter({ hasText: 'grace@example.com' })
      .first();
    await expect(requestCard).toBeVisible();
    await requestCard.locator('[data-testid^="members__join-request-reject--"]').click();
    await expect(authedPage.getByTestId('members__join-request-reject-dialog')).toBeVisible();
    await authedPage.getByPlaceholder('e.g. Not in scope for this project').fill('Not in scope for this project');
    await authedPage.getByRole('button', { name: 'Confirm Reject' }).click();
    await expect(requestCard.getByText('Rejected')).toBeVisible({ timeout: 10000 });
    await expect(requestCard.getByText('Not in scope for this project')).toBeVisible();
  });

  test('guest notification center shows join request outcome notifications', async ({ guestPage }) => {
    await goTo(guestPage, projectsPath);
    await expect(guestPage.getByTestId('projects__page')).toBeVisible({ timeout: 30000 });

    const seeded = await seedGuestNotifications(guestPage, [
      {
        id: 'notif_join_approved_guest',
        type: 'join_request_approved',
        title: 'Project access approved',
        body: 'Your request to join AI Assistant Project was approved.',
        link_url: '/workspaces/ws_default/projects/proj_001/overview',
      },
      {
        id: 'notif_join_rejected_guest',
        type: 'join_request_rejected',
        title: 'Project access request declined',
        body: 'Your request to join AI Assistant Project was declined: Not in scope for this project',
        link_url: '/workspaces/ws_default/projects',
      },
    ]);
    expect(seeded).toBe(true);

    await guestPage.getByTestId('topbar__notifications').click();
    await expect(guestPage.getByTestId('topbar__notifications-dropdown')).toBeVisible();
    await expect(guestPage.getByText('Project access approved')).toBeVisible();
    await expect(guestPage.getByText('Project access request declined')).toBeVisible();
    await expect(guestPage.getByText(/Not in scope for this project/)).toBeVisible();
  });
});
