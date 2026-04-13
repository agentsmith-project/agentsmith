/**
 * Join Page E2E Tests
 *
 * Tests the project join/invitation page including:
 * - Invalid invitation (no token)
 * - Valid invitation with accept/decline buttons
 */

import { test as base, expect } from '@playwright/test';
import { waitForPageReady } from './utils/navigation';

const test = base;

test.describe('Join Page - Invalid Invitation', () => {
  test('should display invalid invitation message when no token', async ({ page }) => {
    await page.goto('/en-US/join');
    await waitForPageReady(page);

    // Should show invalid/expired invitation heading
    await expect(
      page.getByRole('heading', { name: /invalid|expired/i }),
    ).toBeVisible({ timeout: 10000 });

    // Should have a "Go Home" button
    await expect(
      page.getByRole('button', { name: /go home|home/i }),
    ).toBeVisible();
  });

  test('should navigate home when clicking Go Home button', async ({ page }) => {
    await page.goto('/en-US/join');
    await waitForPageReady(page);

    const homeBtn = page.getByRole('button', { name: /go home|home/i });
    await expect(homeBtn).toBeVisible({ timeout: 10000 });
    await homeBtn.click();

    // Should navigate to home/login
    await page.waitForURL(/\/(en-US)?(\/(login)?)?$/, { timeout: 10000 });
  });
});

test.describe('Join Page - Valid Invitation', () => {
  test('should display accept and decline buttons with valid token', async ({ page }) => {
    await page.goto('/en-US/join?token=test-invitation-token');
    await waitForPageReady(page);

    // Should show join invitation heading
    await expect(
      page.getByRole('heading', { name: /join|invitation/i }),
    ).toBeVisible({ timeout: 10000 });

    // Should display accept and decline buttons
    const acceptBtn = page.getByTestId('join__continue-btn');
    const declineBtn = page.getByTestId('join__decline-btn');

    await expect(acceptBtn).toBeVisible();
    await expect(declineBtn).toBeVisible();
  });

  test('should navigate to invited workspace login on continue', async ({ page }) => {
    await page.goto('/en-US/join?token=test-invitation-token');
    await waitForPageReady(page);

    const acceptBtn = page.getByTestId('join__continue-btn');
    await expect(acceptBtn).toBeVisible({ timeout: 10000 });
    await acceptBtn.click();

    // Should redirect directly to the invited workspace login so the invited workspace can be carried forward explicitly
    await page.waitForURL(/\/workspaces\/.*\/login/, { timeout: 10000 });
  });

  test('should navigate home on decline', async ({ page }) => {
    await page.goto('/en-US/join?token=test-invitation-token');
    await waitForPageReady(page);

    const declineBtn = page.getByTestId('join__decline-btn');
    await expect(declineBtn).toBeVisible({ timeout: 10000 });
    await declineBtn.click();

    // Should navigate to home
    await page.waitForURL(/\/(en-US)?(\/(login)?)?$/, { timeout: 10000 });
  });
});

test.describe('Join Page - Chinese Locale', () => {
  test('should display join page in Chinese', async ({ page }) => {
    await page.goto('/zh-CN/join');
    await waitForPageReady(page);

    // Should show Chinese text for invalid invitation
    await expect(page.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
  });
});
