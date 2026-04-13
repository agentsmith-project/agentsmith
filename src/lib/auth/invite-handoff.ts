type InviteHandoffOptions = {
  projectId?: string | null;
  desktopAuthRequestId?: string | null;
};

export type InviteHandoffContinuation = {
  workspaceId: string;
  projectId: string;
  desktopAuthRequestId?: string;
  storedAt: number;
};

type PendingInviteToken = {
  inviteToken: string;
  storedAt: number;
};

type LogoutIntent = {
  storedAt: number;
};

const INVITE_HANDOFF_STORAGE_KEY = 'agentsmith:invite-handoff';
const INVITE_HANDOFF_STORAGE_TTL_MS = 30 * 60 * 1000;
const PENDING_INVITE_STORAGE_KEY = 'agentsmith:pending-invite';
const PENDING_INVITE_STORAGE_TTL_MS = 30 * 60 * 1000;
const LOGOUT_INTENT_STORAGE_KEY = 'agentsmith:logout-intent';
const LOGOUT_INTENT_TTL_MS = 2 * 60 * 1000;

function hasWindowStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

function localePrefix(locale?: string | null): string {
  return locale ? `/${locale}` : '';
}

function buildQuerySuffix(options?: InviteHandoffOptions): string {
  const params = new URLSearchParams();
  const projectId = options?.projectId?.trim();
  const desktopAuthRequestId = options?.desktopAuthRequestId?.trim();
  if (projectId) {
    params.set('project_id', projectId);
  }
  if (desktopAuthRequestId) {
    params.set('desktop_auth_request_id', desktopAuthRequestId);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function isInviteHandoffContinuation(value: unknown): value is InviteHandoffContinuation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InviteHandoffContinuation>;
  return (
    typeof candidate.workspaceId === 'string'
    && candidate.workspaceId.trim().length > 0
    && typeof candidate.projectId === 'string'
    && candidate.projectId.trim().length > 0
    && typeof candidate.storedAt === 'number'
  );
}

function isPendingInviteToken(value: unknown): value is PendingInviteToken {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingInviteToken>;
  return (
    typeof candidate.inviteToken === 'string'
    && candidate.inviteToken.trim().length > 0
    && typeof candidate.storedAt === 'number'
  );
}

export function buildWorkspaceSelectionPath(options?: InviteHandoffOptions): string {
  return `/login/workspace${buildQuerySuffix(options)}`;
}

export function buildWorkspaceSelectionHref(locale: string | null | undefined, options?: InviteHandoffOptions): string {
  return `${localePrefix(locale)}${buildWorkspaceSelectionPath(options)}`;
}

export function isWorkspaceSelectionPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /^\/(en-US|zh-CN)\/login\/workspace\/?$/.test(pathname);
}

type WorkspaceSelectionRedirectGuard = {
  href: string;
  requestedAt: number;
};

const WORKSPACE_SELECTION_REDIRECT_GUARD_TTL_MS = 2_000;
let workspaceSelectionRedirectGuard: WorkspaceSelectionRedirectGuard | null = null;

export function requestWorkspaceSelectionRedirectHref(
  locale: string | null | undefined,
  pathname: string | null | undefined,
): string | null {
  const href = buildWorkspaceSelectionHref(locale);
  if (isWorkspaceSelectionPath(pathname)) {
    workspaceSelectionRedirectGuard = null;
    return null;
  }

  const now = Date.now();
  if (
    workspaceSelectionRedirectGuard
    && workspaceSelectionRedirectGuard.href === href
    && now - workspaceSelectionRedirectGuard.requestedAt < WORKSPACE_SELECTION_REDIRECT_GUARD_TTL_MS
  ) {
    return null;
  }

  workspaceSelectionRedirectGuard = {
    href,
    requestedAt: now,
  };
  return href;
}

export function persistLogoutIntent(): void {
  if (!hasWindowStorage()) return;
  try {
    window.sessionStorage.setItem(
      LOGOUT_INTENT_STORAGE_KEY,
      JSON.stringify({ storedAt: Date.now() }),
    );
  } catch {
    // Ignore storage failures.
  }
}

export function readLogoutIntent(): LogoutIntent | null {
  if (!hasWindowStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(LOGOUT_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<LogoutIntent>;
    if (typeof candidate.storedAt !== 'number') return null;
    if (Date.now() - candidate.storedAt > LOGOUT_INTENT_TTL_MS) {
      window.sessionStorage.removeItem(LOGOUT_INTENT_STORAGE_KEY);
      return null;
    }
    return { storedAt: candidate.storedAt };
  } catch {
    return null;
  }
}

export function hasActiveLogoutIntent(): boolean {
  return readLogoutIntent() !== null;
}

export function clearLogoutIntent(): void {
  if (!hasWindowStorage()) return;
  try {
    window.sessionStorage.removeItem(LOGOUT_INTENT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function buildWorkspaceLoginPath(workspaceId: string, options?: InviteHandoffOptions): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/login${buildQuerySuffix(options)}`;
}

export function buildWorkspaceLoginHref(
  locale: string | null | undefined,
  workspaceId: string,
  options?: InviteHandoffOptions,
): string {
  return `${localePrefix(locale)}${buildWorkspaceLoginPath(workspaceId, options)}`;
}

export function buildWorkspaceLoginLandingPath(workspaceId: string, projectId?: string | null): string {
  const targetProjectId = projectId?.trim();
  if (targetProjectId) {
    return `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(targetProjectId)}/overview`;
  }
  return `/workspaces/${encodeURIComponent(workspaceId)}/projects`;
}

export function buildWorkspaceLoginLandingHref(
  locale: string | null | undefined,
  workspaceId: string,
  projectId?: string | null,
): string {
  return `${localePrefix(locale)}${buildWorkspaceLoginLandingPath(workspaceId, projectId)}`;
}

export function buildInviteInspectPath(token: string): string {
  return `/join/invites/${encodeURIComponent(token.trim())}`;
}

export function buildInviteInspectHref(locale: string | null | undefined, token: string): string {
  return `${localePrefix(locale)}${buildInviteInspectPath(token)}`;
}

export function persistInviteHandoff(args: {
  workspaceId?: string | null;
  projectId?: string | null;
  desktopAuthRequestId?: string | null;
}): void {
  if (!hasWindowStorage()) return;
  const workspaceId = args.workspaceId?.trim();
  const projectId = args.projectId?.trim();
  const desktopAuthRequestId = args.desktopAuthRequestId?.trim();
  if (!workspaceId || !projectId) {
    clearInviteHandoff();
    return;
  }
  try {
    window.sessionStorage.setItem(
      INVITE_HANDOFF_STORAGE_KEY,
      JSON.stringify({
        workspaceId,
        projectId,
        desktopAuthRequestId: desktopAuthRequestId || undefined,
        storedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage failures and fall back to query-only handoff.
  }
}

export function readInviteHandoff(): InviteHandoffContinuation | null {
  if (!hasWindowStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(INVITE_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isInviteHandoffContinuation(parsed)) return null;
    if (Date.now() - parsed.storedAt > INVITE_HANDOFF_STORAGE_TTL_MS) {
      window.sessionStorage.removeItem(INVITE_HANDOFF_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearInviteHandoff(): void {
  if (!hasWindowStorage()) return;
  try {
    window.sessionStorage.removeItem(INVITE_HANDOFF_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function readInviteHandoffForWorkspace(workspaceId: string): InviteHandoffContinuation | null {
  const handoff = readInviteHandoff();
  if (!handoff) {
    return null;
  }
  if (handoff.workspaceId !== workspaceId) {
    clearInviteHandoff();
    return null;
  }
  return handoff;
}

export function clearLoginContinuationState(): void {
  clearInviteHandoff();
  clearPendingInviteToken();
}

export function persistPendingInviteToken(inviteToken: string): void {
  if (!hasWindowStorage()) return;
  const trimmed = inviteToken.trim();
  if (!trimmed) {
    clearPendingInviteToken();
    return;
  }
  try {
    window.sessionStorage.setItem(
      PENDING_INVITE_STORAGE_KEY,
      JSON.stringify({
        inviteToken: trimmed,
        storedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage failures.
  }
}

export function readPendingInviteToken(): string | null {
  if (!hasWindowStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isPendingInviteToken(parsed)) return null;
    if (Date.now() - parsed.storedAt > PENDING_INVITE_STORAGE_TTL_MS) {
      window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
      return null;
    }
    return parsed.inviteToken;
  } catch {
    return null;
  }
}

export function consumePendingInviteToken(): string | null {
  const token = readPendingInviteToken();
  if (token) {
    clearPendingInviteToken();
  }
  return token;
}

export function clearPendingInviteToken(): void {
  if (!hasWindowStorage()) return;
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
