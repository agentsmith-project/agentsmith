import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EndpointsToolbar } from '../EndpointsToolbar';

vi.mock('@/components/layout/PageToolbar', () => ({
  PageToolbar: ({ children }: { children: React.ReactNode }) => <div data-testid="page-toolbar">{children}</div>,
}));

describe('EndpointsToolbar', () => {
  it('uses a quiet toolbar strip instead of card chrome', () => {
    render(
      <EndpointsToolbar
        canManageEndpoints
        canReadEndpoints
        endpointsCount={3}
        activeCount={2}
        disabledCount={1}
        syncPending={false}
        t={(key) => key}
        onCreate={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onSyncCatalog={vi.fn()}
      />,
    );

    expect(screen.getByTestId('endpoints__work-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('endpoints__summary-line')).toHaveTextContent('3 title');
    expect(screen.getByTestId('endpoints__summary-line').className).not.toMatch(/rounded-md|border|bg-/);
    expect(screen.queryByTestId('endpoints__count-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('endpoints__active-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('endpoints__disabled-pill')).not.toBeInTheDocument();
  });
});
