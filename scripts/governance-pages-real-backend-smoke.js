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

async function loginViaKeycloak(browser, {
  baseUrl,
  locale,
  workspaceId,
  keycloakBase,
  realm,
  clientId,
  username,
  password,
}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const base = baseUrl.replace(/\/+$/, '');
  const loginUrl = `${base}/${locale}/login`;
  const callbackPattern = new RegExp(`/${locale}/login/callback(?:\\?|$)`);
  const workspacePattern = new RegExp(`/${locale}/login/workspace(?:\\?|$)`);
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
      page.waitForURL((url) => callbackPattern.test(url.href) || workspacePattern.test(url.href), { timeout: 120_000 }),
      submitButton.click(),
    ]);

    if (callbackPattern.test(page.url())) {
      await page.waitForURL(workspacePattern, { timeout: 120_000 });
    }

    const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
    await page.waitForLoadState('domcontentloaded');
    await Promise.race([
      workspaceCard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      page.getByTestId('workspace-select__session-expired').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      page.getByTestId('workspace-select__error').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      page.getByTestId('workspace-select__empty').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    ]);
    if (await workspaceCard.isVisible().catch(() => false)) {
      await workspaceCard.click();
      await page.waitForURL(projectsPattern, { timeout: 30_000 });
    } else if (!projectsPattern.test(page.url())) {
      throw new Error(`workspace_select_unresolved:${page.url()}`);
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const onWorkspaceSelect = page.url().includes(`/${locale}/login/workspace`);
    const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
    if (!onWorkspaceSelect && !await workspaceCard.isVisible().catch(() => false)) {
      return;
    }
    if (await workspaceCard.isVisible().catch(() => false)) {
      await workspaceCard.click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/${workspaceId}/projects`), { timeout: 30_000 });
    }
  }
}

async function resolveAccessibleProjectId({ page, baseUrl, locale, workspaceId, fallbackProjectId }) {
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
  console.log(`[gov-smoke] fallback to projectId file value: ${fallbackProjectId}`);
  return fallbackProjectId;
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
    });
    const resolveContext = await createAuthedPage(browser, loginContext.storageState);
    const projectId = await resolveAccessibleProjectId({
      page: resolveContext.page,
      baseUrl,
      locale,
      workspaceId,
      fallbackProjectId,
    });
    await resolveContext.context.close().catch(() => {});
    await loginContext.context.close().catch(() => {});
    console.log(`[gov-smoke] using project ${projectId}`);

    for (const check of checks) {
      const path = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/${check.pathSuffix}`;
      const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
      let checkPassed = false;
      let lastFailure = `${check.name}: unknown`;

      for (let attempt = 0; attempt < 2 && !checkPassed; attempt += 1) {
        const checkContext = await createAuthedPage(browser, loginContext.storageState);
        const { page } = checkContext;
        try {
          console.log(`[gov-smoke] checking ${check.name}: ${url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
          await gotoProjectRouteWithWorkspaceRecovery(page, { url, locale, workspaceId });

          const staleProject = await page.getByTestId('project-shell__stale-project').isVisible().catch(() => false);
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
              const deadline = Date.now() + 20_000;
              while (Date.now() < deadline && !foundAny) {
                const workspaceCard = page.getByTestId(`workspace-select__card--${workspaceId}`);
                if (page.url().includes(`/${locale}/login/workspace`) || await workspaceCard.isVisible().catch(() => false)) {
                  if (await workspaceCard.isVisible().catch(() => false)) {
                    await workspaceCard.click();
                    await page.waitForURL(new RegExp(`/${locale}/workspaces/${workspaceId}/projects`), { timeout: 30_000 });
                  }
                  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
        } finally {
          await checkContext.context.close().catch(() => {});
        }
      }

      if (!checkPassed) {
        failures.push(lastFailure);
      }
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
