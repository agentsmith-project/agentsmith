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
  if (!fs.existsSync(path)) {
    throw new Error(`missing_file:${path}`);
  }
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

  const authWaitDeadline = Date.now() + 30_000;
  let authPageState = 'unknown';
  while (Date.now() < authWaitDeadline) {
    if (page.url().includes(`/${locale}/`)) {
      authPageState = 'app_redirect';
      break;
    }
    if (await usernameLocator.isVisible().catch(() => false)) {
      authPageState = 'login_form';
      break;
    }
    await page.waitForTimeout(500);
  }

  if (authPageState === 'login_form') {
    await usernameLocator.fill(username);
    await passwordLocator.fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 120_000 }),
      loginButtonLocator.click(),
    ]);
  } else if (authPageState === 'app_redirect') {
    await page.waitForURL(
      (url) => {
        try {
          return url.pathname.startsWith(`/${locale}/`);
        } catch {
          return false;
        }
      },
      { timeout: 120_000 },
    );
  } else {
    throw new Error(`auth_state_unresolved current_url=${page.url()}`);
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
  console.log(`[gov-smoke] fallback to projectId file value: ${fallbackProjectId}`);
  return fallbackProjectId;
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
  const fallbackProjectId = fs.readFileSync(projectIdFile, 'utf8').trim();
  if (!fallbackProjectId) throw new Error(`empty_project_id:${projectIdFile}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const failures = [];
  const checks = [
    {
      name: 'members',
      path: `/${locale}/workspaces/${workspaceId}/projects/${projectId}/members`,
      testids: [],
      testidsAny: ['members__search-input', 'members__table', 'members__groups-section', 'page-state__error'],
    },
    {
      name: 'resource-policy',
      path: `/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`,
      testids: ['resource-policy__table', 'resource-policy__editor'],
    },
    {
      name: 'audit',
      path: `/${locale}/workspaces/${workspaceId}/projects/${projectId}/audit`,
      testids: ['audit__filters'],
    },
    {
      name: 'usage',
      path: `/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`,
      testids: ['usage__filters'],
    },
  ];

  try {
    console.log('[gov-smoke] login via keycloak...');
    await loginWithKeycloak({
      page, baseUrl, locale, keycloakBase, realm, clientId, username, password,
    });
    const projectId = await resolveAccessibleProjectId({
      page,
      baseUrl,
      locale,
      workspaceId,
      fallbackProjectId,
    });
    console.log(`[gov-smoke] using project ${projectId}`);

    for (const check of checks) {
      const url = `${baseUrl.replace(/\/+$/, '')}${check.path}`;
      console.log(`[gov-smoke] checking ${check.name}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      // Treat the stale-project screen as a failure with a clearer message.
      const staleProject = await page.getByTestId('project-shell__stale-project').isVisible().catch(() => false);
      if (staleProject) {
        failures.push(`${check.name}: stale project (local in-memory backend reset)`);
        continue;
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
          failures.push(`${check.name}: missing any testid ${check.testidsAny.join('|')}`);
          continue;
        }
      }

      for (const tid of check.testids) {
        try {
          await page.getByTestId(tid).waitFor({ state: 'visible', timeout: 20_000 });
        } catch {
          failures.push(`${check.name}: missing testid ${tid}`);
          break;
        }
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
