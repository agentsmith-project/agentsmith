import { Page } from '@playwright/test';
import { gotoAndWait, waitForPageReady } from '../utils/navigation';
import { createMockAuthToken } from '@/mocks/utils/mock-auth-token';

const DEFAULT_WS_ID = 'ws_default';
const DEFAULT_USER_EMAIL = 'test@example.com';
const DEFAULT_USER_ID = 'user_001';
const LOGIN_PATH_REGEX = /^\/(en-US|zh-CN)\/login(?:\/workspace)?\/?$/;
const AUTH_RECOVERY_PATH_REGEX = /^\/(en-US|zh-CN)\/(?:login(?:\/workspace)?|workspaces\/overview)\/?$/;
const PROTECTED_ROUTE_REGEX = /^\/(en-US|zh-CN)\/(?:user|workspaces)\//;

type MockAuthSeed = {
  wsId: string;
  userEmail: string;
  userId: string;
  token: string;
  refreshToken: string;
  tokenExpiresAt: number;
  issuedAt: number;
  seedRevision: number;
  user: {
    id: string;
    email: string;
    name: string;
    locale: 'en-US';
  };
};

type MockAuthFallback = {
  wsId?: string;
  userEmail?: string;
  userId?: string;
};

type MockAuthContext = {
  wsId?: string;
  userEmail?: string;
  userId?: string;
  token?: string;
};

type MockAuthSnapshot = {
  context: MockAuthContext | null;
  storageState: {
    user?: {
      id?: string;
      email?: string;
    } | null;
    token?: string | null;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    isAuthenticated?: boolean;
  } | null;
  storeState: {
    user?: {
      id?: string;
      email?: string;
    } | null;
    token?: string | null;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    isAuthenticated?: boolean;
  } | null;
};

let mockAuthSeedSequence = 0;

function createAuthSeed(wsId: string, userEmail: string, userId: string): MockAuthSeed {
  const issuedAt = Date.now();
  mockAuthSeedSequence += 1;
  const token = createMockAuthToken({
    userId,
    userEmail,
    issuedAt,
  });
  return {
    wsId,
    userEmail,
    userId,
    token,
    refreshToken: `mock_refresh_${issuedAt}`,
    tokenExpiresAt: issuedAt + 60 * 60 * 1000,
    issuedAt,
    seedRevision: issuedAt * 1000 + mockAuthSeedSequence,
    user: {
      id: userId,
      email: userEmail,
      name: userEmail.split('@')[0],
      locale: 'en-US',
    },
  };
}

function isAppDocumentUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

function isAuthRecoveryPath(pathname: string): boolean {
  return AUTH_RECOVERY_PATH_REGEX.test(pathname);
}

function applyAuthSeed(seed: MockAuthSeed) {
  const e2eWindow = window as typeof window & {
    __MBOS_AUTH_E2E_SEED_ISSUED_AT__?: number;
  };
  const currentSeedRevision = e2eWindow.__MBOS_AUTH_E2E_SEED_ISSUED_AT__;
  if (typeof currentSeedRevision === 'number' && currentSeedRevision > seed.seedRevision) {
    return;
  }

  e2eWindow.__MBOS_AUTH_E2E_SEED_ISSUED_AT__ = seed.seedRevision;
  window.__MBOS_AUTH_SETUP__ = true;
  window.__MBOS_AUTH_E2E_CONTEXT__ = {
    wsId: seed.wsId,
    userEmail: seed.userEmail,
    userId: seed.userId,
    token: seed.token,
  };

  try {
    localStorage.setItem('agentsmith-auth', JSON.stringify({
      state: {
        user: seed.user,
        token: seed.token,
        refreshToken: seed.refreshToken,
        tokenExpiresAt: seed.tokenExpiresAt,
        isAuthenticated: true,
      },
      version: 0,
    }));
  } catch {
    // Verification in the fixture turns this into an explicit auth_seed_failed error.
  }

  const trySetAuth = () => {
    const authStore = window.__MBOS_AUTH_STORE__;
    if (!authStore || typeof authStore.getState !== 'function') {
      return false;
    }
    const state = authStore.getState();
    if (typeof state.setAuth === 'function') {
      state.setAuth(seed.user, seed.token, {
        refreshToken: seed.refreshToken,
        expiresIn: Math.max(1, Math.floor((seed.tokenExpiresAt - Date.now()) / 1000)),
      });
    }
    return true;
  };

  if (!trySetAuth()) {
    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      if (trySetAuth() || attempts > 100) {
        window.clearInterval(interval);
      }
    }, 50);
  }
}

async function readMockAuthSnapshot(page: Page): Promise<MockAuthSnapshot> {
  return page.evaluate(() => {
    let storageState: MockAuthSnapshot['storageState'] = null;
    try {
      const raw = window.localStorage.getItem('agentsmith-auth');
      const parsed = raw ? JSON.parse(raw) as { state?: MockAuthSnapshot['storageState'] } : null;
      storageState = parsed?.state ?? null;
    } catch {
      storageState = null;
    }

    const state = window.__MBOS_AUTH_STORE__?.getState();
    return {
      context: window.__MBOS_AUTH_E2E_CONTEXT__ ?? null,
      storageState,
      storeState: state
        ? {
            user: state.user,
            token: state.token,
            refreshToken: state.refreshToken,
            tokenExpiresAt: state.tokenExpiresAt,
            isAuthenticated: state.isAuthenticated,
          }
        : null,
    };
  });
}

function describeAuthSnapshot(snapshot: MockAuthSnapshot): string {
  return JSON.stringify({
    context: snapshot.context
      ? {
          wsId: snapshot.context.wsId,
          userEmail: snapshot.context.userEmail,
          userId: snapshot.context.userId,
          hasToken: typeof snapshot.context.token === 'string' && snapshot.context.token.length > 0,
        }
      : null,
    storageState: snapshot.storageState
      ? {
          userId: snapshot.storageState.user?.id,
          userEmail: snapshot.storageState.user?.email,
          hasToken: typeof snapshot.storageState.token === 'string' && snapshot.storageState.token.length > 0,
          isAuthenticated: snapshot.storageState.isAuthenticated,
        }
      : null,
    storeState: snapshot.storeState
      ? {
          userId: snapshot.storeState.user?.id,
          userEmail: snapshot.storeState.user?.email,
          hasToken: typeof snapshot.storeState.token === 'string' && snapshot.storeState.token.length > 0,
          isAuthenticated: snapshot.storeState.isAuthenticated,
        }
      : null,
  });
}

async function verifyAuthSeed(
  page: Page,
  expected: MockAuthSeed | MockAuthContext,
  options: {
    requireStore?: boolean;
    timeout?: number;
    label?: string;
  } = {},
): Promise<void> {
  const requireStore = options.requireStore ?? false;
  const timeout = options.timeout ?? 3_000;
  const expectedToken = expected.token;
  const expectedUserId = expected.userId;
  const expectedUserEmail = expected.userEmail;
  const expectedWsId = expected.wsId;

  if (!expectedToken || !expectedUserId || !expectedUserEmail) {
    throw new Error(`auth_seed_failed:${options.label ?? 'verify'}:missing_expected_context`);
  }

  try {
    await page.waitForFunction(
      ({ requireStore, token, userEmail, userId, wsId }) => {
        const context = window.__MBOS_AUTH_E2E_CONTEXT__;
        let storageState: {
          user?: {
            id?: string;
            email?: string;
          } | null;
          token?: string | null;
          isAuthenticated?: boolean;
        } | null = null;
        try {
          const raw = window.localStorage.getItem('agentsmith-auth');
          const parsed = raw ? JSON.parse(raw) as { state?: typeof storageState } : null;
          storageState = parsed?.state ?? null;
        } catch {
          storageState = null;
        }
        const storeState = window.__MBOS_AUTH_STORE__?.getState();
        const contextOk = context?.token === token
          && context.userId === userId
          && context.userEmail === userEmail
          && (!wsId || context.wsId === wsId);
        const storageOk = storageState?.isAuthenticated === true
          && storageState.token === token
          && storageState.user?.id === userId
          && storageState.user?.email === userEmail;
        const storeOk = storeState?.isAuthenticated === true
          && storeState.token === token
          && storeState.user?.id === userId
          && storeState.user?.email === userEmail;
        return contextOk && storageOk && (!requireStore || storeOk);
      },
      {
        requireStore,
        token: expectedToken,
        userEmail: expectedUserEmail,
        userId: expectedUserId,
        wsId: expectedWsId,
      },
      { timeout },
    );
  } catch (error) {
    const snapshot = await readMockAuthSnapshot(page).catch(() => null);
    const details = snapshot ? describeAuthSnapshot(snapshot) : 'snapshot_unavailable';
    throw new Error(
      `auth_seed_failed:${options.label ?? 'verify'}:${error instanceof Error ? error.message : String(error)};snapshot=${details}`,
    );
  }
}

async function readMockAuthContext(page: Page): Promise<MockAuthContext | null> {
  return page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__ ?? null).catch(() => null);
}

function hasCompleteAuthContext(
  ctx: MockAuthContext | null,
): ctx is MockAuthContext & { token: string; userEmail: string; userId: string } {
  return Boolean(ctx?.token && ctx.userEmail && ctx.userId);
}

async function reseedAuth(page: Page, fallback: MockAuthFallback): Promise<MockAuthSeed> {
  const ctx = await readMockAuthContext(page);
  return withAuth(
    page,
    ctx?.wsId || fallback.wsId || DEFAULT_WS_ID,
    ctx?.userEmail || fallback.userEmail || DEFAULT_USER_EMAIL,
    ctx?.userId || fallback.userId || DEFAULT_USER_ID,
  );
}

export async function ensureProtectedRouteAuthenticated(
  page: Page,
  targetPath: string,
  fallback: MockAuthFallback = {},
  options: {
    label?: string;
    maxRecoveries?: number;
  } = {},
): Promise<void> {
  const label = options.label ?? 'protected_route';
  const maxRecoveries = options.maxRecoveries ?? 3;

  for (let attempt = 0; attempt <= maxRecoveries; attempt += 1) {
    const currentPath = new URL(page.url()).pathname;
    if (isAuthRecoveryPath(currentPath)) {
      if (attempt >= maxRecoveries) {
        throw new Error(
          `protected_route_redirected_to_workspace_selection:${label}:target=${targetPath};actual=${page.url()}`,
        );
      }
      await reseedAuth(page, fallback);
      await gotoAndWait(page, targetPath);
      await waitForPageReady(page);
      continue;
    }

    const ctx = await readMockAuthContext(page);
    if (!hasCompleteAuthContext(ctx)) {
      if (attempt >= maxRecoveries) {
        throw new Error(`auth_seed_failed:${label}:missing_expected_context`);
      }
      await reseedAuth(page, fallback);
      await gotoAndWait(page, targetPath);
      await waitForPageReady(page);
      continue;
    }
    try {
      await verifyAuthSeed(page, ctx, {
        requireStore: true,
        timeout: 3_500,
        label,
      });
      return;
    } catch (error) {
      const latestPath = new URL(page.url()).pathname;
      if (isAuthRecoveryPath(latestPath)) {
        if (attempt >= maxRecoveries) {
          throw new Error(
            `protected_route_redirected_to_workspace_selection:${label}:target=${targetPath};actual=${page.url()}`,
          );
        }
        await reseedAuth(page, fallback);
        await gotoAndWait(page, targetPath);
        await waitForPageReady(page);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `protected_route_redirected_to_workspace_selection:${label}:target=${targetPath};actual=${page.url()}`,
  );
}

export async function withAuth(
  page: Page,
  wsId = DEFAULT_WS_ID,
  userEmail = DEFAULT_USER_EMAIL,
  userId = DEFAULT_USER_ID,
): Promise<MockAuthSeed> {
  const seed = createAuthSeed(wsId, userEmail, userId);

  // 1) Ensure every future document gets auth pre-seeded before app bootstraps.
  await page.addInitScript(applyAuthSeed, seed);

  // 2) Also seed auth for the current document immediately (if already on app origin),
  // so first-round queries don't race and trigger session recovery redirects.
  try {
    await page.evaluate(applyAuthSeed, seed);
  } catch (error) {
    if (isAppDocumentUrl(page.url())) {
      throw new Error(
        `auth_seed_failed:current_document:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (isAppDocumentUrl(page.url())) {
    await verifyAuthSeed(page, seed, {
      requireStore: false,
      timeout: 1_000,
      label: 'current_document',
    });
  }

  return seed;
}

export async function readMockAuthTokenFromContext(page: Page): Promise<string | null> {
  const token = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__?.token ?? null).catch(() => null);
  return typeof token === 'string' && token.trim().length > 0 ? token : null;
}

export async function ensureAuthenticatedSession(
  page: Page,
  bootstrapPath: string,
  fallback: MockAuthFallback = {},
): Promise<void> {
  let bootstrapError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await gotoAndWait(page, bootstrapPath);
      await waitForPageReady(page);
      bootstrapError = null;
      break;
    } catch (error) {
      bootstrapError = error;
      if (page.isClosed()) {
        throw error;
      }
      if (attempt < 2) {
        await page.waitForTimeout(500 * (attempt + 1));
      }
    }
  }

  if (bootstrapError) {
    throw bootstrapError;
  }

  if (!PROTECTED_ROUTE_REGEX.test(new URL(bootstrapPath, 'http://example.test').pathname)) {
    return;
  }

  if (LOGIN_PATH_REGEX.test(new URL(page.url()).pathname)) {
    await reseedAuth(page, fallback);
    await gotoAndWait(page, bootstrapPath);
    await waitForPageReady(page);
  }

  await ensureProtectedRouteAuthenticated(page, bootstrapPath, fallback, {
    label: 'bootstrap',
  });
}
