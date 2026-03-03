import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Resource Policy Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'resource-policy');
    await expect(authedPage.getByTestId('resource-policy__table')).toBeVisible({ timeout: 10000 });
  });

  test('shows govern header actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('resource-policy__open-members')).toHaveAttribute('href', /\/members$/);
    await expect(authedPage.getByTestId('resource-policy__open-credentials')).toHaveAttribute('href', /\/credentials$/);
    await expect(authedPage.getByTestId('resource-policy__open-audit')).toHaveAttribute('href', /\/audit$/);
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
    await authedPage.getByTestId('resource-policy__endpoint-daily-token-limit').fill('250000');

    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption({ index: 1 });
    await authedPage.getByPlaceholder('subject daily token limit').fill('70000');

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
        quota_limits?: { rules: Array<{ key: string; value: number; window?: string }> };
      }>;
      quota_limits?: { rules: Array<{ key: string; value: number; window?: string }> };
    };

    expect(payload.access_mode).toBe('allow_all_members');
    expect(payload.quota_limits?.rules).toEqual([
      { key: 'endpoint.daily_token_limit', value: 250000, window: 'day' },
    ]);
    expect(payload.allowed_subjects).toHaveLength(1);
    expect(payload.allowed_subjects[0]?.subject_type).toBe('user');
    expect(payload.allowed_subjects[0]?.subject_id).toBeTruthy();
    expect(payload.allowed_subjects[0]?.quota_limits?.rules).toEqual([
      { key: 'endpoint.daily_token_limit', value: 70000, window: 'day' },
    ]);
  });
});
