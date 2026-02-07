import { render, screen } from '@testing-library/react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    key === 'selected_count' && values?.count !== undefined ? `selected_count_${values.count}` : key,
}));

import { ApplyQuotaTemplateDialog } from '../ApplyQuotaTemplateDialog';

describe('ApplyQuotaTemplateDialog', () => {
  it('keeps dialog open and shows failed member names when apply partially fails', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onApply = vi.fn().mockResolvedValue({ failedMemberIds: ['m_2'] });

    render(
      <ApplyQuotaTemplateDialog
        open
        onOpenChange={onOpenChange}
        template={{
          id: 'quota_tpl_1',
          name: 'Quota 1',
          description: '',
          overrides_json: {},
        }}
        members={[
          {
            id: 'm_1',
            user_id: 'u_1',
            name: 'Alice',
            email: 'alice@example.com',
            role: 'developer',
            status: 'active',
            joined_at: '2026-02-01T00:00:00Z',
          },
          {
            id: 'm_2',
            user_id: 'u_2',
            name: 'Bob',
            email: 'bob@example.com',
            role: 'user',
            status: 'active',
            joined_at: '2026-02-01T00:00:00Z',
          },
        ]}
        onApply={onApply}
      />
    );

    await user.click(screen.getByText('Alice'));
    await user.click(screen.getByText('Bob'));
    await user.click(screen.getByRole('button', { name: 'apply_to_members' }));

    expect(onApply).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const summary = screen.getByTestId('members__apply-quota-template-failed-summary');
    expect(within(summary).getByText('apply_failed_members_title')).toBeInTheDocument();
    expect(within(summary).getByText('Bob')).toBeInTheDocument();
  });

  it('retries only failed members when retry button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onApply = vi
      .fn()
      .mockResolvedValueOnce({ failedMemberIds: ['m_2'] })
      .mockResolvedValueOnce({});

    render(
      <ApplyQuotaTemplateDialog
        open
        onOpenChange={onOpenChange}
        template={{
          id: 'quota_tpl_1',
          name: 'Quota 1',
          description: '',
          overrides_json: {},
        }}
        members={[
          {
            id: 'm_1',
            user_id: 'u_1',
            name: 'Alice',
            email: 'alice@example.com',
            role: 'developer',
            status: 'active',
            joined_at: '2026-02-01T00:00:00Z',
          },
          {
            id: 'm_2',
            user_id: 'u_2',
            name: 'Bob',
            email: 'bob@example.com',
            role: 'user',
            status: 'active',
            joined_at: '2026-02-01T00:00:00Z',
          },
        ]}
        onApply={onApply}
      />
    );

    await user.click(screen.getByText('Alice'));
    await user.click(screen.getByText('Bob'));
    await user.click(screen.getByRole('button', { name: 'apply_to_members' }));
    const retryButton = await screen.findByRole('button', { name: 'retry_failed_members' });
    await user.click(retryButton);

    expect(onApply).toHaveBeenNthCalledWith(2, ['m_2']);
  });
});
