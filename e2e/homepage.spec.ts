/**
 * Homepage & Login Page Tests
 */

import { test, expect } from '@playwright/test';

const baseUrl = 'http://localhost:3000';
const testEmail = 'test@example.com';

test.describe('Homepage & Login', () => {
  test('should redirect root to locale login', async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page).toHaveURL(/\/en-US\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome to MBOS' })).toBeVisible();
  });

  test('should redirect locale root to login', async ({ page }) => {
    await page.goto(`${baseUrl}/en-US`);
    await expect(page).toHaveURL(/\/en-US\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome to MBOS' })).toBeVisible();
  });

  test('should show login options on login page', async ({ page }) => {
    await page.goto(`${baseUrl}/en-US/login`);
    await expect(page.getByText('Login with Keycloak')).toBeVisible();
    await expect(page.getByText('Quick Login')).toBeVisible();
  });

  test('should login via Quick Login button', async ({ page }) => {
    await page.goto(`${baseUrl}/en-US/login`);

    await page.locator('input[placeholder*="user@example.com"]').fill(testEmail);
    await page.getByText('Quick Login').click();

    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Select your workspace' })).toBeVisible();
  });
});
