import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InvestigationAnchorBar } from '../InvestigationAnchorBar';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('InvestigationAnchorBar', () => {
  it('renders compact embedded chrome without a card shell', () => {
    render(
      <InvestigationAnchorBar
        compact
        requestId="req_1"
        traceSource="trace_source"
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByTestId('investigation-anchor__bar').className).not.toMatch(/rounded-md|border|bg-bg-base/);
    expect(screen.getByTestId('investigation-anchor__clear')).toBeInTheDocument();
  });
});
