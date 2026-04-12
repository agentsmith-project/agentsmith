import { describe, expect, it, vi } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

import WorkspacesRoute from '../page';

describe('WorkspacesRoute', () => {
  it('redirects to the workspace overview canonical path', async () => {
    await WorkspacesRoute({
      params: Promise.resolve({ locale: 'en-US' }),
    });

    expect(mockRedirect).toHaveBeenCalledWith('/en-US/workspaces/overview');
  });
});
