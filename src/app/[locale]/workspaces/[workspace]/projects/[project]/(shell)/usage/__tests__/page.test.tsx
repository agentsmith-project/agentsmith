import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import UsagePage from '../page';

const mockUseUsagePageCapabilities = vi.fn(() => ({ canRead: true }));
const mockUsagePageComponent = vi.fn((props: unknown) => (
  <div data-testid="usage-page-component" data-props={JSON.stringify(props)} />
));

vi.mock('@/components/audit-usage/UsagePage', () => ({
  UsagePage: (props: unknown) => mockUsagePageComponent(props),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useUsagePageCapabilities: () => mockUseUsagePageCapabilities(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user_001' } }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: () => ({ isLoading: false }),
}));

describe('UsagePage route', () => {
  beforeEach(() => {
    mockUseUsagePageCapabilities.mockClear();
    mockUseUsagePageCapabilities.mockReturnValue({ canRead: true });
    mockUsagePageComponent.mockClear();
  });

  it('shows permission error when usage token is missing', async () => {
    mockUseUsagePageCapabilities.mockReturnValue({ canRead: false });
    render(
      <UsagePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('passes route params and current user to usage component', async () => {
    render(
      <UsagePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(mockUsagePageComponent).toHaveBeenCalled();
    });

    const props = mockUsagePageComponent.mock.calls.at(-1)?.[0] as {
      workspaceId: string;
      projectId: string;
      locale: string;
      currentUserId: string;
      defaultEndUserId: string;
    };

    expect(props.workspaceId).toBe('ws_1');
    expect(props.projectId).toBe('proj_1');
    expect(props.locale).toBe('en');
    expect(props.currentUserId).toBe('user_001');
    expect(props.defaultEndUserId).toBe('user_001');
  });

  it('shows usage component when params are valid', async () => {
    render(
      <UsagePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('usage-page-component')).toBeInTheDocument();
    });
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(
      <UsagePage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
