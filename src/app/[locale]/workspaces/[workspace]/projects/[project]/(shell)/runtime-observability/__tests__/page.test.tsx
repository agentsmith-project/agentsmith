import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RuntimeObservabilityPage from '../page';

let permissionFn: (permission?: string) => boolean = () => true;
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useSearchParams: () => mockSearchParams,
  };
});

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission?: string) => permissionFn(permission),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/runtime/RuntimeObservabilityConsole', () => ({
  RuntimeObservabilityConsole: () => <div data-testid="runtime-observability__console" />,
}));

describe('RuntimeObservabilityPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionFn = () => true;
    mockSearchParams.forEach((_value, key) => mockSearchParams.delete(key));
  });

  it('renders runtime observability for valid params and permission', async () => {
    render(
      <RuntimeObservabilityPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('runtime-observability__console')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks usage permission', async () => {
    permissionFn = () => false;
    render(
      <RuntimeObservabilityPage
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
      <RuntimeObservabilityPage
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
