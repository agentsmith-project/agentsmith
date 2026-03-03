/**
 * ErrorTag Unit Tests
 *
 * Tests the error category tag component for endpoint health failures.
 * Displays abbreviated error categories with appropriate colors.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ErrorTag } from '../ErrorTag';

describe('ErrorTag', () => {
  describe('Rendering Error Categories', () => {
    it('should display AUTH tag with red color', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveTextContent('AUTH');
      expect(tag).toHaveClass('text-error', 'border-error');
    });

    it('should display 429 tag with yellow color for rate_limit', () => {
      render(<ErrorTag category="rate_limit" />);
      const tag = screen.getByTestId('error-tag-rate_limit');
      expect(tag).toHaveTextContent('429');
      expect(tag).toHaveClass('text-warning', 'border-warning');
    });

    it('should display 5XX tag with orange color for upstream', () => {
      render(<ErrorTag category="upstream" />);
      const tag = screen.getByTestId('error-tag-upstream');
      expect(tag).toHaveTextContent('5XX');
      expect(tag).toHaveClass('text-orange-500', 'border-orange-500');
    });

    it('should display NET tag with purple color for network', () => {
      render(<ErrorTag category="network" />);
      const tag = screen.getByTestId('error-tag-network');
      expect(tag).toHaveTextContent('NET');
      expect(tag).toHaveClass('text-purple-500', 'border-purple-500');
    });

    it('should display TIMEOUT tag with gray color for timeout', () => {
      render(<ErrorTag category="timeout" />);
      const tag = screen.getByTestId('error-tag-timeout');
      expect(tag).toHaveTextContent('TIMEOUT');
      expect(tag).toHaveClass('text-tertiary', 'border-tertiary');
    });

    it('should display UNKNOWN tag for unknown category', () => {
      render(<ErrorTag category="unknown" />);
      const tag = screen.getByTestId('error-tag-unknown');
      expect(tag).toHaveTextContent('UNKNOWN');
      expect(tag).toHaveClass('text-tertiary', 'border-tertiary');
    });
  });

  describe('Size Variants', () => {
    it('should render small size when size="sm"', () => {
      render(<ErrorTag category="auth" size="sm" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('text-xs', 'px-1.5', 'py-0.5');
    });

    it('should render medium size when size="md"', () => {
      render(<ErrorTag category="auth" size="md" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('text-sm', 'px-2', 'py-1');
    });

    it('should render small size by default', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('text-xs');
    });
  });

  describe('Visual Style', () => {
    it('should have rounded corners', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('rounded');
    });

    it('should have border', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('border');
    });

    it('should have inline-flex layout', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('inline-flex');
    });

    it('should have font-medium weight', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveClass('font-medium');
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label describing the error category', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveAttribute('aria-label', 'Authentication error');
    });

    it('should have proper role', () => {
      render(<ErrorTag category="auth" />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveAttribute('role', 'status');
    });
  });

  describe('Error Category Full Names Mapping', () => {
    const errorDescriptions: Record<string, string> = {
      auth: 'Authentication error',
      rate_limit: 'Rate limit error',
      upstream: 'Upstream service error',
      network: 'Network error',
      timeout: 'Timeout error',
      unknown: 'Unknown error',
    };

    Object.entries(errorDescriptions).forEach(([category, expectedDescription]) => {
      it(`should map ${category} to "${expectedDescription}"`, () => {
        render(<ErrorTag category={category as any} />);
        const tag = screen.getByTestId(`error-tag-${category}`);
        expect(tag).toHaveAttribute('aria-label', expectedDescription);
      });
    });
  });

  describe('With Tooltip', () => {
    it('should show full error name on hover', () => {
      render(<ErrorTag category="auth" showTooltip />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).toHaveAttribute('title', 'Authentication error');
    });

    it('should not show tooltip when showTooltip is false', () => {
      render(<ErrorTag category="auth" showTooltip={false} />);
      const tag = screen.getByTestId('error-tag-auth');
      expect(tag).not.toHaveAttribute('title');
    });
  });
});
