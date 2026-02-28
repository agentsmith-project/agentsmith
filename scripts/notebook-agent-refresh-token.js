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

  async function fetchTokenByPasswordGrant() {
    const tokenUrl = `${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('client_id', clientId);
    body.set('username', username);
    body.set('password', password);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`password_grant_failed_http_${response.status}`);
    }
    const data = await response.json();
    const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
    if (!accessToken) {
      throw new Error('password_grant_missing_access_token');
    }
    return accessToken;
  }

  async function fetchTokenByAuthCodeExchange(code, codeVerifier, redirect) {
    const tokenUrl = `${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('code', code);
    body.set('code_verifier', codeVerifier);
    body.set('redirect_uri', redirect);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`auth_code_exchange_failed_http_${response.status}`);
    }
    const data = await response.json();
    const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
    if (!accessToken) {
      throw new Error('auth_code_exchange_missing_access_token');
    }
    return accessToken;
  }

  const shouldUsePasswordGrantOnly = process.env.REFRESH_TOKEN_FORCE_PASSWORD_GRANT === '1';
  if (shouldUsePasswordGrantOnly) {
    const token = await fetchTokenByPasswordGrant();
    fs.writeFileSync(outFile, token, 'utf8');
    if (process.env.PRINT_TOKEN === '1') {
      process.stdout.write(`${token}\n`);
    } else {
      process.stdout.write(`[refresh-token] token written to ${outFile}\n`);
    }
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
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

    async function fetchTokenByAuthCodeFlow() {
      await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const usernameField = page.locator('input#username, input[name="username"], input[name="email"]').first();
      const passwordField = page.locator('input#password, input[name="password"]').first();
      const submitButton = page.locator('#kc-login, button[type="submit"]').first();
      if (!(await usernameField.isVisible().catch(() => false))) {
        throw new Error('auth_code_flow_login_form_not_visible');
      }
      await usernameField.fill(username);
      await passwordField.fill(password);
      await Promise.all([
        page.waitForURL(new RegExp(`/${locale}/login/callback\\?`), { timeout: 120_000 }),
        submitButton.click(),
      ]);
      const callback = new URL(page.url());
      const code = callback.searchParams.get('code');
      if (!code) {
        throw new Error('auth_code_flow_missing_code');
      }
      return fetchTokenByAuthCodeExchange(code, verifier, redirectUri);
    }

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
        page.waitForURL(new RegExp(`/${locale}/(login/workspace|login/callback)`), { timeout: 120_000 }),
        loginButtonLocator.click(),
      ]);
      dbg('post-login redirect landed', page.url());
      if (new RegExp(`/${locale}/login/callback`).test(page.url())) {
        await page.goto(`${baseUrl.replace(/\/+$/, '')}/${locale}/login/workspace`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
      }
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
      const cardVisible = await workspaceCard.isVisible().catch(() => false);
      if (cardVisible) {
        await workspaceCard.click();
        await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 60_000 });
      } else {
        await page.goto(`${baseUrl.replace(/\/+$/, '')}/${locale}/workspaces/ws_default/projects`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 60_000 });
      }
      dbg('workspace selected', page.url());
    } else {
      dbg('already in ws_default route', page.url());
    }

    const readTokenFromPage = async () => page.evaluate(() => {
      const storeToken = window.__MBOS_AUTH_STORE__?.getState?.()?.token;
      if (typeof storeToken === 'string' && storeToken.length > 0) {
        return storeToken;
      }
      const raw = localStorage.getItem('agentsmith-auth');
      if (!raw) return null;
      try {
        return JSON.parse(raw)?.state?.token ?? null;
      } catch {
        return null;
      }
    });

    let token = await readTokenFromPage();
    if (!token) {
      // Real backend mode does not persist auth to localStorage; wait for store hydration/callback sync.
      const deadline = Date.now() + 30_000;
      while (!token && Date.now() < deadline) {
        await page.waitForTimeout(500);
        token = await readTokenFromPage();
        if (token) break;

        const currentUrl = page.url();
        if (new RegExp(`/${locale}/login/workspace`).test(currentUrl)) {
          await page.goto(`${baseUrl.replace(/\/+$/, '')}/${locale}/workspaces/ws_default/projects`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          }).catch(() => {});
        }
      }
    }
    if (!token) {
      dbg('token_not_found_in_app_state, trying auth code exchange fallback');
      try {
        token = await fetchTokenByAuthCodeFlow();
        dbg('auth code exchange fallback succeeded');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dbg('auth code exchange fallback failed, trying password grant', message);
        try {
          token = await fetchTokenByPasswordGrant();
          dbg('password grant fallback succeeded');
        } catch (passwordError) {
          const passwordMessage = passwordError instanceof Error ? passwordError.message : String(passwordError);
          throw new Error(`token_not_found; auth_code_fallback_failed: ${message}; password_grant_fallback_failed: ${passwordMessage}`);
        }
      }
    }
    fs.writeFileSync(outFile, token, 'utf8');
    if (process.env.PRINT_TOKEN === '1') {
      process.stdout.write(`${token}\n`);
    } else {
      process.stdout.write(`[refresh-token] token written to ${outFile}\n`);
    }
  } finally {
    await browser.close().catch(() => {});
    dbg('browser closed');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
