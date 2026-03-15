import { describe, expect, it, vi } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

import LoginEntryPage from '../page';

describe('LoginEntryPage', () => {
  it('redirects the default login entry to workspace selection', async () => {
    await LoginEntryPage({ params: Promise.resolve({ locale: 'en-US' }) });

    expect(mockRedirect).toHaveBeenCalledWith('/en-US/login/workspace');
  });
});
