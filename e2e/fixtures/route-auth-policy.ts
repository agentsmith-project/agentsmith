const LOCALE_ROUTE_PREFIX = /^\/(?:en-US|zh-CN)(?:\/|$)/;
const LOGIN_PATH_REGEX = /^\/(?:en-US|zh-CN)\/login(?:\/workspace)?\/?$/;
const AUTH_RECOVERY_PATH_REGEX = /^\/(?:en-US|zh-CN)\/(?:login(?:\/workspace)?|workspaces\/overview)\/?$/;
const PROTECTED_USER_ROUTE_REGEX = /^\/(?:en-US|zh-CN)\/user(?:\/|$)/;
const PROTECTED_WORKSPACE_ROUTE_REGEX = /^\/(?:en-US|zh-CN)\/workspaces\/(?!overview(?:\/|$))[^/]+(?:\/.*)?$/;

export function getE2EAuthRoutePathname(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) {
    return new URL(pathOrUrl).pathname;
  }

  return new URL(pathOrUrl, 'http://example.test').pathname;
}

export function isE2ELoginPath(pathOrUrl: string): boolean {
  return LOGIN_PATH_REGEX.test(getE2EAuthRoutePathname(pathOrUrl));
}

export function isE2EAuthRecoveryPath(pathOrUrl: string): boolean {
  return AUTH_RECOVERY_PATH_REGEX.test(getE2EAuthRoutePathname(pathOrUrl));
}

export function isE2EProtectedRoute(pathOrUrl: string): boolean {
  const pathname = getE2EAuthRoutePathname(pathOrUrl);
  if (!LOCALE_ROUTE_PREFIX.test(pathname)) {
    return false;
  }

  if (isE2EAuthRecoveryPath(pathname)) {
    return false;
  }

  return PROTECTED_USER_ROUTE_REGEX.test(pathname) || PROTECTED_WORKSPACE_ROUTE_REGEX.test(pathname);
}
