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
  // Avoid reading OS-level USERNAME/PASSWORD variables implicitly.
  // Use dedicated env names for integration credentials.
  const username = process.env.MBOS_DEV_USERNAME || process.env.INTEGRATION_DEV_ADMIN_USERNAME || 'dev-admin';
  const password = process.env.MBOS_DEV_PASSWORD || process.env.INTEGRATION_DEV_ADMIN_PASSWORD || 'dev-admin-123';
  const outFile = process.env.TOKEN_OUT_FILE || '/tmp/agentsmith_user_token.txt';
  const shouldReadAppSession = process.env.REFRESH_TOKEN_READ_APP_SESSION === '1';

  async function fetchSessionByPasswordGrant() {
    const tokenUrl = `${keycloakBase.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('client_id', clientId);
    body.set('username', username);
    body.set('password', password);
    body.set('scope', 'openid profile email');

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
    return {
      accessToken,
      refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : null,
      expiresIn: typeof data?.expires_in === 'number' ? data.expires_in : null,
    };
  }

  async function fetchSessionByAuthCodeExchange(code, codeVerifier, redirect) {
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
    return {
      accessToken,
      refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : null,
      expiresIn: typeof data?.expires_in === 'number' ? data.expires_in : null,
    };
  }

  const shouldUsePasswordGrantOnly = process.env.REFRESH_TOKEN_FORCE_PASSWORD_GRANT === '1';
  if (shouldUsePasswordGrantOnly) {
    const session = await fetchSessionByPasswordGrant();
    fs.writeFileSync(outFile, session.accessToken, 'utf8');
    if (process.env.PRINT_SESSION_JSON === '1') {
      process.stdout.write(`${JSON.stringify({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_in: session.expiresIn,
      })}\n`);
      return;
    }
    if (process.env.PRINT_TOKEN === '1') {
      process.stdout.write(`${session.accessToken}\n`);
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
      dbg('opened auth url', page.url());

      const usernameField = page.locator('input#username, input[name="username"], input[name="email"]').first();
      const passwordField = page.locator('input#password, input[name="password"]').first();
      const submitButton = page.locator('#kc-login, button[type="submit"]').first();
      const callbackPattern = new RegExp(`/${locale}/login/callback\\?`);
      const deadline = Date.now() + 30_000;
      let authState = 'unknown';

      while (Date.now() < deadline) {
        if (callbackPattern.test(page.url())) {
          authState = 'callback';
          break;
        }
        if (await usernameField.isVisible().catch(() => false)) {
          authState = 'login_form';
          break;
        }
        await page.waitForTimeout(250);
      }

      if (authState === 'login_form') {
        await usernameField.fill(username);
        await passwordField.fill(password);
        await Promise.all([
          page.waitForURL(callbackPattern, { timeout: 120_000 }),
          submitButton.click(),
        ]);
      } else if (authState !== 'callback') {
        throw new Error(`auth_code_flow_unresolved current_url=${page.url()}`);
      }

      const callback = new URL(page.url());
      const code = callback.searchParams.get('code');
      if (!code) {
        throw new Error('auth_code_flow_missing_code');
      }
      return fetchSessionByAuthCodeExchange(code, verifier, redirectUri);
    }

    async function fetchSessionFromAppStorage() {
      await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      dbg('opened auth url for app session', page.url());

      const usernameField = page.locator('input#username, input[name="username"], input[name="email"]').first();
      const passwordField = page.locator('input#password, input[name="password"]').first();
      const submitButton = page.locator('#kc-login, button[type="submit"]').first();
      const workspacePattern = new RegExp(`/${locale}/login/workspace(?:\\?|$)`);
      const projectsPattern = new RegExp(`/${locale}/workspaces/[^/]+/projects(?:\\?|$)`);
      const callbackPattern = new RegExp(`/${locale}/login/callback(?:\\?|$)`);

      await usernameField.waitFor({ state: 'visible', timeout: 30_000 });
      await usernameField.fill(username);
      await passwordField.fill(password);
      await Promise.all([
        page.waitForURL((url) => (
          workspacePattern.test(url.href)
          || projectsPattern.test(url.href)
          || callbackPattern.test(url.href)
        ), { timeout: 120_000 }),
        submitButton.click(),
      ]);

      if (callbackPattern.test(page.url())) {
        await page.waitForURL((url) => workspacePattern.test(url.href) || projectsPattern.test(url.href), {
          timeout: 120_000,
        });
      }

      const token = await page.evaluate(() => {
        const raw = localStorage.getItem('agentsmith-auth');
        if (!raw) return '';
        try {
          const parsed = JSON.parse(raw);
          return typeof parsed?.state?.token === 'string'
            ? parsed.state.token
            : typeof parsed?.token === 'string'
              ? parsed.token
              : '';
        } catch {
          return '';
        }
      });

      if (!token) {
        throw new Error('app_session_missing_token');
      }

      return {
        accessToken: token,
        refreshToken: null,
        expiresIn: null,
      };
    }

    let session = null;
    try {
      if (shouldReadAppSession) {
        session = await fetchSessionFromAppStorage();
        dbg('app session token read succeeded');
      } else {
        session = await fetchTokenByAuthCodeFlow();
        dbg('auth code exchange succeeded');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dbg('primary token fetch failed, trying password grant', message);
      try {
        session = await fetchSessionByPasswordGrant();
        dbg('password grant fallback succeeded');
      } catch (passwordError) {
        const passwordMessage = passwordError instanceof Error ? passwordError.message : String(passwordError);
        throw new Error(`token_not_found; primary_fetch_failed: ${message}; password_grant_fallback_failed: ${passwordMessage}`);
      }
    }
    fs.writeFileSync(outFile, session.accessToken, 'utf8');
    if (process.env.PRINT_SESSION_JSON === '1') {
      process.stdout.write(`${JSON.stringify({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_in: session.expiresIn,
      })}\n`);
      return;
    }
    if (process.env.PRINT_TOKEN === '1') {
      process.stdout.write(`${session.accessToken}\n`);
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
