import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useEndpointPageCapabilities } from '@/lib/hooks/use-permissions';
vi.mock('@/components/endpoints/EndpointsPage', () => ({
  EndpointsPageView: ({ params }: { params: Promise<{ workspace: string; project: string; locale: string }> }) => {
    const [state, setState] = React.useState<{ workspace: string; project: string; locale: string } | null>(null);
    React.useEffect(() => {
      params.then(setState);
    }, [params]);
    if (!state) {
      return <div data-testid="endpoints__route-loading" />;
    }
    return (
      <div data-testid="endpoints__route-view">
        {state.workspace}:{state.project}:{state.locale}
      </div>
    );
  },
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useEndpointPageCapabilities: vi.fn(() => ({
    canUse: true,
    canManage: true,
    canRead: true,
  })),
}));

import EndpointsPage from '../page';

const mockUseEndpointPageCapabilities = vi.mocked(useEndpointPageCapabilities);

describe('EndpointsPage', () => {
  it('renders header and toolbar layout', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: true, canManage: true, canRead: true });
    render(<EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />);

    await waitFor(() => {
      expect(screen.getByTestId('endpoints__route-view')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:prj_1:en-US')).toBeInTheDocument();
  });

  it('passes validated params through to the route view', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: true, canManage: true, canRead: true });
    render(<EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />);
    await waitFor(() => expect(screen.getByText('ws_1:prj_1:en-US')).toBeInTheDocument());
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: true, canManage: true, canRead: true });
    render(<EndpointsPage params={Promise.resolve({ workspace: '<script>', project: 'prj_1', locale: 'en-US' })} />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks read and governance access', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: false, canManage: false, canRead: false });
    render(<EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('allows governance managers to read endpoints even without invoke permission', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: false, canManage: true, canRead: true });
    render(<EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />);
    await waitFor(() => expect(screen.getByText('ws_1:prj_1:en-US')).toBeInTheDocument());
  });
});
