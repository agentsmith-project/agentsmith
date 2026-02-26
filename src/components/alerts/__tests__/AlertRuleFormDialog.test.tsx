/**
 * AlertRuleFormDialog Unit Tests
 *
 * Tests for the alert rule form dialog component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertRuleFormDialog } from '../AlertRuleFormDialog';
import type { AlertRuleFormData } from '../AlertRuleFormDialog';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      alerts: {
        'form.title.create': 'Create Alert Rule',
        'form.title.edit': 'Edit Alert Rule',
        'form.description': 'Configure when and how you want to be notified',
        'form.name': 'Name',
        'form.name_placeholder': 'Enter rule name',
        'form.description_label': 'Description',
        'form.description_placeholder': 'Optional description',
        'form.enabled': 'Enable this rule',
        'form.trigger': 'Trigger Conditions',
        'form.metric': 'Metric',
        'form.operator': 'Operator',
        'form.threshold': 'Threshold',
        'form.window': 'Time Window',
        'form.channels': 'Notification Channels',
        'form.in_app': 'Show in-app notifications',
        'form.webhook_url': 'Webhook URL',
        'form.webhook_url_placeholder': 'https://example.com/webhook',
        'form.behavior': 'Behavior',
        'form.debounce': 'Debounce (minutes)',
        'form.notify_recovery': 'Notify on recovery',
      },
      common: {
        cancel: 'Cancel',
        save: 'Save',
        create: 'Create',
        edit: 'Edit',
      },
    };
    const ns = translations[namespace as keyof typeof translations] || {};
    return ns[key as keyof typeof ns] || `${namespace}.${key}`;
  },
}));

const _mockTranslations = {
  'alerts.form.title.create': 'Create Alert Rule',
  'alerts.form.title.edit': 'Edit Alert Rule',
  'alerts.form.description': 'Configure when and how you want to be notified',
  'alerts.form.name': 'Name',
  'alerts.form.name_placeholder': 'Enter rule name',
  'alerts.form.description_label': 'Description',
  'alerts.form.description_placeholder': 'Optional description',
  'alerts.form.enabled': 'Enable this rule',
  'alerts.form.trigger': 'Trigger Conditions',
  'alerts.form.metric': 'Metric',
  'alerts.form.operator': 'Operator',
  'alerts.form.threshold': 'Threshold',
  'alerts.form.window': 'Time Window',
  'alerts.form.channels': 'Notification Channels',
  'alerts.form.in_app': 'Show in-app notifications',
  'alerts.form.webhook_url': 'Webhook URL',
  'alerts.form.webhook_url_placeholder': 'https://example.com/webhook',
  'alerts.form.behavior': 'Behavior',
  'alerts.form.debounce': 'Debounce (minutes)',
  'alerts.form.notify_recovery': 'Notify on recovery',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.create': 'Create',
  'common.edit': 'Edit',
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

const defaultFormData: AlertRuleFormData = {
  name: 'Test Rule',
  description: 'Test description',
  enabled: true,
  trigger: {
    metric: 'requests_per_hour',
    operator: 'gte',
    threshold: 1000,
    window: '1h',
  },
  channels: {
    in_app: true,
  },
  behavior: {
    debounce_minutes: 5,
    notify_on_recovery: true,
  },
};

describe('AlertRuleFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Create Mode', () => {
    it('should not render when open is false', () => {
      renderWithQueryClient(
        <AlertRuleFormDialog
          open={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="create"
        />
      );

      expect(screen.queryByText('Create Alert Rule')).not.toBeInTheDocument();
    });

    it('should render dialog when open is true', () => {
      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="create"
        />
      );

      expect(screen.getByText('Create Alert Rule')).toBeInTheDocument();
    });

    it('should render all form fields', () => {
      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="create"
        />
      );

      expect(screen.getByTestId('alert-rule-form-dialog__name-input')).toBeInTheDocument();
      expect(screen.getByTestId('alert-rule-form-dialog__description-input')).toBeInTheDocument();
      expect(screen.getByTestId('alert-rule-form-dialog__enabled-switch')).toBeInTheDocument();
      expect(screen.getByText('Trigger Conditions')).toBeInTheDocument();
      expect(screen.getByText('Notification Channels')).toBeInTheDocument();
      expect(screen.getByText('Behavior')).toBeInTheDocument();
    });

    it('should submit form with valid data', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          mode="create"
        />
      );

      const nameInput = screen.getByTestId('alert-rule-form-dialog__name-input');
      await user.type(nameInput, 'Test Rule');

      const saveButton = screen.getByRole('button', { name: 'Create' });
      await user.click(saveButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalled();
      });

      const submittedData = handleSubmit.mock.calls[0][0] as AlertRuleFormData;
      expect(submittedData.name).toBe('Test Rule');
    });

    it('should call onClose when cancel is clicked', async () => {
      const handleClose = vi.fn();
      const user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={handleClose}
          onSubmit={vi.fn()}
          mode="create"
        />
      );

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should pre-fill form with initialData', () => {
      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="create"
          initialData={defaultFormData}
        />
      );

      expect(screen.getByDisplayValue('Test Rule')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test description')).toBeInTheDocument();
    });
  });

  describe('Edit Mode', () => {
    it('should show edit title in edit mode', () => {
      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="edit"
          initialData={defaultFormData}
        />
      );

      expect(screen.getByText('Edit Alert Rule')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('should pre-populate all fields with initial data', () => {
      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="edit"
          initialData={defaultFormData}
        />
      );

      expect(screen.getByDisplayValue('Test Rule')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test description')).toBeInTheDocument();
      expect(screen.getByDisplayValue('1000')).toBeInTheDocument();
    });
  });

  describe('Form Fields', () => {
    it('should handle enabled toggle', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          mode="create"
        />
      );

      const enabledSwitch = screen.getByTestId('alert-rule-form-dialog__enabled-switch');
      await user.click(enabledSwitch);

      const nameInput = screen.getByTestId('alert-rule-form-dialog__name-input');
      await user.type(nameInput, 'Test');

      const saveButton = screen.getByRole('button', { name: 'Create' });
      await user.click(saveButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalled();
      });

      const submittedData = handleSubmit.mock.calls[0][0] as AlertRuleFormData;
      // Default is true, clicking toggle switches it to false
      expect(submittedData.enabled).toBe(false);
    });

    it('should handle metric selector', async () => {
      const _user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          mode="create"
        />
      );

      // Metric selector should be present
      const metricTrigger = screen.getByTestId('alert-rule-form-dialog__metric-select');
      expect(metricTrigger).toBeInTheDocument();
    });

    it('should handle in-app notification toggle', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          mode="create"
        />
      );

      const nameInput = screen.getByTestId('alert-rule-form-dialog__name-input');
      await user.type(nameInput, 'Test');

      const inAppSwitch = screen.getByTestId('alert-rule-form-dialog__in-app-switch');
      await user.click(inAppSwitch);

      const saveButton = screen.getByRole('button', { name: 'Create' });
      await user.click(saveButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalled();
      });

      const submittedData = handleSubmit.mock.calls[0][0] as AlertRuleFormData;
      // Default is true, clicking toggle switches it to false
      expect(submittedData.channels.in_app).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should require name field', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          mode="create"
        />
      );

      const saveButton = screen.getByRole('button', { name: 'Create' });
      await user.click(saveButton);

      // Should not submit without name
      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it('should require threshold field', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithQueryClient(
        <AlertRuleFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          mode="create"
        />
      );

      const nameInput = screen.getByTestId('alert-rule-form-dialog__name-input');
      await user.type(nameInput, 'Test');

      // Clear threshold default if any
      const thresholdInput = screen.getByTestId('alert-rule-form-dialog__threshold-input');
      await user.clear(thresholdInput);

      const saveButton = screen.getByRole('button', { name: 'Create' });
      await user.click(saveButton);

      // Should not submit without threshold
      expect(handleSubmit).not.toHaveBeenCalled();
    });
  });
});
