/**
 * Agent Runners Page - mock E2E coverage
 *
 * Covers the current runner configuration surface, connection keys, and
 * readiness operations. Legacy workload-kind and runtime-choice coverage is
 * intentionally absent from this active spec.
 */

import type { Locator } from '@playwright/test';

import { test, expect, goToProject } from './fixtures/test-base';

function runnerRows(table: Locator) {
  return table.locator('[data-testid="agent-runners__table__row"]');
}

async function openCreateRunnerDialog(authedPage: import('@playwright/test').Page) {
  await expect(authedPage.getByTestId('agent-runners__table')).toBeVisible({ timeout: 10000 });
  await authedPage.getByTestId('agent-runners__create-btn').click();
  const dialog = authedPage.getByTestId('agent-runners__create-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Agent Runners Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'agent-runners');
  });

  test('table renders with runner rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agent-runners__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = runnerRows(table);
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test('displays runner names from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agent-runners__table')).toBeVisible({ timeout: 10000 });

    await expect(authedPage.getByText('Support Runner')).toBeVisible();
    await expect(authedPage.getByText('Research Runner')).toBeVisible();
  });

  test('shows runner header actions without legacy cross-links', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agent-runners__open-endpoints')).toHaveAttribute(
      'href',
      /\/endpoints$/,
    );
    await expect(authedPage.getByTestId('agent-runners__open-chat')).toHaveCount(0);
    await expect(authedPage.getByTestId('agent-runners__open-notebook')).toHaveCount(0);
    await expect(authedPage.getByTestId('agent-runners__open-agent-tasks')).toHaveCount(0);
  });

  test('opens diagnostics panel when runner query context is present', async ({ authedPage }) => {
    await authedPage.goto(
      '/en-US/workspaces/ws_default/projects/proj_001/agent-runners?runner=ag_1',
      { waitUntil: 'domcontentloaded' },
    );
    const detailsCard = authedPage.getByTestId('agent-runners__details-card');
    await expect(detailsCard).toBeVisible({ timeout: 10000 });
    await expect(detailsCard).toContainText('Support Runner');
    await expect(detailsCard.getByText(/runner details/i)).toBeVisible();
  });

  test('create dialog opens with runner configuration fields only', async ({ authedPage }) => {
    const dialog = await openCreateRunnerDialog(authedPage);

    await expect(dialog.getByText(/create agent runner/i)).toBeVisible();
    await expect(dialog.getByText(/default endpoint/i)).toBeVisible();
    await expect(dialog.getByText('Capabilities', { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText(/interaction kind|chat agent|notebook agent|external|internal|docker|compose/i);
  });

  test('edit dialog opens when clicking edit on a row', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agent-runners__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const firstRow = runnerRows(table).first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole('button', { name: /edit/i }).click();

    await expect(authedPage.getByTestId('agent-runners__edit-dialog')).toBeVisible();
  });

  test('enable or disable readiness action is present on each manageable row', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agent-runners__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const firstRow = runnerRows(table).first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow.getByRole('button', { name: /enable|disable/i })).toBeVisible();
  });

  test('table shows readiness and capabilities without legacy workload or runtime columns', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agent-runners__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    await expect(table).toContainText(/terminal|artifacts|file inputs/i);
    await expect(table).not.toContainText(/chat|notebook|external|internal|docker|compose|kubernetes/i);
  });

  test('create runner via dialog submission', async ({ authedPage }) => {
    const dialog = await openCreateRunnerDialog(authedPage);

    const createResponsePromise = authedPage.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        response.status() === 201 &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agent-runners$/.test(response.url())
      );
    });

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === 'POST' &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agent-runners$/.test(req.url())
      );
    });

    await dialog.locator('input').nth(0).fill('E2E Task Runner');
    await dialog.locator('input').nth(1).fill('Created by E2E test');

    await dialog.getByRole('button', { name: /^create$/i }).click();
    await createRequestPromise;
    await createResponsePromise;
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await expect(
      authedPage
        .getByTestId('agent-runners__table__row')
        .filter({ hasText: 'E2E Task Runner' })
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('create runner with empty name should not submit', async ({ authedPage }) => {
    const dialog = await openCreateRunnerDialog(authedPage);

    await expect(dialog.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  test('toggle runner readiness via enable or disable button', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agent-runners__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const firstRow = runnerRows(table).first();
    await expect(firstRow).toBeVisible();
    const toggleBtn = firstRow.getByRole('button', { name: /enable|disable/i });

    const requestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === 'PATCH' &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agent-runners\/.+/.test(req.url())
      );
    });
    await toggleBtn.click();
    await requestPromise;

    await expect(firstRow).toBeVisible();
  });

  test('connection keys flow opens create key dialog result', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agent-runners__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const keyBtn = authedPage.locator('[data-testid^="agent-runners__connection-keys-btn--"]').first();
    await expect(keyBtn).toBeVisible();
    await keyBtn.click();

    const sheet = authedPage.getByTestId('agent-runners__connection-keys-sheet');
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('agent-runners__connection-info-card')).toBeVisible();
    await expect(authedPage.getByTestId('agent-runners__connection-info-ws-url')).toContainText(/agent-execution\/ws/);

    const createKeyRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === 'POST' &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agent-runners\/.*\/keys$/.test(req.url())
      );
    });
    await sheet.getByRole('button', { name: /create api key|create/i }).click();
    await createKeyRequestPromise;

    await expect(authedPage.getByTestId('api-keys__key-created-dialog')).toBeVisible({ timeout: 10000 });
  });
});
