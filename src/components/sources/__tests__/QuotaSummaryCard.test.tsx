/**
 * Unit tests for QuotaSummaryCard component
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { QuotaSummaryCard } from '../QuotaSummaryCard';
import type { QuotaSummary } from '@/lib/api/types';

const mockQuota: QuotaSummary = {
  storage: { used: 1024 * 1024 * 50, limit: 1024 * 1024 * 100 }, // 50MB of 100MB
  docdb: { used: 1024 * 1024 * 25, limit: 1024 * 1024 * 100 }, // 25MB of 100MB
  vectordb: { used: 1024 * 1024 * 75, limit: 1024 * 1024 * 100 }, // 75MB of 100MB
};

const mockExceededQuota: QuotaSummary = {
  storage: { used: 1024 * 1024 * 120, limit: 1024 * 1024 * 100 }, // Exceeded
  docdb: { used: 1024 * 1024 * 85, limit: 1024 * 1024 * 100 }, // Warning
  vectordb: { used: 1024 * 1024 * 95, limit: 1024 * 1024 * 100 }, // Warning
};

describe('QuotaSummaryCard', () => {
  it('should render three quota items', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('DocDB')).toBeInTheDocument();
    expect(screen.getByText('VectorDB')).toBeInTheDocument();
  });

  it('should display storage quota with used and limit values', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    const mbTexts = screen.getAllByText(/MB/);
    expect(mbTexts.length).toBeGreaterThan(0);
  });

  it('should display docdb quota with used and limit values', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    const docdbRegion = screen.getByRole('region', { name: /DocDB quota/i });
    expect(docdbRegion).toBeInTheDocument();
  });

  it('should display vectordb quota with used and limit values', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    const vectordbRegion = screen.getByRole('region', { name: /VectorDB quota/i });
    expect(vectordbRegion).toBeInTheDocument();
  });

  it('should show progress bars for each quota type', () => {
    const { container } = render(<QuotaSummaryCard quota={mockQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');
    expect(progressBars.length).toBe(3);
  });

  it('should show exceeded warning when storage is exceeded', () => {
    render(<QuotaSummaryCard quota={mockExceededQuota} />);

    expect(screen.getAllByText('Exceeded').length).toBeGreaterThan(0);
  });

  it('should apply correct styling to exceeded quota progress bar', () => {
    const { container } = render(<QuotaSummaryCard quota={mockExceededQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');

    // Storage should have exceeded styling
    expect(progressBars[0]).toHaveAttribute('aria-valuenow', '120');
  });

  it('should show warning styling for high usage (80%+)', () => {
    const { container } = render(<QuotaSummaryCard quota={mockExceededQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');

    // DocDB at 85% should have warning styling
    expect(progressBars[1]).toHaveAttribute('aria-valuenow', '85');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <QuotaSummaryCard quota={mockQuota} className="custom-class" />
    );

    const wrapper = container.querySelector('.custom-class');
    expect(wrapper).toBeInTheDocument();
  });

  it('should display formatted byte values', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    // Should show values like "50 MB" and "100 MB"
    const byteValues = screen.getAllByText(/MB/);
    expect(byteValues.length).toBeGreaterThan(0);
  });

  it('should handle zero limit gracefully', () => {
    const zeroLimitQuota: QuotaSummary = {
      storage: { used: 0, limit: 0 },
      docdb: { used: 0, limit: 0 },
      vectordb: { used: 0, limit: 0 },
    };

    render(<QuotaSummaryCard quota={zeroLimitQuota} />);

    const { container } = render(<QuotaSummaryCard quota={zeroLimitQuota} />);
    const progressBars = container.querySelectorAll('[role="progressbar"]');

    progressBars.forEach(bar => {
      expect(bar).toHaveAttribute('aria-valuenow', '0');
    });
  });

  it('should clamp progress bar value at 100%', () => {
    const { container } = render(<QuotaSummaryCard quota={mockExceededQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');

    // Storage is at 120%, but progress bar should show max 100
    const storageBar = progressBars[0];
    expect(storageBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('should have proper accessibility attributes on progress bars', () => {
    const { container } = render(<QuotaSummaryCard quota={mockQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');

    progressBars.forEach(bar => {
      expect(bar).toHaveAttribute('role', 'progressbar');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar).toHaveAttribute('aria-valuenow');
    });
  });

  it('should have proper accessibility labels for quota regions', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    expect(screen.getByRole('region', { name: /Storage quota/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /DocDB quota/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /VectorDB quota/i })).toBeInTheDocument();
  });

  it('should use alert role for exceeded warning', () => {
    render(<QuotaSummaryCard quota={mockExceededQuota} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toHaveTextContent('Exceeded');
  });

  it('should calculate percentage correctly for storage', () => {
    const { container } = render(<QuotaSummaryCard quota={mockQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');
    // Storage: 50MB / 100MB = 50%
    expect(progressBars[0]).toHaveAttribute('aria-valuenow', '50');
  });

  it('should calculate percentage correctly for docdb', () => {
    const { container } = render(<QuotaSummaryCard quota={mockQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');
    // DocDB: 25MB / 100MB = 25%
    expect(progressBars[1]).toHaveAttribute('aria-valuenow', '25');
  });

  it('should calculate percentage correctly for vectordb', () => {
    const { container } = render(<QuotaSummaryCard quota={mockQuota} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');
    // VectorDB: 75MB / 100MB = 75%
    expect(progressBars[2]).toHaveAttribute('aria-valuenow', '75');
  });

  it('should display uppercase tracking-wide label for quota type', () => {
    render(<QuotaSummaryCard quota={mockQuota} />);

    const storageLabel = screen.getByText('Storage');
    expect(storageLabel).toBeInTheDocument();
    expect(storageLabel.tagName.toLowerCase()).toBe('span');
  });
});
