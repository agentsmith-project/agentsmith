import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replaceMock = vi.fn();
let pathnameMock = '/en-US/workspaces/ws_1/projects/proj_chat/overview';
let paramsMock = { locale: 'en-US' as const };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathnameMock,
  useParams: () => paramsMock,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: () => true,
  useHasAllPermissions: () => true,
  useIsAuthenticated: () => false,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => true,
}));

vi.mock('@/lib/public-runtime-config', () => ({
  getPublicRuntimeConfig: () => ({ bypassAuth: false }),
}));

import { ProtectedRoute } from '../ProtectedRoute';

describe('ProtectedRoute', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pathnameMock = '/en-US/workspaces/ws_1/projects/proj_chat/overview';
    paramsMock = { locale: 'en-US' };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('redirects only once per logout transition even if pathname changes while auth is cleared', async () => {
    const { rerender } = render(
      <ProtectedRoute>
        <div>protected</div>
      </ProtectedRoute>,
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/en-US/login/workspace');

    pathnameMock = '/en-US/login/workspace';
    rerender(
      <ProtectedRoute>
        <div>protected</div>
      </ProtectedRoute>,
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
  });
});
