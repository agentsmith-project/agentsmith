/**
 * Unit tests for AIReadyStatusBadge component
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { AIReadyStatusBadge } from '../AIReadyStatusBadge';
import type { AIReadyStatus } from '@/lib/api/types';

describe('AIReadyStatusBadge', () => {
  const statuses: AIReadyStatus[] = ['idle', 'preparing', 'ready', 'failed', 'cancelled'];

  describe.each(statuses)('status: %s', (status) => {
    it(`should render for ${status} status`, () => {
      render(<AIReadyStatusBadge status={status} />);
      const badge = screen.getByText(/./); // Get any text element

      expect(badge).toBeInTheDocument();
      expect(badge.tagName.toLowerCase()).toBe('span');
    });

    it(`should have correct classes for ${status} status`, () => {
      const { container } = render(<AIReadyStatusBadge status={status} />);
      const badge = container.querySelector('span');

      expect(badge).toHaveClass('inline-flex', 'items-center', 'gap-1.5', 'px-2.5', 'py-1', 'rounded-full', 'text-xs', 'font-medium', 'border');
    });

    it(`should have custom classes for ${status} status`, () => {
      const { container } = render(<AIReadyStatusBadge status={status} />);
      const badge = container.querySelector('span');

      // Verify status-specific classes
      expect(badge).toHaveClass(/bg-/);
      expect(badge).toHaveClass(/text-/);
      expect(badge).toHaveClass(/border-/);
    });
  });

  it('should render default label for idle status', () => {
    render(<AIReadyStatusBadge status="idle" />);
    expect(screen.getByText('Not Ready')).toBeInTheDocument();
  });

  it('should render default label for preparing status', () => {
    render(<AIReadyStatusBadge status="preparing" />);
    expect(screen.getByText('Preparing')).toBeInTheDocument();
  });

  it('should render default label for ready status', () => {
    render(<AIReadyStatusBadge status="ready" />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('should render default label for failed status', () => {
    render(<AIReadyStatusBadge status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('should render default label for cancelled status', () => {
    render(<AIReadyStatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('should render custom children when provided', () => {
    render(
      <AIReadyStatusBadge status="ready">
        Custom Label
      </AIReadyStatusBadge>
    );
    expect(screen.getByText('Custom Label')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('should merge custom className with default classes', () => {
    const { container } = render(
      <AIReadyStatusBadge status="ready" className="custom-class" />
    );
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('custom-class');
    expect(badge).toHaveClass('inline-flex');
  });

  it('should spread additional props to span element', () => {
    const { container } = render(
      <AIReadyStatusBadge status="ready" data-testid="status-badge" />
    );
    const badge = container.querySelector('[data-testid="status-badge"]');

    expect(badge).toBeInTheDocument();
    expect(badge?.tagName.toLowerCase()).toBe('span');
  });

  it('should have transition-colors duration-200 class', () => {
    const { container } = render(<AIReadyStatusBadge status="ready" />);
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('transition-colors', 'duration-200');
  });

  it('should render idle status with correct styling', () => {
    const { container } = render(<AIReadyStatusBadge status="idle" />);
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('bg-surface-high', 'text-tertiary', 'border-subtle');
  });

  it('should render preparing status with correct styling', () => {
    const { container } = render(<AIReadyStatusBadge status="preparing" />);
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('bg-primary/15', 'text-primary', 'border-primary/30');
  });

  it('should render ready status with correct styling', () => {
    const { container } = render(<AIReadyStatusBadge status="ready" />);
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('bg-success/15', 'text-success', 'border-success/30');
  });

  it('should render failed status with correct styling', () => {
    const { container } = render(<AIReadyStatusBadge status="failed" />);
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('bg-error/10', 'text-error', 'border-error/30');
  });

  it('should render cancelled status with correct styling', () => {
    const { container } = render(<AIReadyStatusBadge status="cancelled" />);
    const badge = container.querySelector('span');

    expect(badge).toHaveClass('bg-warning/15', 'text-warning', 'border-warning/30');
  });
});
