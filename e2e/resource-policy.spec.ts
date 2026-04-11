import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Resource Policy Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'resource-policy');
    if (/\/login(?:\/|$)/.test(new URL(authedPage.url()).pathname)) {
      test.info().skip(true, 'not authenticated in current lane');
      return;
    }
    const blocked = await authedPage.getByTestId('feature-availability__banner').isVisible().catch(() => false);
    if (blocked) {
      test.info().skip(true, 'resource-policy feature blocked in current lane');
      return;
    }
    const hasTable = await authedPage.getByTestId('resource-policy__table').isVisible().catch(() => false);
    if (!hasTable) {
      test.info().skip(true, 'resource-policy table unavailable in current lane');
    }
  });

  test('relies on sidebar navigation instead of govern header actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('resource-policy__open-members')).toHaveCount(0);
    await expect(authedPage.getByTestId('resource-policy__open-credentials')).toHaveCount(0);
    await expect(authedPage.getByTestId('resource-policy__open-audit')).toHaveCount(0);
    await expect(authedPage.getByTestId('sidebar__nav-item--members')).toHaveAttribute('href', /\/members$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--credentials')).toHaveAttribute(
      'href',
      /\/credentials$/,
    );
    await expect(authedPage.getByTestId('sidebar__nav-item--audit')).toHaveAttribute('href', /\/audit$/);
  });

  test('renders resource policy groups', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('resource-policy__group--endpoint')).toBeVisible();
    await expect(authedPage.locator('[data-testid^="resource-policy__row--endpoint--"]').first()).toBeVisible();
  });

  test('blocks save when allow_list has no subject', async ({ authedPage }) => {
    const accessMode = authedPage.getByTestId('resource-policy__access-mode');
    await accessMode.selectOption('allow_list');

    await expect(authedPage.getByTestId('resource-policy__allow-list-required')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__save')).toBeDisabled();
  });

  test('saves endpoint resource and subject policy payload', async ({ authedPage }) => {
    await authedPage.getByTestId('resource-policy__endpoint-spending-usd-per-day').fill('250');

    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption({ index: 1 });
    await authedPage.getByPlaceholder('subject spending limit (USD/day)').fill('70');

    const requestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH' && req.url().includes('/resources/endpoint/ep_1/policy');
    });

    await authedPage.getByTestId('resource-policy__save').click();

    const request = await requestPromise;
    const payload = request.postDataJSON() as {
      access_mode: string;
      allowed_subjects: Array<{
        subject_type: string;
        subject_id: string;
        spending_limits?: { rules: Array<{ key: string; value: number; window?: string }> };
      }>;
      spending_limits?: { rules: Array<{ key: string; value: number; window?: string }> };
    };

    expect(payload.access_mode).toBe('allow_all_members');
    expect(payload.spending_limits?.rules).toEqual([
      { key: 'endpoint.spending_usd_per_day', value: 250, window: 'day' },
    ]);
    expect(payload.allowed_subjects).toHaveLength(1);
    expect(payload.allowed_subjects[0]?.subject_type).toBe('user');
    expect(payload.allowed_subjects[0]?.subject_id).toBeTruthy();
    expect(payload.allowed_subjects[0]?.spending_limits?.rules).toEqual([
      { key: 'endpoint.spending_usd_per_day', value: 70, window: 'day' },
    ]);
  });
});
