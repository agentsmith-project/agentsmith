/**
 * Workbench Page E2E Tests
 *
 * Tests the studio recipe list, create recipe dialog,
 * navigation to recipe detail, and recipe detail page elements.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Workbench Page', () => {
  test.describe('Recipe List', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'studio');
    });

    test('should display recipe list with recipe cards', async ({ authedPage }) => {
      const recipeList = authedPage.getByTestId('studio__recipe-list');
      await expect(recipeList).toBeVisible({ timeout: 10000 });

      // MSW should provide at least one recipe card
      const recipeCards = authedPage.getByTestId('studio__recipe-card');
      await expect(recipeCards.first()).toBeVisible({ timeout: 10000 });

      // Each recipe card should have a data-recipe-id attribute
      const firstRecipeId = await recipeCards.first().getAttribute('data-recipe-id');
      expect(firstRecipeId).toBeTruthy();
    });

    test('should display create recipe button', async ({ authedPage }) => {
      const createBtn = authedPage.getByTestId('studio__create-recipe-btn');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      await expect(createBtn).toBeEnabled();
    });

    test('should open create recipe dialog', async ({ authedPage }) => {
      const createBtn = authedPage.getByTestId('studio__create-recipe-btn');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      await createBtn.click();

      // Dialog should appear
      const dialog = authedPage.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Dialog contains a title input (id="recipe-title", label "Recipe Title")
      const titleInput = dialog.locator('#recipe-title');
      await expect(titleInput).toBeVisible();
      await titleInput.fill('Test Recipe');

      // Close dialog
      await authedPage.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('should navigate to recipe detail on card click', async ({ authedPage }) => {
      const recipeCards = authedPage.getByTestId('studio__recipe-card');
      await expect(recipeCards.first()).toBeVisible({ timeout: 10000 });

      // Get the recipe ID from the card for URL verification
      const recipeId = await recipeCards.first().getAttribute('data-recipe-id');

      // Click the first recipe card
      await recipeCards.first().click();

      // Should navigate to the recipe detail page
      await authedPage.waitForURL(/\/studio\/recipes\//, { timeout: 10000 });

      // Recipe header should be visible on detail page
      await expect(authedPage.getByTestId('studio__recipe-header')).toBeVisible();
    });
  });

  test.describe('Recipe Detail', () => {
    test.beforeEach(async ({ authedPage }) => {
      // Navigate directly to a known recipe detail page
      await goToProject(authedPage, 'studio/recipes/recipe_001');
    });

    test('should display recipe header', async ({ authedPage }) => {
      const header = authedPage.getByTestId('studio__recipe-header');
      await expect(header).toBeVisible({ timeout: 10000 });
    });

    test('should display conversation input and send button', async ({ authedPage }) => {
      const conversationInput = authedPage.getByTestId('studio__conversation-input');
      const sendBtn = authedPage.getByTestId('studio__send-btn');

      await expect(conversationInput).toBeVisible({ timeout: 10000 });
      await expect(sendBtn).toBeVisible();
    });

    test('should display artifact cards if available', async ({ authedPage }) => {
      // Artifacts may or may not be present depending on MSW data
      const artifactCards = authedPage.getByTestId('studio__artifact-card');
      const count = await artifactCards.count();

      if (count > 0) {
        await expect(artifactCards.first()).toBeVisible();
        const artifactId = await artifactCards.first().getAttribute('data-artifact-id');
        expect(artifactId).toBeTruthy();
      }
    });

    test('should allow typing in conversation input', async ({ authedPage }) => {
      const conversationInput = authedPage.getByTestId('studio__conversation-input');
      await expect(conversationInput).toBeVisible({ timeout: 10000 });

      const input = conversationInput.locator(
        'textarea, input[type="text"], [contenteditable="true"]',
      );
      await expect(input.first()).toBeVisible();

      await input.first().fill('Test recipe prompt');

      const sendBtn = authedPage.getByTestId('studio__send-btn');
      await expect(sendBtn).toBeEnabled();
    });

    test('should open edit dialog and submit update payload', async ({ authedPage }) => {
      const patchRequestPromise = authedPage.waitForRequest((req) => {
        return req.method() === 'PATCH'
          && /\/api\/v1\/workspaces\/.*\/projects\/.*\/recipes\/recipe_001$/.test(req.url());
      });

      await authedPage.getByRole('button', { name: /edit/i }).click();
      const dialog = authedPage.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const titleInput = dialog.getByTestId('studio__edit-recipe-title');
      await titleInput.fill('Updated Recipe From E2E');

      await dialog.getByTestId('studio__edit-recipe-status').click();
      await authedPage.getByRole('option', { name: /closed/i }).click();
      await dialog.getByTestId('studio__edit-recipe-save').click();

      const request = await patchRequestPromise;
      const payload = request.postDataJSON() as { title?: string; status?: string };
      expect(payload.title).toBe('Updated Recipe From E2E');
      expect(payload.status).toBe('closed');
    });

    test('should navigate back to list when clicking leave button', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /leave/i }).click();
      await authedPage.waitForURL(/\/studio$/);
      await expect(authedPage.getByTestId('studio__recipe-list')).toBeVisible();
    });

    test('should open add sources dialog with disabled confirm before selection', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /add sources/i }).click();
      const dialog = authedPage.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: /add selected/i })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible();
    });
  });
});
