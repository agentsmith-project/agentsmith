import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceLoginLandingHref as buildAppWorkspaceLoginLandingHref,
  buildWorkspaceLoginLandingPath as buildAppWorkspaceLoginLandingPath,
} from '../src/lib/auth/invite-handoff';
import {
  buildWorkspaceLoginLandingHref as buildSharedWorkspaceLoginLandingHref,
  buildWorkspaceLoginLandingPath as buildSharedWorkspaceLoginLandingPath,
} from '@mbos/contracts/src/auth-handoff-paths';

describe('verify invite handoff paths', () => {
  it('keeps the app invite handoff re-export in parity with the shared invite handoff landing route builders', () => {
    const cases = [
      {
        locale: 'en-US',
        workspaceId: 'ws_alpha',
        projectId: 'proj_alpha',
      },
      {
        locale: 'zh-CN',
        workspaceId: 'ws/alpha',
        projectId: 'proj beta',
      },
      {
        locale: 'en-US',
        workspaceId: 'ws_gamma',
        projectId: null,
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        buildAppWorkspaceLoginLandingPath(testCase.workspaceId, testCase.projectId),
      ).toBe(
        buildSharedWorkspaceLoginLandingPath(testCase.workspaceId, testCase.projectId),
      );
      expect(
        buildAppWorkspaceLoginLandingHref(testCase.locale, testCase.workspaceId, testCase.projectId),
      ).toBe(
        buildSharedWorkspaceLoginLandingHref(testCase.locale, testCase.workspaceId, testCase.projectId),
      );
    }
  });

  it('keeps the shared helper as the only invite handoff verify/import truth', () => {
    const appSource = readFileSync('src/lib/auth/invite-handoff.ts', 'utf8');

    expect(appSource).toContain("from '@mbos/contracts/src/auth-handoff-paths'");
    expect(appSource).not.toContain('export function buildWorkspaceLoginLandingPath');
    expect(appSource).not.toContain('export function buildWorkspaceLoginLandingHref');
    expect(existsSync('e2e/verify-invite-handoff-paths.ts')).toBe(false);
  });
});
