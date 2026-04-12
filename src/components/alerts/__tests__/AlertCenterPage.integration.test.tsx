/**
 * Alert Center Page Integration Tests
 *
 * Covers the real form dialog instead of a mocked shell so the overlay contract
 * is exercised through the actual component tree.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertCenterPage } from '../AlertCenterPage';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useAlertPageCapabilities: () => ({ canRead: true, canManage: true }),
}));

describe('AlertCenterPage integration', () => {
  it('opens the real create-rule dialog from the rules surface', async () => {
    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    expect(screen.queryByTestId('alert-rule-form-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('alert-center__create-button'));

    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-form-dialog')).toBeVisible();
    });

    expect(screen.getByTestId('alert-rule-form-dialog__title')).toHaveTextContent('form.title.create');
    expect(screen.getByTestId('alert-rule-form-dialog__name-input')).toBeInTheDocument();
  });
});
