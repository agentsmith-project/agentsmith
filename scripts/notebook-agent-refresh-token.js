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
  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
  await page.locator('input#password, input[name="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 120_000 }),
    page.locator('#kc-login, button[type="submit"]').first().click(),
  ]);

  const workspaceCard = page.getByTestId('workspace-select__card--ws_default');
  await workspaceCard.waitFor({ state: 'visible', timeout: 30_000 });
  await workspaceCard.click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 60_000 });

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

