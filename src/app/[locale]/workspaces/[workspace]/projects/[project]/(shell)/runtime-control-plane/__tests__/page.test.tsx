import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RuntimeControlPlanePage from '../page';

let permissionFn: (permission?: string) => boolean = () => true;

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission?: string) => permissionFn(permission),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/settings/RuntimeControlPlanePanel', () => ({
  RuntimeControlPlanePanel: () => <div data-testid="runtime-cp__panel" />,
}));

vi.mock('@/components/runtime/RuntimeObservabilityConsole', () => ({
  RuntimeObservabilityConsole: () => <div data-testid="runtime-cp__observability-console" />,
}));

describe('RuntimeControlPlanePage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionFn = () => true;
  });

  it('renders runtime control plane for valid params and permission', async () => {
    render(
      <RuntimeControlPlanePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('runtime-cp__panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('runtime-cp__observability-console')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks manage permission', async () => {
    permissionFn = () => false;
    render(
      <RuntimeControlPlanePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(
      <RuntimeControlPlanePage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
