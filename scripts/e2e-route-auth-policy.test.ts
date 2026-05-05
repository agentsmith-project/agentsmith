import { describe, expect, it } from 'vitest';
import {
  isE2EAuthRecoveryPath,
  isE2ELoginPath,
  isE2EProtectedRoute,
} from '../e2e/fixtures/route-auth-policy';

describe('e2e auth route policy', () => {
  it('treats workspace overview as an auth recovery directory entry instead of protected work', () => {
    expect(isE2EAuthRecoveryPath('/en-US/workspaces/overview')).toBe(true);
    expect(isE2EAuthRecoveryPath('/zh-CN/workspaces/overview/')).toBe(true);
    expect(isE2EProtectedRoute('/en-US/workspaces/overview')).toBe(false);
    expect(isE2EProtectedRoute('/zh-CN/workspaces/overview/')).toBe(false);
  });

  it('keeps workspace business routes protected', () => {
    expect(isE2EProtectedRoute('/en-US/workspaces/ws_default')).toBe(true);
    expect(isE2EProtectedRoute('/en-US/workspaces/ws_default/login')).toBe(true);
    expect(isE2EProtectedRoute('/en-US/workspaces/ws_default/projects')).toBe(true);
    expect(isE2EProtectedRoute('/en-US/workspaces/ws_default/projects/proj_001/agent-tasks')).toBe(true);
    expect(isE2EAuthRecoveryPath('/en-US/workspaces/ws_default/login')).toBe(false);
    expect(isE2EAuthRecoveryPath('/en-US/workspaces/ws_default/projects')).toBe(false);
  });

  it('keeps login and workspace-selection recovery routes public to protected verification', () => {
    expect(isE2ELoginPath('/en-US/login')).toBe(true);
    expect(isE2ELoginPath('/en-US/login/workspace')).toBe(true);
    expect(isE2EAuthRecoveryPath('/en-US/login')).toBe(true);
    expect(isE2EAuthRecoveryPath('/en-US/login/workspace')).toBe(true);
    expect(isE2EProtectedRoute('/en-US/login')).toBe(false);
    expect(isE2EProtectedRoute('/en-US/login/workspace')).toBe(false);
  });
});
