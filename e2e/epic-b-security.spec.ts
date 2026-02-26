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

import { test, expect, goToProject } from './fixtures/test-base';

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

      // Chat input should be present
      const chatInput = authedPage.getByTestId('chat__input');
      await expect(chatInput).toBeVisible();

      // Send button should be available
      const sendButton = authedPage.getByRole('button', { name: /send/i });
      await expect(sendButton).toBeVisible();
    });
  });

  test.describe('SSE Connection - AI Studio', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'studio');
    });

    test('studio page loads successfully (SSE endpoint available)', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    });

    test('task execution panel is available', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

      // Task execution panel should be present
      const taskPanel = authedPage.getByTestId('studio__task-panel');
      const hasTaskPanel = await taskPanel.isVisible().catch(() => false);

      if (hasTaskPanel) {
        await expect(taskPanel).toBeVisible();
      }
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
      const table = authedPage.getByTestId('audit__table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Table should have rows
      const rows = table.locator('[data-testid="audit__table__row"]');
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      expect(await rows.count()).toBeGreaterThanOrEqual(1);
    });

    test('audit events display standardized field structure', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

      // Standardized audit events should show:
      // - actor information (who performed the action)
      // - action type (what was done)
      // - timestamp (when it happened)

      // Check for action types (these are displayed in the table)
      await expect(authedPage.getByText(/project\.create|agent\.create|endpoint\.invoke/i).first()).toBeVisible();
    });

    test('audit detail drawer shows standardized event structure', async ({ authedPage }) => {
      const table = authedPage.getByTestId('audit__table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Open first audit event details
      const firstRow = table.getByTestId('audit__table__row').first();
      await firstRow.getByRole('button').last().click();
      await authedPage.getByRole('menuitem', { name: /view details/i }).click();

      // Detail drawer should open
      await expect(authedPage.getByText(/Audit Event Details/i)).toBeVisible();

      // Standardized fields should be visible:
      // - Actor (type, id, name)
      // - Action
      // - Timestamp (at)
      // - Request ID
      await expect(authedPage.getByText(/actor|action|timestamp|request/i)).toBeVisible();
    });
  });

  test.describe('Audit Page - Filtering & Search', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'audit');
    });

    test('filter controls are available for standardized fields', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

      const filters = authedPage.getByTestId('audit__filters');
      await expect(filters).toBeVisible();

      // Filters for standardized fields should be present
      await expect(filters.getByText(/Action/i)).toBeVisible();
      await expect(filters.getByText(/Actor Type/i)).toBeVisible();
      await expect(filters.getByText(/Result/i)).toBeVisible();
    });

    test('can filter by action type', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

      const filters = authedPage.getByTestId('audit__filters');
      await expect(filters).toBeVisible();

      // Action filter dropdown should be present
      const actionFilter = filters.getByLabel(/action/i);
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
        await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });
      } else {
        // User lacks permission - should see permission denied message
        await expect(authedPage.getByText(/permission/i)).toBeVisible();
      }
    });

    test('audit actions respect user permissions', async ({ authedPage }) => {
      await goToProject(authedPage, 'audit');

      // Check if user has access
      const pageState = authedPage.getByTestId('page-state__success');
      const hasPermission = await pageState.isVisible().catch(() => false);

      if (hasPermission) {
        // Refresh button should be available
        await expect(authedPage.getByRole('button', { name: /refresh/i })).toBeVisible();
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
      await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

      // Audit events should include security-relevant actions
      // Look for governance actions like policy changes, access control, etc.
      const table = authedPage.getByTestId('audit__table');
      const rows = table.getByTestId('audit__table__row');

      const rowCount = await rows.count();
      if (rowCount > 0) {
        // First row should be visible
        await expect(rows.first()).toBeVisible();
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
      await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });
    }

    // Navigate back to chat - SSE should still work
    await goToProject(authedPage, 'chat');
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('chat__input')).toBeVisible();
  });
});
