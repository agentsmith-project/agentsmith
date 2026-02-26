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

function parseProjectIdFromHref(href) {
  if (typeof href !== 'string') return null;
  const match = href.match(/\/workspaces\/[^/]+\/projects\/([^/]+)\/overview/);
  return match?.[1] ?? null;
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

async function resolveAccessibleProjectId({ page, baseUrl, locale, workspaceId, fallbackProjectId }) {
  try {
    const firstProjectId = await page.evaluate(async ({ baseUrl, workspaceId }) => {
      let token = '';
      try {
        const raw = localStorage.getItem('agentsmith-auth');
        const parsed = raw ? JSON.parse(raw) : null;
        token = parsed?.state?.token ? String(parsed.state.token) : '';
      } catch {}
      const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${workspaceId}/projects`, {
        method: 'GET',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) return null;
      const body = await resp.json().catch(() => null);
      if (!body || !Array.isArray(body.items)) return null;
      return typeof body.items[0]?.id === 'string' && body.items[0].id.length > 0
        ? body.items[0].id
        : null;
    }, { baseUrl, workspaceId });
    if (typeof firstProjectId === 'string' && firstProjectId.length > 0) return firstProjectId;
  } catch {
    // fallback below
  }
  const projectsPath = `/${locale}/workspaces/${workspaceId}/projects`;
  await page.goto(`${baseUrl.replace(/\/+$/, '')}${projectsPath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const foundFromLink = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/projects/"][href*="/overview"]'));
    for (const link of links) {
      const href = link.getAttribute('href');
      if (typeof href === 'string' && href.includes('/projects/')) return href;
    }
    return null;
  });
  const parsed = parseProjectIdFromHref(foundFromLink);
  if (parsed) return parsed;
  console.log(`[gov-interact] fallback to projectId file value: ${fallbackProjectId}`);
  return fallbackProjectId;
}

async function isVisible(locator, timeout = 0) {
  try {
    if (timeout > 0) {
      await locator.waitFor({ state: 'visible', timeout });
      return true;
    }
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function waitForAny(page, testIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const testId of testIds) {
      if (await isVisible(page.getByTestId(testId))) return testId;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`missing_any_testid:${testIds.join(',')}`);
}

async function main() {
  const smokeMode = process.env.GOVERNANCE_SMOKE_MODE === 'strict' ? 'strict' : 'tolerant';
  const strictMode = smokeMode === 'strict';
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
  const fallbackProjectId = fs.readFileSync(projectIdFile, 'utf8').trim();
  if (!fallbackProjectId) throw new Error(`empty_project_id:${projectIdFile}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    console.log('[gov-interact] login via keycloak...');
    console.log(`[gov-interact] mode=${smokeMode}`);
    await loginWithKeycloak({ page, baseUrl, locale, keycloakBase, realm, clientId, username, password });
    const projectId = await resolveAccessibleProjectId({
      page,
      baseUrl,
      locale,
      workspaceId,
      fallbackProjectId,
    });
    console.log(`[gov-interact] using project ${projectId}`);

    // Members: basic filter interactions and invite dialog UX (safe interaction).
    const membersPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/members`;
    console.log(`[gov-interact] members ${membersPath}`);
    await gotoProjectPage(page, baseUrl, membersPath);
    const membersReady = await waitForAny(page, [
      'members__search-input',
      'members__table',
      'members__groups-section',
      ...(strictMode ? [] : ['page-state__error']),
    ], 30_000);
    if (membersReady === 'page-state__error') {
      console.log('[gov-interact] members page in product error state; continue');
    } else if (membersReady === 'members__search-input') {
      await page.getByTestId('members__search-input').fill('dev');
      await page.getByTestId('members__role-filter').selectOption({ index: 0 });
      await page.getByTestId('members__status-filter').selectOption({ index: 0 });
      await page.getByTestId('members__filtered-count').waitFor({ state: 'visible', timeout: 10_000 });
    } else {
      console.log(`[gov-interact] members ready via ${membersReady}; skip people-tab filters`);
    }
    const inviteBtn = page.getByTestId('members__invite-btn');
    if (await isVisible(inviteBtn, 3_000)) {
      await inviteBtn.click();
      await page.getByTestId('members__invite-dialog').waitFor({ state: 'visible', timeout: 10_000 });
      await page.keyboard.press('Escape');
    } else {
      console.log('[gov-interact] members invite button not visible; continue with read-only interactions');
    }

    // Resource policy: open rows and check key governance inputs are present.
    const rpPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`;
    console.log(`[gov-interact] resource-policy ${rpPath}`);
    await gotoProjectPage(page, baseUrl, rpPath);
    const rpError = await isVisible(page.getByTestId('page-state__error'), 3_000);
    if (rpError) {
      if (strictMode) {
        throw new Error('resource-policy_error_state');
      }
      console.log('[gov-interact] resource-policy page in product error state; skip policy interactions');
    } else {
      const endpointRow = page.locator('[data-testid^="resource-policy__row--endpoint--"]').first();
      if (await isVisible(endpointRow, 5_000)) {
        await endpointRow.click();
        await page.getByTestId('resource-policy__editor').waitFor({ state: 'visible', timeout: 10_000 });
        await page.getByTestId('resource-policy__save').waitFor({ state: 'visible', timeout: 10_000 });
        await page.getByTestId('resource-policy__endpoint-requests-per-minute').waitFor({ state: 'visible', timeout: 10_000 });
        await page.getByTestId('resource-policy__endpoint-requests-per-day').waitFor({ state: 'visible', timeout: 10_000 });
        await page.getByTestId('resource-policy__endpoint-daily-token-limit').waitFor({ state: 'visible', timeout: 10_000 });

        const sourceLibraryRow = page.locator('[data-testid^="resource-policy__row--source_library--"]').first();
        if (await isVisible(sourceLibraryRow, 3_000)) {
          await sourceLibraryRow.click();
          await page.getByTestId('resource-policy__library-requests-per-minute').waitFor({ state: 'visible', timeout: 10_000 });
          await page.getByTestId('resource-policy__library-max-total-files').waitFor({ state: 'visible', timeout: 10_000 });
          await page.getByTestId('resource-policy__library-max-file-size-bytes').waitFor({ state: 'visible', timeout: 10_000 });
        } else {
          console.log('[gov-interact] no source_library row found; skip source-library rule checks');
        }

        const agentRow = page.locator('[data-testid^="resource-policy__row--agent--"]').first();
        if (await isVisible(agentRow, 3_000)) {
          await agentRow.click();
          await page.getByTestId('resource-policy__agent-requests-per-minute').waitFor({ state: 'visible', timeout: 10_000 });
        } else {
          console.log('[gov-interact] no agent row found; skip agent rule checks');
        }
      } else {
        if (strictMode) {
          throw new Error('resource-policy_missing_endpoint_row');
        }
        console.log('[gov-interact] no endpoint row found; skip resource-policy rule checks');
      }
    }

    // Audit: filters and table visible.
    const auditPath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/audit`;
    console.log(`[gov-interact] audit ${auditPath}`);
    await gotoProjectPage(page, baseUrl, auditPath);
    if (await isVisible(page.getByTestId('page-state__error'), 3_000)) {
      if (strictMode) {
        throw new Error('audit_error_state');
      }
      console.log('[gov-interact] audit page in product error state; skip audit interactions');
    } else {
      await page.getByTestId('audit__filters').waitFor({ state: 'visible', timeout: 10_000 });
      await waitForAny(page, ['audit__table', 'audit-usage__empty-state'], 30_000);
    }

    // Usage: filters and table visible.
    const usagePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`;
    console.log(`[gov-interact] usage ${usagePath}`);
    await gotoProjectPage(page, baseUrl, usagePath);
    if (await isVisible(page.getByTestId('page-state__error'), 3_000)) {
      if (strictMode) {
        throw new Error('usage_error_state');
      }
      console.log('[gov-interact] usage page in product error state; skip usage interactions');
    } else {
      await page.getByTestId('usage__filters').waitFor({ state: 'visible', timeout: 10_000 });
      await waitForAny(page, ['usage__table', 'audit-usage__empty-state'], 30_000);
    }

    console.log('[gov-interact] OK');
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
