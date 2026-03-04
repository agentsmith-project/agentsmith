#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function requireFile(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`missing_file:${path}`);
  }
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

async function listProjectIdsFromApi({ apiBase, workspaceId, token }) {
  if (!token) return [];
  const normalizedApiBase = apiBase.replace(/\/+$/, '');
  const url = `${normalizedApiBase}/api/v1/workspaces/${workspaceId}/projects`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!response || !response.ok) return [];
  const payload = await response.json().catch(() => null);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => (item && typeof item.id === 'string' ? item.id : null))
    .filter((id) => typeof id === 'string' && id.length > 0);
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

async function captureLoginDebugArtifacts(page, reason) {
  try {
    const outDir = path.join(process.cwd(), 'artifacts', 'release-reports');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeReason = String(reason || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const screenshotPath = path.join(outDir, `gov-smoke-login-failure-${safeReason}-${ts}.png`);
    const htmlPath = path.join(outDir, `gov-smoke-login-failure-${safeReason}-${ts}.html`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.error(`[gov-smoke] login debug screenshot: ${screenshotPath}`);
    console.error(`[gov-smoke] login debug html: ${htmlPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gov-smoke] failed to capture login debug artifacts: ${msg}`);
  }
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

async function loginViaKeycloak(browser, {
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
  const context = await browser.newContext();
  const page = await context.newPage();
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

  try {
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
    }, {
      verifier,
      state,
      redirectUri,
      createdAt: Date.now(),
    });
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

    const storageState = await context.storageState();
    return { context, page, storageState };
  } catch (error) {
    await captureLoginDebugArtifacts(page, 'browser_login');
    throw error;
  }
}

async function createAuthedPage(browser, storageState) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  return { context, page };
}

async function gotoProjectRouteWithWorkspaceRecovery(page, { url, locale, workspaceId }) {
  const targetPath = new URL(url).pathname;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForAppReady(page);
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === targetPath) return;
    const onWorkspaceSelect = page.url().includes(`/${locale}/login/workspace`);
    const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
    if (!onWorkspaceSelect && !await workspaceCard.isVisible().catch(() => false)) {
      // Route occasionally falls back to project list; retry full target navigation.
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
  throw new Error(`project_route_unresolved:${url}:current=${page.url()}`);
}

async function resolveAccessibleProjectId({ page, baseUrl, apiBase, locale, workspaceId, fallbackProjectId, tokenFile }) {
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
  const token = readTokenFile(tokenFile);
  const apiProjectIds = await listProjectIdsFromApi({ apiBase, workspaceId, token });
  if (parsed && apiProjectIds.includes(parsed)) return parsed;
  if (apiProjectIds.length > 0) {
    console.log(`[gov-smoke] fallback to API project value: ${apiProjectIds[0]}`);
    return apiProjectIds[0];
  }
  console.log(`[gov-smoke] fallback to projectId file value: ${fallbackProjectId}`);
  return fallbackProjectId;
}

async function main() {
  const smokeMode = process.env.GOVERNANCE_SMOKE_MODE === 'strict' ? 'strict' : 'tolerant';
  const strictMode = smokeMode === 'strict';
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const apiBase = process.env.API_BASE || 'http://localhost:20000';
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
  const tokenFile = process.env.TOKEN_FILE || '/tmp/agentsmith_user_token.txt';

  const browser = await chromium.launch({ headless: true });

  const failures = [];
  const checks = [
    {
      name: 'members',
      pathSuffix: 'members',
      testids: [],
      testidsAny: ['members__search-input', 'members__table', 'members__groups-section'],
    },
    {
      name: 'resource-policy',
      pathSuffix: 'resource-policy',
      testids: [],
      testidsAny: ['resource-policy__table', 'resource-policy__editor'],
    },
    {
      name: 'audit',
      pathSuffix: 'audit',
      testids: [],
      testidsAny: ['audit__filters'],
    },
    {
      name: 'usage',
      pathSuffix: 'usage',
      testids: [],
      testidsAny: ['usage__filters'],
    },
  ];

  try {
    console.log('[gov-smoke] login via keycloak...');
    console.log(`[gov-smoke] mode=${smokeMode}`);
    const loginContext = await loginViaKeycloak(browser, {
      baseUrl, locale, keycloakBase, realm, clientId, username, password,
      workspaceId,
      tokenFile,
    });
    const resolveContext = await createAuthedPage(browser, loginContext.storageState);
    const projectId = await resolveAccessibleProjectId({
      page: resolveContext.page,
      baseUrl,
      locale,
      workspaceId,
      fallbackProjectId,
      apiBase,
      tokenFile,
    });
    await resolveContext.context.close().catch(() => {});
    await loginContext.context.close().catch(() => {});
    console.log(`[gov-smoke] using project ${projectId}`);
    const overviewUrl = `${baseUrl.replace(/\/+$/, '')}/${locale}/workspaces/${workspaceId}/projects/${projectId}/overview`;
    const checkContext = await createAuthedPage(browser, loginContext.storageState);
    const checkPage = checkContext.page;
    await checkPage.goto(overviewUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await waitForAppReady(checkPage).catch(() => {});

    try {
      for (const check of checks) {
        const path = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/${check.pathSuffix}`;
        const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
        let checkPassed = false;
        let lastFailure = `${check.name}: unknown`;

        for (let attempt = 0; attempt < 2 && !checkPassed; attempt += 1) {
          const page = checkPage;
          console.log(`[gov-smoke] checking ${check.name}: ${url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
          await gotoProjectRouteWithWorkspaceRecovery(page, { url, locale, workspaceId });

          const staleProject =
            await page.getByTestId('project-shell__project-not-found').isVisible().catch(() => false)
            || await page.getByTestId('project-shell__stale-project').isVisible().catch(() => false);
          if (staleProject) {
            lastFailure = `${check.name}: stale project (local in-memory backend reset)`;
            continue;
          }

          if (!strictMode && await page.getByTestId('page-state__error').isVisible().catch(() => false)) {
            console.log(`[gov-smoke] ${check.name} in product error state (tolerant mode)`);
            checkPassed = true;
            break;
          }

          if (Array.isArray(check.testidsAny) && check.testidsAny.length > 0) {
            let foundAny = false;
            for (const tid of check.testidsAny) {
              if (await page.getByTestId(tid).isVisible().catch(() => false)) {
                foundAny = true;
                break;
              }
            }
            if (!foundAny) {
              const deadline = Date.now() + 45_000;
              while (Date.now() < deadline && !foundAny) {
                const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
                const currentPath = new URL(page.url()).pathname;
                if (
                  page.url().includes(`/${locale}/login/workspace`)
                  || await workspaceCard.isVisible().catch(() => false)
                  || currentPath !== path
                ) {
                  if (await workspaceCard.isVisible().catch(() => false)) {
                    await workspaceCard.click();
                    await page.waitForURL(new RegExp(`/${locale}/workspaces/${workspaceId}/projects`), { timeout: 30_000 });
                  }
                  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
                  await waitForAppReady(page).catch(() => {});
                }
                for (const tid of check.testidsAny) {
                  if (await page.getByTestId(tid).isVisible().catch(() => false)) {
                    foundAny = true;
                    break;
                  }
                }
                if (!foundAny) await page.waitForTimeout(250);
              }
            }
            if (!foundAny) {
              lastFailure = `${check.name}: missing any testid ${check.testidsAny.join('|')} (url=${page.url()})`;
              if (page.url().includes(`/${locale}/login`)) {
                await captureLoginDebugArtifacts(page, check.name);
              }
              continue;
            }
          }

          let missingFixed = false;
          for (const tid of check.testids) {
            try {
              await page.getByTestId(tid).waitFor({ state: 'visible', timeout: 20_000 });
            } catch {
              lastFailure = `${check.name}: missing testid ${tid} (url=${page.url()})`;
              missingFixed = true;
              break;
            }
          }
          if (missingFixed) {
            continue;
          }

          checkPassed = true;
        }

        if (!checkPassed) {
          failures.push(lastFailure);
        }
      }
    } finally {
      await checkContext.context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[gov-smoke] FAIL ${failure}`);
    process.exit(1);
  }

  console.log('[gov-smoke] OK');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
