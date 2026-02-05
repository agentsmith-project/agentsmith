import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MSWProvider } from '../MSWProvider';

const originalUseMsw = process.env.NEXT_PUBLIC_USE_MSW;

const initMSW = vi.fn();

vi.mock('@/mocks/browser', () => ({
  initMSW: (...args: unknown[]) => initMSW(...args),
}));

describe('MSWProvider', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_USE_MSW = originalUseMsw;
    initMSW.mockReset();
  });

  it('waits for MSW to initialize before rendering children', async () => {
    process.env.NEXT_PUBLIC_USE_MSW = 'true';
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
});
