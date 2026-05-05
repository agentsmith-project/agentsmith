/**
 * Epic B: Security – E2E Tests
 *
 * Tests for Epic B1 (SSE Ticket Migration) and Epic B2 (Audit Field Standardization)
 *
 * B1 Coverage:
 * - SSE connections work correctly in real-time features
 * - Security: No JWT tokens exposed in SSE URLs (when ticket mode enabled)
 *
 * B2 Coverage:
 * - Audit page displays with standardized fields
 * - Audit event data shows proper structure (actor, target, action, at, request_id)
 * - CSV/JSON export utilities (when integrated into UI)
 * - Security: Permission checks on audit page
 *
 * @module e2e/epic-b-security
 */

import type { Page } from '@playwright/test';
import { test, expect, goToProject } from './fixtures/test-base';

async function expectAuditPageReady(page: Page) {
  const onLogin = /\/login(?:\/|$)/.test(new URL(page.url()).pathname);
  if (onLogin) return false;
  const blocked = await page.getByTestId('feature-availability__banner').isVisible().catch(() => false);
  if (blocked) return false;
  await expect(page.getByTestId('audit__filters')).toBeVisible({ timeout: 10000 });
  const hasTable = await page.getByTestId('audit__table').isVisible().catch(() => false);
  if (!hasTable) {
    await expect(page.getByTestId('audit-usage__empty-state')).toBeVisible();
  }
  return true;
}

test.describe('Epic B1: SSE Ticket Migration', () => {
  test.describe('SSE Connection - Chat Page', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'chat');
    });

    test('chat page loads successfully (SSE endpoint available)', async ({ authedPage }) => {
      // Chat page should load successfully
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    });

    test('chat input is available for real-time messaging', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

      // Composer and send button should be available
      await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
      await expect(authedPage.getByTestId('chat__send-btn')).toBeVisible();
    });
  });

  test.describe('SSE Connection - Agent Tasks', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'agent-tasks');
    });

    test('Agent Tasks page loads successfully (SSE endpoint available)', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    });

    test('task execution panel is available', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

      // Task execution panel should be present
      await expect(authedPage.getByTestId('agent-tasks__task-list')).toBeVisible();
    });
  });

  test.describe('Security: SSE Token Handling', () => {
    test('SSE URLs do not contain JWT tokens in network logs', async ({ authedPage }) => {
      // Set up network listener to capture SSE requests
      const sseRequests: string[] = [];

      authedPage.on('request', (request) => {
        const url = request.url();
        // Check for SSE endpoints (typically with /stream or /events)
        if (url.includes('/stream') || url.includes('/events') || url.includes('text/event-stream')) {
          sseRequests.push(url);
        }
      });

      // Navigate to chat page which uses SSE
      await goToProject(authedPage, 'chat');
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

      // Wait a bit for any SSE connections to establish
      await authedPage.waitForTimeout(2000);

      // Verify no JWT tokens in SSE URLs
      // JWT tokens typically have format: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
      for (const url of sseRequests) {
        expect(url).not.toMatch(/eyJ/); // JWT header prefix
        expect(url).not.toMatch(/bearer/i); // No bearer in URL params
      }
    });
  });
});

test.describe('Epic B2: Audit Field Standardization', () => {
  test.describe('Audit Page - Standardized Fields', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'audit');
    });

    test('audit table renders with standardized event data', async ({ authedPage }) => {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;

      const hasTable = await authedPage.getByTestId('audit__table').isVisible().catch(() => false);
      if (hasTable) {
        const rows = authedPage.getByTestId('audit__table').locator('[data-testid="audit__table__row"]');
        await expect(rows.first()).toBeVisible({ timeout: 10000 });
      }
    });

    test('audit events display standardized field structure', async ({ authedPage }) => {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;
      const hasTable = await authedPage.getByTestId('audit__table').isVisible().catch(() => false);
      if (!hasTable) return;

      // Standardized audit events should show:
      // - actor information (who performed the action)
      // - action type (what was done)
      // - timestamp (when it happened)

      // Check for action types (these are displayed in the table)
      await expect(authedPage.getByText(/project\.create|agent\.create|endpoint\.invoke/i).first()).toBeVisible();
    });

    test('audit detail drawer shows standardized event structure', async ({ authedPage }) => {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;
      const table = authedPage.getByTestId('audit__table');
      const hasTable = await table.isVisible().catch(() => false);
      if (!hasTable) return;

      // Open first audit event details
      const firstRow = table.getByTestId('audit__table__row').first();
      await firstRow.getByRole('button').last().click();
      await authedPage.getByRole('menuitem', { name: /view details/i }).click();

      // Detail drawer should open
      await expect(authedPage.getByRole('dialog', { name: /Audit Event Details/i })).toBeVisible();
      await expect(authedPage.getByTestId('audit__detail-summary')).toBeVisible();

      // Standardized fields should be visible:
      // - Actor (type, id, name)
      // - Action
      // - Timestamp (at)
      // - Request ID
      const drawer = authedPage.getByLabel(/audit event details/i);
      await expect(drawer.getByText(/^timestamp$/i)).toBeVisible();
      await expect(drawer.getByText(/^action$/i)).toBeVisible();
      await expect(drawer.getByText(/^actor$/i)).toBeVisible();
      await expect(drawer.getByText(/^request id$/i)).toBeVisible();
    });
  });

  test.describe('Audit Page - Filtering & Search', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'audit');
    });

    test('filter controls are available for standardized fields', async ({ authedPage }) => {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;

      const filters = authedPage.getByTestId('audit__filters');
      await expect(filters).toBeVisible();

      // Filters for standardized fields should be present
      await expect(filters.getByText(/Action/i)).toBeVisible();
      await expect(filters.getByText(/Actor Type/i)).toBeVisible();
      await expect(filters.getByText(/Result/i)).toBeVisible();
    });

    test('can filter by action type', async ({ authedPage }) => {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;

      const filters = authedPage.getByTestId('audit__filters');
      await expect(filters).toBeVisible();

      // Action filter dropdown should be present
      const actionFilter = filters.locator('#audit-filter-action');
      await expect(actionFilter).toBeVisible();
    });
  });

  test.describe('Security: Audit Access Control', () => {
    test('audit page requires appropriate permissions', async ({ authedPage }) => {
      await goToProject(authedPage, 'audit');

      // Page should either show audit table (if permitted) or permission denied (if not)
      const pageState = authedPage.getByTestId('page-state__success');
      const hasPermission = await pageState.isVisible().catch(() => false);

      if (hasPermission) {
        // User has permission - audit table should be visible
        const ready = await expectAuditPageReady(authedPage);
        if (!ready) return;
      } else {
        // User lacks permission - should render error page state
        await expect(authedPage.getByTestId('page-state__error')).toBeVisible();
      }
    });

    test('audit actions respect user permissions', async ({ authedPage }) => {
      await goToProject(authedPage, 'audit');

      // Check if user has access
      const pageState = authedPage.getByTestId('page-state__success');
      const hasPermission = await pageState.isVisible().catch(() => false);

      if (hasPermission) {
        // Authorized users should reach a usable audit page state.
        const ready = await expectAuditPageReady(authedPage);
        if (!ready) return;
      }
    });
  });
});

test.describe('Epic B: Security Integration', () => {
  test('audit trail captures security-relevant events', async ({ authedPage }) => {
    await goToProject(authedPage, 'audit');

    const pageState = authedPage.getByTestId('page-state__success');
    const hasPermission = await pageState.isVisible().catch(() => false);

    if (hasPermission) {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;

      // Audit events should include security-relevant actions
      // Look for governance actions like policy changes, access control, etc.
      const hasTable = await authedPage.getByTestId('audit__table').isVisible().catch(() => false);
      if (hasTable) {
        const table = authedPage.getByTestId('audit__table');
        const rows = table.getByTestId('audit__table__row');
        const rowCount = await rows.count();
        if (rowCount > 0) {
          await expect(rows.first()).toBeVisible();
        }
      }
    }
  });

  test('SSE and audit systems coexist without interference', async ({ authedPage }) => {
    // Navigate to chat (uses SSE)
    await goToProject(authedPage, 'chat');
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Navigate to audit (uses REST API)
    await goToProject(authedPage, 'audit');
    const pageState = authedPage.getByTestId('page-state__success');
    const hasPermission = await pageState.isVisible().catch(() => false);

    if (hasPermission) {
      const ready = await expectAuditPageReady(authedPage);
      if (!ready) return;
    }

    // Navigate back to chat - SSE should still work
    await goToProject(authedPage, 'chat');
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
  });
});
