import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PricingConfigDialog } from '../PricingConfigDialog';

// Mock the runtime hooks
const mockPatchPricing = vi.fn();
const mockUseProjectPricing = vi.fn();
const mockUsePatchProjectPricing = vi.fn(() => ({
  mutateAsync: mockPatchPricing,
  isPending: false,
}));

vi.mock('@/lib/hooks/use-project-pricing', () => ({
  useProjectPricing: () => mockUseProjectPricing(),
  usePatchProjectPricing: () => mockUsePatchProjectPricing(),
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      pricing: {
        title: 'Pricing Configuration',
        description: 'Configure model pricing rates in dollars per million tokens',
        loading: 'Loading pricing data...',
        save: 'Save Changes',
        saving: 'Saving...',
        reset: 'Reset to Defaults',
        reset_confirm: 'Reset all pricing to defaults? This cannot be undone.',
        field_input: 'Input',
        field_output: 'Output',
        field_cached: 'Cached',
        field_reasoning: 'Reasoning',
        field_cache_creation: 'Cache Creation',
        error_save_failed: 'Failed to save pricing',
        error_reset_failed: 'Failed to reset pricing',
        error_load_failed: 'Failed to load pricing data',
        success_saved: 'Pricing saved successfully',
        success_reset: 'Pricing reset to defaults',
        no_data: 'No pricing data available',
        format_hint: 'All rates are in dollars per million tokens ($/1M tokens)',
        format_example: 'Example: Input rate of 2.50 means $2.50 per 1,000,000 input tokens',
      },
      common: {
        cancel: 'Cancel',
      },
    };
    const t = (k: string) => {
      const keys = k.split('.');
      if (keys.length === 2) {
        return translations[keys[0]]?.[keys[1]] || k;
      }
      return translations[key]?.[k] || k;
    };
    return t;
  },
}));

// Mock toast - must be inline because vi.mock is hoisted
vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockPricingData = {
  openai: {
    'gpt-4o': {
      input: 2.5,
      output: 10,
      cached: 1.25,
      reasoning: 15,
      cache_creation: 2.5,
    },
    'gpt-4o-mini': {
      input: 0.15,
      output: 0.6,
      cached: 0.075,
      reasoning: 0.9,
      cache_creation: 0.15,
    },
  },
  anthropic: {
    'claude-sonnet-4-5': {
      input: 3,
      output: 15,
      cached: 1.5,
      reasoning: 15,
      cache_creation: 3,
    },
  },
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  workspaceId: 'ws-123',
  projectId: 'proj-123',
};

describe('PricingConfigDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchPricing.mockResolvedValue(mockPricingData);
    mockUsePatchProjectPricing.mockReturnValue({
      mutateAsync: mockPatchPricing,
      isPending: false,
    });
  });

  describe('Rendering', () => {
    it('should show loading state when pricing data is not loaded', () => {
      mockUseProjectPricing.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      expect(screen.getByText('Loading pricing data...')).toBeInTheDocument();
    });

    it('should render pricing data when loaded', () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      expect(screen.getByText('Pricing Configuration')).toBeInTheDocument();
      expect(screen.getByText('Configure model pricing rates in dollars per million tokens')).toBeInTheDocument();
      // Check for provider headers (lowercase, sorted alphabetically)
      expect(screen.getByText('anthropic')).toBeInTheDocument();
      expect(screen.getByText('openai')).toBeInTheDocument();
    });

    it('should render all pricing fields for each model', () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Check model names are rendered
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
      expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
      expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument();

      // Check pricing values are rendered (formatted with 2 decimal places)
      // Use getAllByDisplayValue since multiple inputs may have the same value
      expect(screen.getAllByDisplayValue('2.50').length).toBeGreaterThan(0); // gpt-4o input
      expect(screen.getAllByDisplayValue('10.00').length).toBeGreaterThan(0); // gpt-4o output
      expect(screen.getAllByDisplayValue('0.15').length).toBeGreaterThan(0); // gpt-4o-mini input
    });

    it('should show empty state when no pricing data available', () => {
      mockUseProjectPricing.mockReturnValue({
        data: {},
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      expect(screen.getByText('No pricing data available')).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Pricing Configuration')).not.toBeInTheDocument();
    });
  });

  describe('Editing Pricing', () => {
    it('should update hasChanges state when value is modified', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Initially save button should be disabled (no changes)
      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      expect(saveButton).toBeDisabled();

      // Make a change using fireEvent to directly trigger onChange
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      // Save button should now be enabled
      await waitFor(() => {
        expect(saveButton).not.toBeDisabled();
      });
    });

    it('should handle decimal values correctly', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '3.75' } });

      await waitFor(() => {
        expect(input.value).toBe('3.75');
      });
    });

    it('should allow editing pricing input field', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '3' } });

      await waitFor(() => {
        // formatPricingValue formats with 2 decimal places
        expect(input.value).toBe('3.00');
      });
    });
  });

  describe('Save Functionality', () => {
    it('should call API with updated pricing when save is clicked', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Modify a pricing field using fireEvent
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      // Click save
      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockPatchPricing).toHaveBeenCalled();
        const callArg = mockPatchPricing.mock.calls[0][0];
        expect(callArg).toHaveProperty('openai');
        expect(callArg.openai).toHaveProperty('gpt-4o');
        expect(callArg.openai['gpt-4o']).toHaveProperty('input', 5);
      });
    });

    it('should close dialog after successful save', async () => {
      const onOpenChange = vi.fn();
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} onOpenChange={onOpenChange} />);

      // Make a change first to enable save
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('should show loading state while saving', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      const mockMutateAsync = vi.fn().mockResolvedValue({});
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      });

      const { rerender } = render(<PricingConfigDialog {...defaultProps} />);

      // Make a change
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      // Rerender to pick up the hasChanges state
      rerender(<PricingConfigDialog {...defaultProps} />);

      // With isPending: true and changes, the button should show "Saving..."
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('should handle save error gracefully', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      const mockMutateAsync = vi.fn().mockRejectedValue(new Error('API Error'));
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Make a change first
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      // The component should handle the error gracefully
      // Since the mutation rejects, the dialog should not close
      await waitFor(() => {
        expect(screen.getByTestId('pricing-config__dialog')).toBeInTheDocument();
      });
    });
  });

  describe('Reset Functionality', () => {
    it('should show confirmation dialog when reset is clicked', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      // Mock window.confirm
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<PricingConfigDialog {...defaultProps} />);

      const resetButton = screen.getByRole('button', { name: 'Reset to Defaults' });
      fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledWith('Reset all pricing to defaults? This cannot be undone.');

      confirmSpy.mockRestore();
    });

    it('should reset pricing when confirmed', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<PricingConfigDialog {...defaultProps} />);

      // Modify a value first
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '99' } });

      // Click reset and confirm
      const resetButton = screen.getByRole('button', { name: 'Reset to Defaults' });
      fireEvent.click(resetButton);

      // Value should be reset - use testId to get specific input
      await waitFor(() => {
        expect(screen.getByTestId('pricing-config__input-openai-gpt-4o-input').getAttribute('value')).toBe('2.50');
      });

      confirmSpy.mockRestore();
    });

    it('should not reset when cancelled', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      render(<PricingConfigDialog {...defaultProps} />);

      // Modify a value first
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '99' } });

      // Click reset but cancel
      const resetButton = screen.getByRole('button', { name: 'Reset to Defaults' });
      fireEvent.click(resetButton);

      // Value should remain modified (99 is formatted as 99.00)
      await waitFor(() => {
        expect(screen.getByDisplayValue('99.00')).toBeInTheDocument();
      });

      confirmSpy.mockRestore();
    });
  });

  describe('Cancel Functionality', () => {
    it('should close dialog when cancel is clicked', async () => {
      const onOpenChange = vi.fn();
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should reset form state when dialog is reopened', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      const { rerender } = render(<PricingConfigDialog {...defaultProps} />);

      // Modify a value
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '99' } });

      // Close and reopen
      rerender(<PricingConfigDialog {...defaultProps} open={false} />);
      rerender(<PricingConfigDialog {...defaultProps} open={true} />);

      // Value should be reset to original - use testId to be specific
      expect(screen.getByTestId('pricing-config__input-openai-gpt-4o-input').getAttribute('value')).toBe('2.50');
    });
  });

  describe('Change Count Indicator', () => {
    it('should show change count when values are modified', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Initially no change count
      expect(screen.queryByTestId('pricing-config__change-count')).not.toBeInTheDocument();

      // Make a single change
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      // Should show change count of 1
      await waitFor(() => {
        const changeCount = screen.getByTestId('pricing-config__change-count');
        expect(changeCount).toBeInTheDocument();
        expect(changeCount).toHaveTextContent('1');
      });
    });

    it('should increment change count for multiple field changes', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Make three changes to different fields
      const input1 = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      const input2 = screen.getByTestId('pricing-config__input-openai-gpt-4o-output');
      const input3 = screen.getByTestId('pricing-config__input-anthropic-claude-sonnet-4-5-input');

      fireEvent.change(input1, { target: { value: '5' } });
      fireEvent.change(input2, { target: { value: '12' } });
      fireEvent.change(input3, { target: { value: '4' } });

      // Should show change count of 3
      await waitFor(() => {
        const changeCount = screen.getByTestId('pricing-config__change-count');
        expect(changeCount).toHaveTextContent('3');
      });
    });

    it('should reset change count when reset is clicked', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<PricingConfigDialog {...defaultProps} />);

      // Make a change
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      await waitFor(() => {
        expect(screen.getByTestId('pricing-config__change-count')).toHaveTextContent('1');
      });

      // Reset
      const resetButton = screen.getByRole('button', { name: 'Reset to Defaults' });
      fireEvent.click(resetButton);

      // Change count should be removed
      await waitFor(() => {
        expect(screen.queryByTestId('pricing-config__change-count')).not.toBeInTheDocument();
      });

      confirmSpy.mockRestore();
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should close dialog when Escape key is pressed', async () => {
      const onOpenChange = vi.fn();
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} onOpenChange={onOpenChange} />);

      // Press Escape
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should save when Ctrl+Enter is pressed with changes', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });
      mockUsePatchProjectPricing.mockReturnValue({
        mutateAsync: mockPatchPricing,
        isPending: false,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      // Make a change
      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input');
      fireEvent.change(input, { target: { value: '5' } });

      // Press Ctrl+Enter
      fireEvent.keyDown(document, { key: 'Enter', code: 'Enter', ctrlKey: true });

      await waitFor(() => {
        expect(mockPatchPricing).toHaveBeenCalled();
      });
    });
  });

  describe('Visual Change Indicators', () => {
    it('should add visual indicator class to changed input fields', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input') as HTMLInputElement;

      // Initially no changed class
      expect(input.className).not.toContain('pricing-config__input--changed');

      // Make a change
      fireEvent.change(input, { target: { value: '5' } });

      await waitFor(() => {
        // Input should have changed indicator class
        expect(input.className).toContain('pricing-config__input--changed');
      });
    });

    it('should remove visual indicator when field value matches original', async () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      const input = screen.getByTestId('pricing-config__input-openai-gpt-4o-input') as HTMLInputElement;

      // Make a change
      fireEvent.change(input, { target: { value: '5' } });

      await waitFor(() => {
        expect(input.className).toContain('pricing-config__input--changed');
      });

      // Change back to original value (2.5)
      fireEvent.change(input, { target: { value: '2.5' } });

      await waitFor(() => {
        // Changed indicator should be removed
        expect(input.className).not.toContain('pricing-config__input--changed');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have correct test IDs for E2E testing', () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      expect(screen.getByTestId('pricing-config__dialog')).toBeInTheDocument();
      expect(screen.getByTestId('pricing-config__save-button')).toBeInTheDocument();
      expect(screen.getByTestId('pricing-config__reset-button')).toBeInTheDocument();
    });

    it('should have proper ARIA labels', () => {
      mockUseProjectPricing.mockReturnValue({
        data: mockPricingData,
        isLoading: false,
        error: null,
      });

      render(<PricingConfigDialog {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Check for proper heading structure
      const heading = screen.getByRole('heading', { name: 'Pricing Configuration' });
      expect(heading).toBeInTheDocument();
    });
  });
});
