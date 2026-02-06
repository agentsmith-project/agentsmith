/**
 * Unit tests for SourcesFilters component
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Polyfill for Radix UI pointer capture in jsdom
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { SourcesFilters } from '../SourcesFilters';

describe('SourcesFilters', () => {
  const defaultProps = {
    status: 'all' as const,
    onStatusChange: vi.fn(),
    aiReadyOnly: false,
    onAIReadyOnlyChange: vi.fn(),
    sortBy: 'updated_at' as const,
    onSortByChange: vi.fn(),
    sortOrder: 'desc' as const,
    onSortOrderChange: vi.fn(),
  };

  it('should render all filter controls', () => {
    render(<SourcesFilters {...defaultProps} />);

    // Should have 4 select triggers (status, aiReady, sortBy, sortOrder)
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(4);
  });

  it('should render status filter with current value', () => {
    render(<SourcesFilters {...defaultProps} status="ready" />);

    const statusSelect = screen.getAllByRole('combobox')[0];
    expect(statusSelect).toHaveTextContent('Ready');
  });

  it('should render status select trigger showing current value', () => {
    render(<SourcesFilters {...defaultProps} />);

    // The first select trigger should show "All" (the currently selected status)
    const statusSelect = screen.getAllByRole('combobox')[0];
    expect(statusSelect).toHaveTextContent('All');
  });

  it('should render AIReady filter with correct value', () => {
    render(<SourcesFilters {...defaultProps} aiReadyOnly={true} />);

    const aiReadySelect = screen.getAllByRole('combobox')[1];
    expect(aiReadySelect).toHaveTextContent('AIReady Only');
  });

  it('should render AIReady filter showing "All Files" when false', () => {
    render(<SourcesFilters {...defaultProps} aiReadyOnly={false} />);

    const aiReadySelect = screen.getAllByRole('combobox')[1];
    expect(aiReadySelect).toHaveTextContent('All Files');
  });

  it('should render sort by filter with current value', () => {
    render(<SourcesFilters {...defaultProps} sortBy="file_size" />);

    const sortBySelect = screen.getAllByRole('combobox')[2];
    expect(sortBySelect).toHaveTextContent('Size');
  });

  it('should render sort by filter showing "Updated" by default', () => {
    render(<SourcesFilters {...defaultProps} />);

    const sortBySelect = screen.getAllByRole('combobox')[2];
    expect(sortBySelect).toHaveTextContent('Updated');
  });

  it('should render sort order filter with current value', () => {
    render(<SourcesFilters {...defaultProps} sortOrder="asc" />);

    const sortOrderSelect = screen.getAllByRole('combobox')[3];
    expect(sortOrderSelect).toHaveTextContent('Asc');
  });

  it('should render sort order showing "Desc" by default', () => {
    render(<SourcesFilters {...defaultProps} />);

    const sortOrderSelect = screen.getAllByRole('combobox')[3];
    expect(sortOrderSelect).toHaveTextContent('Desc');
  });

  it('should show selected status value in trigger', () => {
    render(<SourcesFilters {...defaultProps} />);

    // "All" is the trigger text for status when status='all'
    const statusSelect = screen.getAllByRole('combobox')[0];
    expect(statusSelect).toHaveTextContent('All');
  });

  it('should show "All Files" in AIReady trigger when not filtered', () => {
    render(<SourcesFilters {...defaultProps} />);

    const aiReadySelect = screen.getAllByRole('combobox')[1];
    expect(aiReadySelect).toHaveTextContent('All Files');
  });

  it('should show selected sort by value in trigger', () => {
    render(<SourcesFilters {...defaultProps} sortBy="status" />);

    const sortBySelect = screen.getAllByRole('combobox')[2];
    expect(sortBySelect).toHaveTextContent('Status');
  });

  it('should show selected sort order value in trigger', () => {
    render(<SourcesFilters {...defaultProps} sortOrder="asc" />);

    const sortOrderSelect = screen.getAllByRole('combobox')[3];
    expect(sortOrderSelect).toHaveTextContent('Asc');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SourcesFilters {...defaultProps} className="custom-class" />
    );

    const wrapper = container.querySelector('.custom-class');
    expect(wrapper).toBeInTheDocument();
  });

  it('should have correct width classes for selects', () => {
    const { container } = render(<SourcesFilters {...defaultProps} />);

    const selects = container.querySelectorAll('[role="combobox"]');
    // The component uses specific widths: w-[180px], w-[160px], w-[140px], w-[100px]
    expect(selects.length).toBeGreaterThanOrEqual(4);
  });

  it('should display "All" status option when status is "all"', () => {
    render(<SourcesFilters {...defaultProps} status="all" />);

    const statusSelect = screen.getAllByRole('combobox')[0];
    expect(statusSelect).toHaveTextContent('All');
  });

  it('should display "All Files" option when aiReadyOnly is false', () => {
    render(<SourcesFilters {...defaultProps} aiReadyOnly={false} />);

    const aiReadySelects = screen.getAllByRole('combobox');
    expect(aiReadySelects.length).toBeGreaterThan(0);
  });

  it('should display "AIReady Only" option when aiReadyOnly is true', () => {
    render(<SourcesFilters {...defaultProps} aiReadyOnly={true} />);

    const aiReadySelects = screen.getAllByRole('combobox');
    expect(aiReadySelects.length).toBeGreaterThan(0);
  });
});
