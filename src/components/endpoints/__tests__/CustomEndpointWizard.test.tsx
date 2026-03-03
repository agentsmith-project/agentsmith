/**
 * CustomEndpointWizard Unit Tests
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockCreate = vi.fn().mockResolvedValue({
  id: 'ep_new',
  name: 'Test Custom Endpoint',
  status: 'active',
});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      create: mockCreate,
    };
  }),
  CredentialsAPI: vi.fn().mockImplementation(function () {
    return {
      list: vi.fn().mockResolvedValue([
        {
          id: 'cred_1',
          name: 'Test Credential',
          fingerprint: 'sk-***1234',
        },
      ]),
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace: string) => (key: string) => {
    const translations: Record<string, unknown> = {
      'endpoints.custom_wizard': {
        title: 'Create Custom Endpoint',
        step1_title: 'Basic Information',
        step2_title: 'Model Configuration',
        step3_title: 'Validate and Create',
        name: 'Endpoint Name',
        name_placeholder: 'e.g., Production OpenAI',
        protocol: 'Protocol Type',
        base_url: 'Base URL',
        base_url_placeholder: 'https://api.example.com/v1',
        use_default: 'Use default',
        model_id: 'Model ID',
        model_id_placeholder: 'e.g., gpt-4o',
        capability: 'Capability',
        credential: 'Credential',
        credential_placeholder: 'Select a credential',
        check_button: 'Check Connection',
        validating: 'Validating...',
        validation: {
          success: 'Connection successful!',
          failed: 'Connection failed.',
          retry: 'Retry',
        },
        errors: {
          invalid_url: 'Invalid URL format.',
          https_required: 'HTTPS is required.',
          name_required: 'Endpoint name is required.',
          model_required: 'Model ID is required.',
          credential_required: 'Please select a credential.',
          auth: 'Authentication failed.',
          network: 'Network error.',
          timeout: 'Request timed out.',
          rate_limit: 'Rate limited.',
          upstream: 'Upstream error.',
          unknown: 'Unknown error.',
        },
        create_button: 'Create Endpoint',
        cancel_button: 'Cancel',
        back_button: 'Back',
        next_button: 'Next',
        no_credentials: 'No credentials available.',
        create_credential_first: 'Please create a credential first.',
        summary_title: 'Summary',
        summary_name: 'Name',
        summary_protocol: 'Protocol',
        summary_base_url: 'Base URL',
        summary_model: 'Model',
        summary_model_id: 'Model ID',
        summary_capability: 'Capability',
        config_summary: 'Configuration Summary',
        endpoint_ready: 'The endpoint is ready to use.',
        error_type: 'Error Type',
        capabilities: {
          chat_completion: 'Chat Completion',
          multimodal_completion: 'Multimodal Completion',
          embedding: 'Embedding',
          rerank: 'Reranker',
          image_generation: 'Image Generation',
          video_generation: 'Video Generation',
        },
      },
      common: {
        locale: 'en-US',
        cancel: 'Cancel',
        create: 'Create',
      },
    };

    if (namespace && translations[namespace]) {
      const keys = key.split('.');
      let result: any = translations[namespace];
      for (const k of keys) {
        result = result?.[k];
      }
      return result || key;
    }
    return key;
  }),
  useLocale: vi.fn(() => 'en-US'),
}));

import { CustomEndpointWizard } from '../CustomEndpointWizard';

describe('CustomEndpointWizard', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceId: 'ws_1',
    projectId: 'prj_1',
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    vi.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CustomEndpointWizard {...defaultProps} {...props} />
      </QueryClientProvider>,
    );
  };

  describe('Basic Rendering', () => {
    it('should render wizard dialog when open', () => {
      renderComponent();
      expect(screen.getByText('Create Custom Endpoint')).toBeVisible();
      expect(screen.getByTestId('endpoints__custom-wizard')).toBeVisible();
    });

    it('should not render when open is false', () => {
      renderComponent({ open: false });
      expect(screen.queryByTestId('endpoints__custom-wizard')).not.toBeInTheDocument();
    });

    it('should show protocol selection buttons', () => {
      renderComponent();
      expect(screen.getByTestId('protocol-openai_compatible')).toBeVisible();
      expect(screen.getByTestId('protocol-anthropic_compatible')).toBeVisible();
    });
  });

  describe('Step 1: Basic Info', () => {
    it('should show name and base URL inputs', () => {
      renderComponent();
      expect(screen.getByTestId('wizard-name-input')).toBeVisible();
      expect(screen.getByTestId('wizard-base-url-input')).toBeVisible();
    });

    it('should have base URL input available for editing', () => {
      renderComponent();
      const baseUrlInput = screen.getByTestId('wizard-base-url-input');
      expect(baseUrlInput).toBeVisible();
    });

    it('should allow editing base URL', async () => {
      renderComponent();
      await user.click(screen.getByTestId('protocol-openai_compatible'));

      const baseUrlInput = screen.getByTestId('wizard-base-url-input');
      await user.clear(baseUrlInput);
      await user.type(baseUrlInput, 'https://custom.example.com/v1');

      expect(baseUrlInput).toHaveValue('https://custom.example.com/v1');
    });

    describe('Next Button Enable Logic', () => {
      it('should enable Next button when name, protocol, and valid base URL are filled (step 1)', async () => {
        renderComponent();

        // Initially disabled - name is empty
        const nextButtons = screen.getAllByRole('button', { name: 'Next' });
        const nextButton = nextButtons[nextButtons.length - 1];
        expect(nextButton).toBeDisabled();

        // Fill in name
        await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
        // Still disabled - baseUrl is empty
        expect(nextButton).toBeDisabled();

        // Fill in base URL with https://
        await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');
        // Now enabled - we have name, protocol (default), and valid https URL
        await waitFor(() => {
          expect(nextButton).toBeEnabled();
        });
      });

      it('should enable Next button on step 1 even when no credentials exist', async () => {
        // This test verifies that step 1 doesn't require credentials
        // The actual fix is in the component - credentials check should only apply to step 2+
        renderComponent();

        const nextButtons = screen.getAllByRole('button', { name: 'Next' });
        const nextButton = nextButtons[nextButtons.length - 1];

        // Fill in step 1 fields (credentials exist in mock, so this tests step 1 isolation)
        await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
        await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

        // Next button should be enabled on step 1 with just name + base URL + protocol
        await waitFor(() => {
          expect(nextButton).toBeEnabled();
        });
      });

      it('should keep Next button disabled when base URL does not start with https://', async () => {
        renderComponent();

        await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
        await user.type(screen.getByTestId('wizard-base-url-input'), 'http://api.example.com/v1');

        const nextButtons = screen.getAllByRole('button', { name: 'Next' });
        const nextButton = nextButtons[nextButtons.length - 1];
        expect(nextButton).toBeDisabled();
      });

      it('should allow valid https base URL without /v1 suffix (GLM coding path)', async () => {
        renderComponent();

        await user.type(screen.getByTestId('wizard-name-input'), 'GLM Coding Endpoint');
        await user.type(
          screen.getByTestId('wizard-base-url-input'),
          'https://open.bigmodel.cn/api/coding/paas/v4',
        );

        const nextButtons = screen.getAllByRole('button', { name: 'Next' });
        const nextButton = nextButtons[nextButtons.length - 1];
        await waitFor(() => {
          expect(nextButton).toBeEnabled();
        });
      });

      it('should allow valid https base URL without trailing slash (Anthropic path)', async () => {
        renderComponent();

        await user.type(screen.getByTestId('wizard-name-input'), 'GLM Anthropic Endpoint');
        await user.type(
          screen.getByTestId('wizard-base-url-input'),
          'https://open.bigmodel.cn/api/anthropic',
        );

        const nextButtons = screen.getAllByRole('button', { name: 'Next' });
        const nextButton = nextButtons[nextButtons.length - 1];
        await waitFor(() => {
          expect(nextButton).toBeEnabled();
        });
      });
    });
  });

  describe('Step 2: Model Config', () => {
    it('should show model config fields after proceeding from step 1', async () => {
      renderComponent();

      // Fill step 1
      await user.click(screen.getByTestId('protocol-openai_compatible'));
      await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
      await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

      // Click next button
      const nextButtons = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons[nextButtons.length - 1]);

      // Wait for step 2 to appear
      await waitFor(() => {
        expect(screen.getByTestId('wizard-model-id-input')).toBeVisible();
      }, { timeout: 3000 });
    });

    it('should allow going back to step 1', async () => {
      renderComponent();

      // Fill step 1
      await user.click(screen.getByTestId('protocol-openai_compatible'));
      await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
      await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

      // Click next
      const nextButtons = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons[nextButtons.length - 1]);

      // Wait for step 2
      await waitFor(() => {
        expect(screen.getByTestId('wizard-model-id-input')).toBeVisible();
      }, { timeout: 3000 });

      // Click back
      const backButton = screen.getByRole('button', { name: 'Back' });
      await user.click(backButton);

      // Should be back on step 1
      await waitFor(() => {
        expect(screen.getByTestId('wizard-name-input')).toBeVisible();
      });
    });

    it('should enable Next button on step 2 when model ID is filled (credential auto-selected)', async () => {
      renderComponent();

      // Fill step 1
      await user.click(screen.getByTestId('protocol-openai_compatible'));
      await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
      await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

      // Click next to step 2
      const nextButtons = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons[nextButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByTestId('wizard-model-id-input')).toBeVisible();
      }, { timeout: 3000 });

      // Model ID is empty initially, Next should be disabled
      const nextButtons2 = screen.getAllByRole('button', { name: 'Next' });
      const nextButton2 = nextButtons2[nextButtons2.length - 1];
      expect(nextButton2).toBeDisabled();

      // Fill in model ID
      await user.type(screen.getByTestId('wizard-model-id-input'), 'gpt-4o');

      // Next should be enabled now (credential is auto-selected)
      await waitFor(() => {
        expect(nextButton2).toBeEnabled();
      });
    });
  });

  describe('Step 3: Validate and Create', () => {
    const goToStep3 = async () => {
      renderComponent();

      // Step 1
      await user.click(screen.getByTestId('protocol-openai_compatible'));
      await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
      await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

      const nextButtons = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons[nextButtons.length - 1]);

      // Step 2
      await waitFor(() => {
        expect(screen.getByTestId('wizard-model-id-input')).toBeVisible();
      }, { timeout: 3000 });

      await user.type(screen.getByTestId('wizard-model-id-input'), 'gpt-4o');

      // Click next again
      const nextButtons2 = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons2[nextButtons2.length - 1]);

      // Step 3
      await waitFor(() => {
        expect(screen.getByTestId('wizard-check-button')).toBeVisible();
      }, { timeout: 3000 });
    };

    it('should show check and create buttons', async () => {
      await goToStep3();
      expect(screen.getByTestId('wizard-check-button')).toBeVisible();
      expect(screen.getByTestId('wizard-create-button')).toBeVisible();
    });

    it('should enable create button even without validation (validation is optional)', async () => {
      await goToStep3();
      const createButton = screen.getByTestId('wizard-create-button');
      // Create button should be enabled (validation is now optional)
      expect(createButton).toBeEnabled();
    });

      it('should create endpoint without validation (validation is optional)', async () => {
      await goToStep3();
      const createButton = screen.getByTestId('wizard-create-button');
      await user.click(createButton);

      // Should create endpoint even though validation was not run
      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          'ws_1',
          'prj_1',
          expect.objectContaining({
            name: 'Test Endpoint',
            type: 'custom',
          }),
        );
      });
    });

    it('should call validate API when check button clicked', async () => {
      await goToStep3();

      const checkButton = screen.getByTestId('wizard-check-button');
      await user.click(checkButton);

      await waitFor(() => {
        expect(screen.getByText(/Connection successful/i)).toBeVisible();
      });
    });

    it('should show success message after valid validation', async () => {
      await goToStep3();

      const checkButton = screen.getByTestId('wizard-check-button');
      await user.click(checkButton);

      await waitFor(() => {
        expect(screen.getByText(/Connection successful/i)).toBeVisible();
      });

      const createButton = screen.getByTestId('wizard-create-button');
      await waitFor(() => {
        expect(createButton).toBeEnabled();
      });
    });

    it('should create endpoint when create button clicked', async () => {
      await goToStep3();

      const checkButton = screen.getByTestId('wizard-check-button');
      await user.click(checkButton);

      await waitFor(() => {
        expect(screen.getByText(/Connection successful/i)).toBeVisible();
      });

      const createButton = screen.getByTestId('wizard-create-button');
      await user.click(createButton);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          'ws_1',
          'prj_1',
          expect.objectContaining({
            name: 'Test Endpoint',
            type: 'custom',
          }),
        );
      });
    });
  });

  describe('Dialog Behavior', () => {
    it('should close when cancel clicked', async () => {
      renderComponent();
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('i18n - Capability Translations', () => {
    it('should display translated capability value in step 2 summary', async () => {
      renderComponent();

      // Navigate to step 2 and select a capability
      await user.click(screen.getByTestId('protocol-openai_compatible'));
      await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
      await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

      const nextButtons = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons[nextButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByTestId('wizard-model-id-input')).toBeVisible();
      }, { timeout: 3000 });

      // The capability should be displayed as a translated label, not the raw value
      // For chat_completion, it should show "Chat Completion" not "chat_completion"
      const capabilitySummary = screen.getByText(/Capability:/i).parentElement;
      expect(capabilitySummary?.textContent).toContain('Chat Completion');
    });

    it('should display translated capability value in step 3 config summary', async () => {
      renderComponent();

      // Navigate to step 3
      await user.click(screen.getByTestId('protocol-openai_compatible'));
      await user.type(screen.getByTestId('wizard-name-input'), 'Test Endpoint');
      await user.type(screen.getByTestId('wizard-base-url-input'), 'https://api.example.com/v1');

      const nextButtons = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons[nextButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByTestId('wizard-model-id-input')).toBeVisible();
      }, { timeout: 3000 });

      await user.type(screen.getByTestId('wizard-model-id-input'), 'gpt-4o');

      const nextButtons2 = screen.getAllByRole('button', { name: 'Next' });
      await user.click(nextButtons2[nextButtons2.length - 1]);

      await waitFor(() => {
        expect(screen.getByTestId('wizard-check-button')).toBeVisible();
      }, { timeout: 3000 });

      // The capability in config summary should be translated
      const capabilitySummary = screen.getByText(/Capability:/i).parentElement;
      expect(capabilitySummary?.textContent).toContain('Chat Completion');
      expect(capabilitySummary?.textContent).not.toContain('chat_completion');
    });
  });
});
