import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInviteInspectHref,
  buildInviteInspectPath,
  buildWorkspaceLoginHref,
  buildWorkspaceLoginLandingHref,
  buildWorkspaceSelectionHref,
  clearLogoutIntent,
  hasActiveLogoutIntent,
  persistLogoutIntent,
  requestWorkspaceSelectionRedirectHref,
  clearInviteHandoff,
  clearLoginContinuationState,
  clearPendingInviteToken,
  consumePendingInviteToken,
  persistInviteHandoff,
  persistPendingInviteToken,
  readInviteHandoff,
  readInviteHandoffForWorkspace,
  readPendingInviteToken,
} from '../invite-handoff';

describe('invite-handoff route builders', () => {
  it('keeps invite handoff hrefs locale-aware and query-preserving', () => {
    expect(buildInviteInspectPath('invite_token')).toBe('/join/invites/invite_token');
    expect(buildInviteInspectHref('en-US', 'invite_token')).toBe('/en-US/join/invites/invite_token');
    expect(buildWorkspaceSelectionHref('en-US', { projectId: 'proj_alpha' })).toBe('/en-US/login/workspace?project_id=proj_alpha');
    expect(buildWorkspaceLoginHref('en-US', 'ws_alpha', { projectId: 'proj_alpha' })).toBe('/en-US/workspaces/ws_alpha/login?project_id=proj_alpha');
    expect(buildWorkspaceLoginLandingHref('en-US', 'ws_alpha', 'proj_alpha')).toBe('/en-US/workspaces/ws_alpha/projects/proj_alpha/overview');
  });


  it('deduplicates workspace selection redirects while the login transition is already in flight', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    expect(requestWorkspaceSelectionRedirectHref('en-US', '/en-US/workspaces/ws_alpha/overview')).toBe('/en-US/login/workspace');
    now.mockReturnValue(1200);
    expect(requestWorkspaceSelectionRedirectHref('en-US', '/en-US/workspaces/ws_alpha/overview')).toBeNull();
    now.mockReturnValue(4000);
    expect(requestWorkspaceSelectionRedirectHref('en-US', '/en-US/workspaces/ws_alpha/overview')).toBe('/en-US/login/workspace');

    now.mockRestore();
  });

  it('tracks deliberate logout intent as a terminal transition and can clear it explicitly', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    persistLogoutIntent();
    expect(hasActiveLogoutIntent()).toBe(true);

    clearLogoutIntent();
    expect(hasActiveLogoutIntent()).toBe(false);

    now.mockRestore();
  });

  it('treats security-restricted sessionStorage as unavailable instead of throwing', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });

    try {
      expect(hasActiveLogoutIntent()).toBe(false);
      expect(() => persistLogoutIntent()).not.toThrow();
      expect(() => clearLogoutIntent()).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(window, 'sessionStorage', original);
      }
    }
  });

});

describe('invite-handoff session continuation', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal(
      'sessionStorage',
      ({
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      } as unknown) as Storage,
    );
    clearInviteHandoff();
  });

  it('persists and reads continuation state from session storage', () => {
    persistInviteHandoff({ workspaceId: 'ws_alpha', projectId: 'proj_alpha' });
    expect(readInviteHandoff()).toMatchObject({
      workspaceId: 'ws_alpha',
      projectId: 'proj_alpha',
    });
  });

  it('only returns invite handoff state for the matching workspace and clears stale handoff for other workspaces', () => {
    persistInviteHandoff({ workspaceId: 'ws_alpha', projectId: 'proj_alpha' });

    expect(readInviteHandoffForWorkspace('ws_beta')).toBeNull();
    expect(readInviteHandoff()).toBeNull();

    persistInviteHandoff({ workspaceId: 'ws_alpha', projectId: 'proj_alpha' });
    expect(readInviteHandoffForWorkspace('ws_alpha')).toMatchObject({
      workspaceId: 'ws_alpha',
      projectId: 'proj_alpha',
    });
  });

  it('clears both invite handoff and pending invite token when resetting login continuation state', () => {
    persistInviteHandoff({ workspaceId: 'ws_alpha', projectId: 'proj_alpha' });
    persistPendingInviteToken('invite_token');

    clearLoginContinuationState();

    expect(readInviteHandoff()).toBeNull();
    expect(readPendingInviteToken()).toBeNull();
  });

  it('persists and consumes pending invite tokens from session storage', () => {
    persistPendingInviteToken('invite_token');
    expect(readPendingInviteToken()).toBe('invite_token');
    expect(consumePendingInviteToken()).toBe('invite_token');
    expect(readPendingInviteToken()).toBeNull();
    clearPendingInviteToken();
  });
});
