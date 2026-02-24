#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function requireFile(path) {
  if (!fs.existsSync(path)) throw new Error(`missing_file:${path}`);
}

async function loginWithKeycloak({ page, baseUrl, locale, keycloakBase, realm, clientId, username, password }) {
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(24));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = `${baseUrl.replace(/\/+$/, '')}/${locale}/login/callback`;

  await page.goto(`${baseUrl.replace(/\/+$/, '')}/${locale}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.evaluate((ctx) => {
    localStorage.clear();
    sessionStorage.setItem('mbos:keycloak:pkce', JSON.stringify(ctx));
  }, { verifier, state, redirectUri, createdAt: Date.now() });

  const authUrl = new URL(`${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/auth`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const usernameLocator = page.locator('input#username, input[name="username"], input[name="email"]').first();
  const passwordLocator = page.locator('input#password, input[name="password"]').first();
  const loginButtonLocator = page.locator('#kc-login, button[type="submit"]').first();

  const deadline = Date.now() + 30_000;
  let mode = 'unknown';
  while (Date.now() < deadline) {
    if (page.url().includes(`/${locale}/`)) {
      mode = 'app_redirect';
      break;
    }
    if (await usernameLocator.isVisible().catch(() => false)) {
      mode = 'login_form';
      break;
    }
    await page.waitForTimeout(500);
  }

  if (mode === 'login_form') {
    await usernameLocator.fill(username);
    await passwordLocator.fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 120_000 }),
      loginButtonLocator.click(),
    ]);
  } else if (mode === 'app_redirect') {
    await page.waitForURL((url) => {
      try {
        return url.pathname.startsWith(`/${locale}/`);
      } catch {
        return false;
      }
    }, { timeout: 120_000 });
  } else {
    throw new Error(`auth_state_unresolved current_url=${page.url()}`);
  }
}

async function gotoProjectPage(page, baseUrl, path) {
  await page.goto(`${baseUrl.replace(/\/+$/, '')}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const staleProject = await page.getByTestId('project-shell__stale-project').isVisible().catch(() => false);
  if (staleProject) {
    throw new Error(`stale_project:${path}`);
  }
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const locale = process.env.LOCALE || 'zh-CN';
  const workspaceId = process.env.WORKSPACE_ID || 'ws_default';
  const keycloakBase = process.env.KEYCLOAK_BASE_URL || 'http://localhost:18080';
  const realm = process.env.KEYCLOAK_REALM || 'mbos';
  const clientId = process.env.KEYCLOAK_CLIENT_ID || 'agentsmith';
  const username = process.env.USERNAME || 'dev-admin';
  const password = process.env.PASSWORD || 'dev-admin-123';
  const projectIdFile = process.env.PROJECT_ID_FILE || '/tmp/agentsmith_project_id.txt';
  requireFile(projectIdFile);
  const projectId = fs.readFileSync(projectIdFile, 'utf8').trim();
  if (!projectId) throw new Error(`empty_project_id:${projectIdFile}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    console.log('[gov-interact] login via keycloak...');
    await loginWithKeycloak({ page, baseUrl, locale, keycloakBase, realm, clientId, username, password });

    // Members: basic filter interactions and invite dialog UX (safe interaction).
    const membersPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/members`;
    console.log(`[gov-interact] members ${membersPath}`);
    await gotoProjectPage(page, baseUrl, membersPath);
    await page.getByTestId('members__search-input').fill('dev');
    await page.getByTestId('members__role-filter').selectOption({ index: 0 });
    await page.getByTestId('members__status-filter').selectOption({ index: 0 });
    await page.getByTestId('members__filtered-count').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('members__invite-btn').click();
    await page.getByTestId('members__invite-dialog').waitFor({ state: 'visible', timeout: 10_000 });
    await page.keyboard.press('Escape');

    // Resource policy: open an endpoint row editor and check save button is present.
    const rpPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`;
    console.log(`[gov-interact] resource-policy ${rpPath}`);
    await gotoProjectPage(page, baseUrl, rpPath);
    const endpointRow = page.locator('[data-testid^="resource-policy__row--endpoint--"]').first();
    await endpointRow.waitFor({ state: 'visible', timeout: 10_000 });
    await endpointRow.click();
    await page.getByTestId('resource-policy__editor').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('resource-policy__save').waitFor({ state: 'visible', timeout: 10_000 });

    // Audit: filters and table visible.
    const auditPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/audit`;
    console.log(`[gov-interact] audit ${auditPath}`);
    await gotoProjectPage(page, baseUrl, auditPath);
    await page.getByTestId('audit__filters').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('audit__table').waitFor({ state: 'visible', timeout: 10_000 });

    // Usage: filters and table visible.
    const usagePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`;
    console.log(`[gov-interact] usage ${usagePath}`);
    await gotoProjectPage(page, baseUrl, usagePath);
    await page.getByTestId('usage__filters').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('usage__table').waitFor({ state: 'visible', timeout: 10_000 });

    console.log('[gov-interact] OK');
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
