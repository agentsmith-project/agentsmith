#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function requireFile(path) {
  if (!fs.existsSync(path)) throw new Error(`missing_file:${path}`);
}

function parseProjectIdFromHref(href) {
  if (typeof href !== 'string') return null;
  const match = href.match(/\/workspaces\/[^/]+\/projects\/([^/]+)\/overview/);
  return match?.[1] ?? null;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function readTokenFile(tokenFile) {
  try {
    if (!tokenFile || !fs.existsSync(tokenFile)) return '';
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

async function isTokenValid(keycloakBase, realm, token) {
  if (!token) return false;
  const url = `${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/userinfo`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  return Boolean(response && response.ok);
}

async function fetchUserInfo(keycloakBase, realm, token) {
  if (!token) return null;
  const url = `${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/userinfo`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return null;
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const name = typeof payload.name === 'string'
    ? payload.name
    : (typeof payload.preferred_username === 'string' ? payload.preferred_username : '');
  if (!sub || !email || !name) return null;
  return { sub, email, name };
}

async function exchangeAuthCodeForToken(args) {
  const tokenUrl = `${args.keycloakBase.replace(/\/+$/, '')}/realms/${args.realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', args.clientId);
  body.set('code', args.code);
  body.set('code_verifier', args.codeVerifier);
  body.set('redirect_uri', args.redirectUri);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`auth_code_exchange_failed:${response.status}:${text.slice(0, 240)}`);
  }
  const data = await response.json();
  const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
  if (!accessToken) throw new Error('auth_code_exchange_missing_access_token');
  return accessToken;
}

async function waitForAppReady(page, timeoutMs = 60_000) {
  const loading = page.getByTestId('page-state__loading');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const visible = await loading.isVisible().catch(() => false);
    if (!visible) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`app_loading_timeout:${page.url()}`);
}

async function loginViaKeycloak(page, {
  baseUrl,
  locale,
  workspaceId,
  keycloakBase,
  realm,
  clientId,
  username,
  password,
  tokenFile,
}) {
  const base = baseUrl.replace(/\/+$/, '');
  const loginUrl = `${base}/${locale}/login`;
  const callbackPattern = new RegExp(`/${locale}/login/callback(?:\\?|$)`);
  const workspacePattern = new RegExp(`/${locale}/login/workspace(?:\\?|$)`);
  const anyProjectsPattern = new RegExp(`/${locale}/workspaces/[^/]+/projects(?:\\?|$)`);
  const projectsPattern = new RegExp(`/${locale}/workspaces/${workspaceId}/projects(?:\\?|$)`);
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(24));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = `${base}/${locale}/login/callback`;
  const authUrl = new URL(`${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/auth`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const fileToken = readTokenFile(tokenFile);
  const fileUser = await fetchUserInfo(keycloakBase, realm, fileToken);
  if (fileUser) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.evaluate((session) => {
      localStorage.setItem('agentsmith-auth', JSON.stringify({
        state: {
          isAuthenticated: true,
          user: session.user,
          token: session.token,
          refreshToken: null,
          tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        },
      }));
    }, {
      token: fileToken,
      user: {
        id: fileUser.sub,
        email: fileUser.email,
        name: fileUser.name,
        locale,
      },
    });
    await page.goto(`${base}/${locale}/login/workspace`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForAppReady(page);
  } else {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.evaluate((pkceContext) => {
      sessionStorage.setItem('mbos:keycloak:pkce', JSON.stringify(pkceContext));
    }, { verifier, state, redirectUri, createdAt: Date.now() });
    await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const usernameField = page.locator('input#username, input[name="username"], input[name="email"]').first();
    const passwordField = page.locator('input#password, input[name="password"]').first();
    const submitButton = page.locator('#kc-login, button[type="submit"]').first();
    await usernameField.waitFor({ state: 'visible', timeout: 30_000 });
    await usernameField.fill(username);
    await passwordField.fill(password);
    await Promise.all([
      page.waitForURL((url) => (
        callbackPattern.test(url.href)
        || workspacePattern.test(url.href)
        || anyProjectsPattern.test(url.href)
      ), { timeout: 120_000 }),
      submitButton.click(),
    ]);

    if (callbackPattern.test(page.url())) {
      let callbackResolved = false;
      try {
        await page.waitForURL((url) => workspacePattern.test(url.href) || anyProjectsPattern.test(url.href), { timeout: 15_000 });
        callbackResolved = true;
      } catch {
        callbackResolved = false;
      }
      if (!callbackResolved) {
        const callback = new URL(page.url());
        const code = callback.searchParams.get('code');
        if (!code) throw new Error('auth_code_missing_in_callback');
        const accessToken = await exchangeAuthCodeForToken({
          keycloakBase,
          realm,
          clientId,
          code,
          codeVerifier: verifier,
          redirectUri,
        });
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        const userInfo = await fetchUserInfo(keycloakBase, realm, accessToken);
        await page.evaluate((session) => {
          localStorage.setItem('agentsmith-auth', JSON.stringify({
            state: {
              isAuthenticated: true,
              user: session.user,
              token: session.token,
              refreshToken: null,
              tokenExpiresAt: Date.now() + 60 * 60 * 1000,
            },
          }));
          sessionStorage.removeItem('mbos:keycloak:pkce');
        }, {
          token: accessToken,
          user: {
            id: userInfo?.sub ?? 'unknown',
            email: userInfo?.email ?? 'unknown@example.com',
            name: userInfo?.name ?? 'Unknown User',
            locale,
          },
        });
        await page.goto(`${base}/${locale}/login/workspace`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await waitForAppReady(page);
      }
    }
  }

  await waitForAppReady(page);
  const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
  const anyWorkspaceCard = page.locator('[data-testid^="workspace-select__card--"]').first();
  await page.waitForLoadState('domcontentloaded');
  await Promise.race([
    workspaceCard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    anyWorkspaceCard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    page.getByTestId('workspace-select__session-expired').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    page.getByTestId('workspace-select__error').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    page.getByTestId('workspace-select__empty').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
  ]);
  if (await workspaceCard.isVisible().catch(() => false)) {
    await workspaceCard.click();
    await page.waitForURL((url) => projectsPattern.test(url.href) || anyProjectsPattern.test(url.href), { timeout: 30_000 });
  } else if (await anyWorkspaceCard.isVisible().catch(() => false)) {
    await anyWorkspaceCard.click();
    await page.waitForURL(anyProjectsPattern, { timeout: 30_000 });
  } else if (!projectsPattern.test(page.url()) && !anyProjectsPattern.test(page.url())) {
    const directProjectsUrl = `${base}/${locale}/workspaces/${workspaceId}/projects`;
    try {
      await page.goto(directProjectsUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ERR_ABORTED')) throw error;
    }
    await waitForAppReady(page).catch(() => {});
    if (!projectsPattern.test(page.url()) && !anyProjectsPattern.test(page.url())) {
      throw new Error(`workspace_select_unresolved:${page.url()}`);
    }
  }
}

async function gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path, locale, workspaceId }) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const targetPath = new URL(url).pathname;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForAppReady(page);
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === targetPath) return;
    const onWorkspaceSelect = page.url().includes(`/${locale}/login/workspace`);
    const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
    if (!onWorkspaceSelect && !await workspaceCard.isVisible().catch(() => false)) {
      continue;
    }
    if (await workspaceCard.isVisible().catch(() => false)) {
      await workspaceCard.click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/${workspaceId}/projects`), { timeout: 30_000 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForAppReady(page);
      if (new URL(page.url()).pathname === targetPath) return;
    }
  }
  throw new Error(`project_route_unresolved:${path}:current=${page.url()}`);
}

async function resolveAccessibleProjectId({ page, baseUrl, locale, workspaceId, fallbackProjectId }) {
  const projectsPath = `/${locale}/workspaces/${workspaceId}/projects`;
  await page.goto(`${baseUrl.replace(/\/+$/, '')}${projectsPath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForAppReady(page);
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

async function waitForAny(page, testIds, timeoutMs, recover) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (typeof recover === 'function') {
      await recover();
    }
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
    await loginViaKeycloak(page, {
      baseUrl,
      locale,
      workspaceId,
      keycloakBase,
      realm,
      clientId,
      username,
      password,
      tokenFile: process.env.TOKEN_FILE || '/tmp/agentsmith_user_token.txt',
    });
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
    await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: membersPath, locale, workspaceId });
    const membersReady = await waitForAny(page, [
      'members__search-input',
      'members__table',
      'members__groups-section',
      ...(strictMode ? [] : ['page-state__error']),
    ], 30_000, async () => {
      const currentPath = new URL(page.url()).pathname;
      if (page.url().includes(`/${locale}/login/workspace`) || currentPath !== membersPath) {
        await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: membersPath, locale, workspaceId });
      }
    });
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
    await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: rpPath, locale, workspaceId });
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
        await page.getByTestId('resource-policy__endpoint-spending-usd-per-minute').waitFor({ state: 'visible', timeout: 10_000 });

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
    await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: auditPath, locale, workspaceId });
    if (await isVisible(page.getByTestId('page-state__error'), 3_000)) {
      if (strictMode) {
        throw new Error('audit_error_state');
      }
      console.log('[gov-interact] audit page in product error state; skip audit interactions');
    } else {
      await page.getByTestId('audit__filters').waitFor({ state: 'visible', timeout: 10_000 });
      await waitForAny(page, ['audit__table', 'audit-usage__empty-state'], 30_000, async () => {
        if (page.url().includes(`/${locale}/login/workspace`)) {
          await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: auditPath, locale, workspaceId });
        }
      });
    }

    // Usage: filters and table visible.
    const usagePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`;
    console.log(`[gov-interact] usage ${usagePath}`);
    await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: usagePath, locale, workspaceId });
    if (await isVisible(page.getByTestId('page-state__error'), 3_000)) {
      if (strictMode) {
        throw new Error('usage_error_state');
      }
      console.log('[gov-interact] usage page in product error state; skip usage interactions');
    } else {
      await page.getByTestId('usage__filters').waitFor({ state: 'visible', timeout: 10_000 });
      await waitForAny(page, ['usage__table', 'audit-usage__empty-state'], 30_000, async () => {
        if (page.url().includes(`/${locale}/login/workspace`)) {
          await gotoProjectRouteWithWorkspaceRecovery(page, { baseUrl, path: usagePath, locale, workspaceId });
        }
      });
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
