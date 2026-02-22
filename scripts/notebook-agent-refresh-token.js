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

async function main() {
  const debug = process.env.DEBUG_REFRESH_TOKEN === '1';
  const dbg = (...args) => {
    if (debug) console.error('[refresh-token]', ...args);
  };
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const keycloakBase = process.env.KEYCLOAK_BASE_URL || 'http://localhost:18080';
  const realm = process.env.KEYCLOAK_REALM || 'mbos';
  const clientId = process.env.KEYCLOAK_CLIENT_ID || 'agentsmith';
  const locale = process.env.LOCALE || 'zh-CN';
  const username = process.env.USERNAME || 'dev-admin';
  const password = process.env.PASSWORD || 'dev-admin-123';
  const outFile = process.env.TOKEN_OUT_FILE || '/tmp/agentsmith_user_token.txt';

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(24));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = `${baseUrl.replace(/\/+$/, '')}/${locale}/login/callback`;

  await page.goto(`${baseUrl.replace(/\/+$/, '')}/${locale}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  dbg('opened login page', page.url());

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
  dbg('opened auth url', page.url());
  const usernameLocator = page.locator('input#username, input[name="username"], input[name="email"]').first();
  const passwordLocator = page.locator('input#password, input[name="password"]').first();
  const loginButtonLocator = page.locator('#kc-login, button[type="submit"]').first();

  let authPageState = 'unknown';
  const authWaitDeadline = Date.now() + 30_000;
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
    dbg('manual login required');
    await usernameLocator.fill(username);
    await passwordLocator.fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 120_000 }),
      loginButtonLocator.click(),
    ]);
  } else if (authPageState === 'app_redirect') {
    dbg('login form not visible, waiting for app route redirect', page.url());
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
    dbg('redirected to app route', page.url());
  } else {
    if (debug) {
      let html = '';
      try {
        html = (await page.content()).slice(0, 2000);
      } catch {}
      dbg('auth unresolved diagnostics', {
        url: page.url(),
        title: await page.title().catch(() => ''),
        html,
      });
    }
    throw new Error(`auth_state_unresolved current_url=${page.url()}`);
  }

  if (!new RegExp(`/${locale.replace('-', '\\-')}/workspaces/ws_default(?:/.*)?$`).test(page.url())) {
    dbg('not in ws_default route, selecting workspace card', page.url());
    const workspaceCard = page.getByTestId('workspace-select__card--ws_default');
    await workspaceCard.waitFor({ state: 'visible', timeout: 30_000 });
    await workspaceCard.click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 60_000 });
    dbg('workspace selected', page.url());
  } else {
    dbg('already in ws_default route', page.url());
  }

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('agentsmith-auth');
    if (!raw) return null;
    try {
      return JSON.parse(raw)?.state?.token ?? null;
    } catch {
      return null;
    }
  });

  await browser.close();
  dbg('browser closed');

  if (!token) {
    throw new Error('token_not_found');
  }
  fs.writeFileSync(outFile, token, 'utf8');
  process.stdout.write(`${token}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
