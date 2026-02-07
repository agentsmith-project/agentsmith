import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Resource Policy Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'resource-policy');
    await expect(authedPage.getByTestId('resource-policy__table')).toBeVisible({ timeout: 10000 });
  });

  test('blocks save when allow_list has no subject', async ({ authedPage }) => {
    const accessMode = authedPage.getByTestId('resource-policy__access-mode');
    await accessMode.selectOption('allow_list');

    await expect(authedPage.getByTestId('resource-policy__allow-list-required')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__save')).toBeDisabled();
  });

  test('renders resource groups and rows for all resource types', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('resource-policy__group--endpoint')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__group--agent')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__group--source_library')).toBeVisible();

    await expect(authedPage.locator('[data-testid^="resource-policy__row--endpoint--"]').first()).toBeVisible();
    await expect(authedPage.locator('[data-testid^="resource-policy__row--agent--"]').first()).toBeVisible();
    await expect(authedPage.locator('[data-testid^="resource-policy__row--source_library--"]').first()).toBeVisible();
  });

  test('allow_list mode becomes valid after adding a subject and invalid after removing it', async ({ authedPage }) => {
    const accessMode = authedPage.getByTestId('resource-policy__access-mode');
    await accessMode.selectOption('allow_list');

    await expect(authedPage.getByTestId('resource-policy__save')).toBeDisabled();

    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption({ index: 1 });
    await expect(authedPage.getByTestId('resource-policy__save')).toBeEnabled();

    await authedPage.getByRole('button', { name: /remove/i }).first().click();
    await expect(authedPage.getByTestId('resource-policy__save')).toBeDisabled();
  });

  test('switching access mode back to allow_all_members clears validation warning', async ({ authedPage }) => {
    const accessMode = authedPage.getByTestId('resource-policy__access-mode');
    await accessMode.selectOption('allow_list');
    await expect(authedPage.getByTestId('resource-policy__allow-list-required')).toBeVisible();

    await accessMode.selectOption('allow_all_members');
    await expect(authedPage.getByTestId('resource-policy__allow-list-required')).not.toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__save')).toBeEnabled();
  });

  test('saves endpoint resource and subject policy payload', async ({ authedPage }) => {
    // Endpoint row is selected by default in current fixture order.
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

  test('effective summary reflects root endpoint token limit changes', async ({ authedPage }) => {
    await authedPage.getByTestId('resource-policy__endpoint-daily-token-limit').fill('180000');

    const requestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH' && req.url().includes('/resources/endpoint/ep_1/policy');
    });
    await authedPage.getByTestId('resource-policy__save').click();
    await requestPromise;

    const summary = authedPage.getByTestId('resource-policy__effective-summary');
    await expect(summary).toContainText('180000');
  });

  test('effective summary renders per-subject override lines', async ({ authedPage }) => {
    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption({ index: 1 });
    await authedPage.getByPlaceholder('subject daily token limit').fill('12345');

    const requestPromise = authedPage.waitForRequest((req) =>
      req.method() === 'PATCH' && req.url().includes('/resources/endpoint/ep_1/policy')
    );
    await authedPage.getByTestId('resource-policy__save').click();
    await requestPromise;

    await expect(authedPage.getByTestId('resource-policy__effective-subject--0')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__effective-subject--0')).toContainText('12345');
  });

  test('keeps subject override values after save in current session', async ({ authedPage }) => {
    await authedPage.getByTestId('resource-policy__add-subject').click();
    const subjectSelect = authedPage.getByTestId('resource-policy__subject-id-select').first();
    await subjectSelect.selectOption({ index: 1 });
    const selectedSubjectId = await subjectSelect.inputValue();
    await authedPage.getByPlaceholder('subject daily token limit').fill('45000');

    const requestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH' && req.url().includes('/resources/endpoint/ep_1/policy');
    });
    await authedPage.getByTestId('resource-policy__save').click();
    await requestPromise;

    await expect(subjectSelect).toHaveValue(selectedSubjectId);
    await expect(authedPage.getByPlaceholder('subject daily token limit')).toHaveValue('45000');
  });

  test('supports group subject override payload', async ({ authedPage }) => {
    const syntheticGroupId = `group_e2e_${Date.now()}`;
    const syntheticGroupLabel = `E2E Group ${Date.now()}`;

    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-type').selectOption('group');
    await authedPage.evaluate(({ syntheticGroupId, syntheticGroupLabel }) => {
      const select = document.querySelector(
        '[data-testid="resource-policy__subject-id-select"]'
      ) as HTMLSelectElement | null;
      if (!select) return;
      if (!Array.from(select.options).some((option) => option.value === syntheticGroupId)) {
        const option = document.createElement('option');
        option.value = syntheticGroupId;
        option.text = syntheticGroupLabel;
        select.appendChild(option);
      }
    }, { syntheticGroupId, syntheticGroupLabel });
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption(syntheticGroupId);
    await authedPage.getByPlaceholder('subject daily token limit').fill('55000');

    const requestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH' && req.url().includes('/resources/endpoint/ep_1/policy');
    });
    await authedPage.getByTestId('resource-policy__save').click();
    const request = await requestPromise;
    const payload = request.postDataJSON() as {
      allowed_subjects: Array<{ subject_type: string; subject_id: string }>;
    };

    expect(payload.allowed_subjects[0]?.subject_type).toBe('group');
    expect(payload.allowed_subjects[0]?.subject_id).toBe(syntheticGroupId);
  });

  test('saves source library resource policy payload', async ({ authedPage }) => {
    const sourceRow = authedPage.locator('[data-testid^="resource-policy__row--source_library--"]').first();
    await expect(sourceRow).toBeVisible();
    await sourceRow.click();

    await authedPage.getByTestId('resource-policy__library-max-total-files').fill('300');
    await authedPage.getByTestId('resource-policy__library-max-file-size-bytes').fill('10485760');

    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption({ index: 1 });
    await authedPage.getByPlaceholder(/subject.*total files/i).fill('120');
    await authedPage.getByPlaceholder(/subject.*file size/i).fill('2097152');

    const requestPromise = authedPage.waitForRequest((req) =>
      req.method() === 'PATCH' && req.url().includes('/resources/source_library/')
    );
    await authedPage.getByTestId('resource-policy__save').click();
    const request = await requestPromise;

    const payload = request.postDataJSON() as {
      quota_limits?: { rules: Array<{ key: string; value: number }> };
      allowed_subjects: Array<{
        quota_limits?: { rules: Array<{ key: string; value: number }> };
      }>;
    };
    expect(payload.quota_limits?.rules).toEqual([
      { key: 'source_library.max_total_files', value: 300 },
      { key: 'source_library.max_file_size_bytes', value: 10485760 },
    ]);
    expect(payload.allowed_subjects[0]?.quota_limits?.rules).toEqual([
      { key: 'source_library.max_total_files', value: 120 },
      { key: 'source_library.max_file_size_bytes', value: 2097152 },
    ]);
    await expect(authedPage.getByTestId('resource-policy__editor')).toContainText(/Source Library/i);
  });

  test('saves agent resource policy payload with concurrency override', async ({ authedPage }) => {
    const agentRow = authedPage.locator('[data-testid^="resource-policy__row--agent--"]').first();
    await expect(agentRow).toBeVisible();
    await agentRow.click();

    await authedPage.getByTestId('resource-policy__agent-max-concurrency').fill('6');
    await authedPage.getByTestId('resource-policy__add-subject').click();
    await authedPage.getByTestId('resource-policy__subject-id-select').selectOption({ index: 1 });
    await authedPage.getByPlaceholder(/subject.*concurrency/i).fill('2');

    const requestPromise = authedPage.waitForRequest((req) =>
      req.method() === 'PATCH' && req.url().includes('/resources/agent/')
    );
    await authedPage.getByTestId('resource-policy__save').click();
    const request = await requestPromise;

    const payload = request.postDataJSON() as {
      rate_limits?: { rules: Array<{ key: string; value: number }> };
      allowed_subjects: Array<{
        rate_limits?: { rules: Array<{ key: string; value: number }> };
      }>;
    };
    expect(payload.rate_limits?.rules).toEqual([{ key: 'agent.max_concurrency', value: 6 }]);
    expect(payload.allowed_subjects[0]?.rate_limits?.rules).toEqual([{ key: 'agent.max_concurrency', value: 2 }]);
    await expect(authedPage.getByTestId('resource-policy__editor')).toContainText(/Agent/i);
  });

});
