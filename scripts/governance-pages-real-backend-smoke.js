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

  const failures = [];
  const checks = [
    {
      name: 'members',
      path: `/${locale}/workspaces/${workspaceId}/projects/${projectId}/members`,
      testids: ['members__search-input'],
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

