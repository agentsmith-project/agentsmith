import { expect, type Page } from '@playwright/test';
import { LOCALE } from './integration-real-helpers';

export async function openPersonalContextFromUserMenu(args: {
  page: Page;
  entryPagePath: string;
  menuItemTestId: 'user-menu__workspace-personal-context' | 'user-menu__project-personal-context';
  expectedPath: RegExp;
}): Promise<void> {
  await args.page.goto(args.entryPagePath);
  await expect(args.page.getByTestId('topbar__user-menu')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('topbar__user-menu').click();
  await expect(args.page.getByTestId(args.menuItemTestId)).toBeVisible({ timeout: 10_000 });
  await args.page.getByTestId(args.menuItemTestId).click();
  await args.page.waitForURL(args.expectedPath, { timeout: 30_000 });
  await expect(args.page.getByTestId('context-store__list-card')).toBeVisible({ timeout: 30_000 });
}

export async function openWorkspaceSharedContextPage(args: {
  page: Page;
  workspaceId: string;
}): Promise<void> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/settings/context`);
  await expect(args.page.getByTestId('context-store__list-card')).toBeVisible({ timeout: 30_000 });
}

export async function saveContextEntryViaUi(args: {
  page: Page;
  key: string;
  value: string;
}): Promise<void> {
  await args.page.getByTestId('context-store__new').click();
  await args.page.getByTestId('context-store__key').fill(args.key);
  await args.page.getByTestId('context-store__content').fill(args.value);
  await args.page.getByTestId('context-store__save').click();
  await expect(args.page.getByTestId(`context-store__item--${args.key}`)).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('context-store__content')).toHaveValue(args.value);
}
