import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInviteInspectHref,
  buildInviteInspectPath,
  buildWorkspaceLoginHref,
  buildWorkspaceLoginLandingHref,
  buildWorkspaceSelectionHref,
  clearInviteHandoff,
  clearPendingInviteToken,
  consumePendingInviteToken,
  persistInviteHandoff,
  persistPendingInviteToken,
  readInviteHandoff,
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

  it('persists and consumes pending invite tokens from session storage', () => {
    persistPendingInviteToken('invite_token');
    expect(readPendingInviteToken()).toBe('invite_token');
    expect(consumePendingInviteToken()).toBe('invite_token');
    expect(readPendingInviteToken()).toBeNull();
    clearPendingInviteToken();
  });
});
