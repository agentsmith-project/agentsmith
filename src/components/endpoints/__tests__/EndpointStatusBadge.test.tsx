/**
 * EndpointStatusBadge Unit Tests
 *
 * Tests the health status badge component for endpoints.
 * Displays healthy/degraded/unavailable/unknown states with appropriate colors and icons.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EndpointStatusBadge } from '../EndpointStatusBadge';

describe('EndpointStatusBadge', () => {
  describe('Rendering Status States', () => {
    it('should display healthy status with green color', () => {
      render(<EndpointStatusBadge status="healthy" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-success');
      expect(badge).toHaveTextContent(/healthy|healthy/i);
    });

    it('should display degraded status with warning color', () => {
      render(<EndpointStatusBadge status="degraded" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-warning');
      expect(badge).toHaveTextContent(/degraded|degraded/i);
    });

    it('should display unavailable status with error color', () => {
      render(<EndpointStatusBadge status="unavailable" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-error');
      expect(badge).toHaveTextContent(/unavailable|unavailable/i);
    });

    it('should display unknown status with tertiary color', () => {
      render(<EndpointStatusBadge status="unknown" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-tertiary');
      expect(badge).toHaveTextContent(/unknown|unknown/i);
    });
  });

  describe('Status Indicator Dot', () => {
    it('should show green dot for healthy status', () => {
      render(<EndpointStatusBadge status="healthy" />);
      const dot = screen.getByTestId('endpoint-status-dot');
      expect(dot).toHaveClass('bg-success');
    });

    it('should show yellow dot for degraded status', () => {
      render(<EndpointStatusBadge status="degraded" />);
      const dot = screen.getByTestId('endpoint-status-dot');
      expect(dot).toHaveClass('bg-warning');
    });

    it('should show red dot for unavailable status', () => {
      render(<EndpointStatusBadge status="unavailable" />);
      const dot = screen.getByTestId('endpoint-status-dot');
      expect(dot).toHaveClass('bg-error');
    });

    it('should show gray dot for unknown status', () => {
      render(<EndpointStatusBadge status="unknown" />);
      const dot = screen.getByTestId('endpoint-status-dot');
      expect(dot).toHaveClass('bg-tertiary');
    });
  });

  describe('Error Category Tag', () => {
    it('should display AUTH error tag when errorCategory is auth', () => {
      render(
        <EndpointStatusBadge
          status="unavailable"
          errorCategory="auth"
        />
      );
      const tag = screen.getByTestId('endpoint-error-tag');
      expect(tag).toHaveTextContent('AUTH');
      expect(tag).toHaveClass('text-error');
    });

    it('should display 429 error tag when errorCategory is rate_limit', () => {
      render(
        <EndpointStatusBadge
          status="degraded"
          errorCategory="rate_limit"
        />
      );
      const tag = screen.getByTestId('endpoint-error-tag');
      expect(tag).toHaveTextContent('429');
      expect(tag).toHaveClass('text-warning');
    });

    it('should display 5XX error tag when errorCategory is upstream', () => {
      render(
        <EndpointStatusBadge
          status="unavailable"
          errorCategory="upstream"
        />
      );
      const tag = screen.getByTestId('endpoint-error-tag');
      expect(tag).toHaveTextContent('5XX');
      expect(tag).toHaveClass('text-error');
    });

    it('should display NET error tag when errorCategory is network', () => {
      render(
        <EndpointStatusBadge
          status="unavailable"
          errorCategory="network"
        />
      );
      const tag = screen.getByTestId('endpoint-error-tag');
      expect(tag).toHaveTextContent('NET');
      expect(tag).toHaveClass('border-purple-500');
    });

    it('should display TIMEOUT error tag when errorCategory is timeout', () => {
      render(
        <EndpointStatusBadge
          status="unavailable"
          errorCategory="timeout"
        />
      );
      const tag = screen.getByTestId('endpoint-error-tag');
      expect(tag).toHaveTextContent('TIMEOUT');
      expect(tag).toHaveClass('text-tertiary');
    });

    it('should not display error tag when status is healthy', () => {
      render(
        <EndpointStatusBadge
          status="healthy"
          errorCategory="auth"
        />
      );
      expect(screen.queryByTestId('endpoint-error-tag')).not.toBeInTheDocument();
    });

    it('should not display error tag when status is unknown', () => {
      render(
        <EndpointStatusBadge
          status="unknown"
          errorCategory="unknown"
        />
      );
      expect(screen.queryByTestId('endpoint-error-tag')).not.toBeInTheDocument();
    });
  });

  describe('Last Check Time', () => {
    it('should display relative time when lastCheck is provided', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

      render(
        <EndpointStatusBadge
          status="healthy"
          lastCheck={fiveMinutesAgo}
        />
      );

      const timeElement = screen.getByTestId('endpoint-last-check');
      expect(timeElement).toHaveTextContent(/5m|5 min/i);
    });

    it('should display "Just now" for very recent checks', () => {
      const justNow = new Date().toISOString();

      render(
        <EndpointStatusBadge
          status="healthy"
          lastCheck={justNow}
        />
      );

      const timeElement = screen.getByTestId('endpoint-last-check');
      expect(timeElement).toHaveTextContent(/just now|just/i);
    });

    it('should not display time when lastCheck is not provided', () => {
      render(<EndpointStatusBadge status="healthy" />);
      expect(screen.queryByTestId('endpoint-last-check')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper aria-label for screen readers', () => {
      render(<EndpointStatusBadge status="healthy" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveAttribute('aria-label', 'Endpoint status: healthy');
    });

    it('should include error category in aria-label when present', () => {
      render(
        <EndpointStatusBadge
          status="unavailable"
          errorCategory="auth"
        />
      );
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveAttribute('aria-label', 'Endpoint status: unavailable. Error: auth');
    });
  });

  describe('Size Variants', () => {
    it('should render small size when size="sm"', () => {
      render(<EndpointStatusBadge status="healthy" size="sm" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-xs');
    });

    it('should render medium size when size="md"', () => {
      render(<EndpointStatusBadge status="healthy" size="md" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-sm');
    });

    it('should render default size when size is not specified', () => {
      render(<EndpointStatusBadge status="healthy" />);
      const badge = screen.getByTestId('endpoint-status-badge');
      expect(badge).toHaveClass('text-sm');
    });
  });
});
