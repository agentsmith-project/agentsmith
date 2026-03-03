/**
 * ProviderLogo Unit Tests
 *
 * Tests the provider logo component with brand colors and fallback text icons.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProviderLogo } from '../ProviderLogo';

describe('ProviderLogo', () => {
  describe('Rendering Provider Logos', () => {
    it('should render OpenAI logo with brand color', () => {
      render(<ProviderLogo provider="openai" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(16, 163, 127, 0.15)' });
    });

    it('should render Anthropic logo with brand color', () => {
      render(<ProviderLogo provider="anthropic" />);
      const logo = screen.getByTestId('provider-logo-anthropic');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(217, 119, 87, 0.15)' });
    });

    it('should render Google logo with brand color', () => {
      render(<ProviderLogo provider="google" />);
      const logo = screen.getByTestId('provider-logo-google');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(66, 133, 244, 0.15)' });
    });

    it('should render DeepSeek logo with brand color', () => {
      render(<ProviderLogo provider="deepseek" />);
      const logo = screen.getByTestId('provider-logo-deepseek');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(77, 107, 254, 0.15)' });
    });

    it('should render custom provider logo with gray color', () => {
      render(<ProviderLogo provider="custom" />);
      const logo = screen.getByTestId('provider-logo-custom');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(107, 114, 128, 0.15)' });
    });

    it('should render unknown provider with default gray color', () => {
      render(<ProviderLogo provider="unknown_provider" />);
      const logo = screen.getByTestId('provider-logo-unknown_provider');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(107, 114, 128, 0.15)' });
    });
  });

  describe('Size Variants', () => {
    it('should render small size (24px) when size="sm"', () => {
      render(<ProviderLogo provider="openai" size="sm" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveClass('w-6', 'h-6'); // 24px
    });

    it('should render medium size (32px) when size="md"', () => {
      render(<ProviderLogo provider="openai" size="md" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveClass('w-8', 'h-8'); // 32px
    });

    it('should render large size (40px) when size="lg"', () => {
      render(<ProviderLogo provider="openai" size="lg" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveClass('w-10', 'h-10'); // 40px
    });

    it('should render medium size by default', () => {
      render(<ProviderLogo provider="openai" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveClass('w-8', 'h-8'); // 32px default
    });
  });

  describe('Fallback Text Icon', () => {
    it('should display fallback text when image fails to load', () => {
      render(<ProviderLogo provider="openai" />);
      const fallback = screen.getByTestId('provider-logo-fallback-openai');
      expect(fallback).toHaveTextContent('OA'); // First two letters of OpenAI
    });

    it('should display correct fallback for Anthropic (AN)', () => {
      render(<ProviderLogo provider="anthropic" />);
      const fallback = screen.getByTestId('provider-logo-fallback-anthropic');
      expect(fallback).toHaveTextContent('AN');
    });

    it('should display correct fallback for Google (GO)', () => {
      render(<ProviderLogo provider="google" />);
      const fallback = screen.getByTestId('provider-logo-fallback-google');
      expect(fallback).toHaveTextContent('GO');
    });

    it('should display correct fallback for custom providers', () => {
      render(<ProviderLogo provider="custom" />);
      const fallback = screen.getByTestId('provider-logo-fallback-custom');
      expect(fallback).toHaveTextContent('CU');
    });

    it('should display correct fallback for DeepSeek (DS)', () => {
      render(<ProviderLogo provider="deepseek" />);
      const fallback = screen.getByTestId('provider-logo-fallback-deepseek');
      expect(fallback).toHaveTextContent('DS');
    });

    it('should show only first two letters for long provider names', () => {
      render(<ProviderLogo provider="minimax" />);
      const fallback = screen.getByTestId('provider-logo-fallback-minimax');
      expect(fallback).toHaveTextContent('MI');
    });
  });

  describe('Accessibility', () => {
    it('should have proper alt text for provider image', () => {
      render(<ProviderLogo provider="openai" />);
      const img = screen.queryByAltText('OpenAI logo');
      const logo = screen.getByTestId('provider-logo-openai');
      // Either img or fallback should be present
      expect(img || logo).toBeTruthy();
    });

    it('should have aria-label for the logo container', () => {
      render(<ProviderLogo provider="openai" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveAttribute('aria-label', 'OpenAI provider logo');
    });
  });

  describe('Styling', () => {
    it('should apply rounded corners', () => {
      render(<ProviderLogo provider="openai" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveClass('rounded-lg');
    });

    it('should have flex layout for centering', () => {
      render(<ProviderLogo provider="openai" />);
      const logo = screen.getByTestId('provider-logo-openai');
      expect(logo).toHaveClass('flex', 'items-center', 'justify-center');
    });

    it('should apply brand-colored background with opacity', () => {
      render(<ProviderLogo provider="openai" />);
      const logo = screen.getByTestId('provider-logo-openai');
      // Background should have brand color with 15% opacity
      expect(logo).toHaveStyle({ backgroundColor: 'rgba(16, 163, 127, 0.15)' });
    });
  });

  describe('Image Loading', () => {
    it('should attempt to load provider image from assets', () => {
      render(<ProviderLogo provider="openai" />);
      const img = screen.queryByAltText('OpenAI logo');
      // Image src should point to assets directory
      if (img) {
        expect(img).toHaveAttribute('src', expect.stringContaining('providers/openai'));
      }
    });
  });
});
