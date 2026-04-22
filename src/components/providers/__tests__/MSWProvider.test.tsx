import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MSWProvider } from '../MSWProvider';

const initMSW = vi.fn();
const getPublicRuntimeConfig = vi.fn();

vi.mock('@/mocks/browser', () => ({
  initMSW: (...args: unknown[]) => initMSW(...args),
}));

vi.mock('@/lib/public-runtime-config', () => ({
  getPublicRuntimeConfig: () => getPublicRuntimeConfig(),
}));

describe('MSWProvider', () => {
  beforeEach(() => {
    getPublicRuntimeConfig.mockReturnValue({
      useMsw: true,
      mswStrictReady: true,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    initMSW.mockReset();
    getPublicRuntimeConfig.mockReset();
  });

  it('waits for MSW to initialize before rendering children', async () => {
    let resolveInit: () => void;
    const initPromise = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    initMSW.mockReturnValueOnce(initPromise);

    render(
      <MSWProvider>
        <div data-testid="child">Child</div>
      </MSWProvider>,
    );

    expect(screen.queryByTestId('child')).toBeNull();

    resolveInit!();

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });
  });

  it('keeps children blocked and renders an error state when strict readiness is enabled and initMSW rejects', async () => {
    initMSW.mockRejectedValueOnce(new Error('mock bootstrap failed'));

    render(
      <MSWProvider>
        <div data-testid="child">Child</div>
      </MSWProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('allows children to render when strict readiness is disabled and initMSW rejects', async () => {
    getPublicRuntimeConfig.mockReturnValue({
      useMsw: true,
      mswStrictReady: false,
    });
    initMSW.mockRejectedValueOnce(new Error('mock bootstrap failed'));

    render(
      <MSWProvider>
        <div data-testid="child">Child</div>
      </MSWProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('page-state__error')).toBeNull();
  });
});
