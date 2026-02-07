import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { name?: string }) => {
    if (key === 'delete_confirm_message' && values?.name) {
      return `delete_confirm_message_${values.name}`;
    }
    return key;
  },
}));

vi.mock('@/lib/hooks/use-members', () => ({
  useQuotaTemplates: vi.fn(),
  useCreateQuotaTemplate: vi.fn(),
  useUpdateQuotaTemplate: vi.fn(),
  useDeleteQuotaTemplate: vi.fn(),
  useBatchApplyQuotaTemplate: vi.fn(),
  useMembers: vi.fn(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanManageMemberGovernance: vi.fn(),
}));

vi.mock('../CreateQuotaTemplateDrawer', () => ({
  CreateQuotaTemplateDrawer: () => null,
}));

vi.mock('../EditQuotaTemplateDrawer', () => ({
  EditQuotaTemplateDrawer: () => null,
}));

vi.mock('../ApplyQuotaTemplateDialog', () => ({
  ApplyQuotaTemplateDialog: ({
    open,
    onApply,
  }: {
    open: boolean;
    onApply: (memberIds: string[]) => Promise<{ failedMemberIds?: string[]; failedCount?: number } | void>;
  }) => {
    if (!open) return null;
    return (
      <button
        data-testid="members__quota-template-apply-confirm"
        onClick={() => onApply(['m_1', 'm_2']).catch(() => {})}
      >
        apply
      </button>
    );
  },
}));

import { QuotaTemplatesSection } from '../QuotaTemplatesSection';
import {
  useQuotaTemplates,
  useCreateQuotaTemplate,
  useUpdateQuotaTemplate,
  useDeleteQuotaTemplate,
  useBatchApplyQuotaTemplate,
  useMembers,
} from '@/lib/hooks/use-members';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';

const mockUseQuotaTemplates = vi.mocked(useQuotaTemplates);
const mockUseCreateQuotaTemplate = vi.mocked(useCreateQuotaTemplate);
const mockUseUpdateQuotaTemplate = vi.mocked(useUpdateQuotaTemplate);
const mockUseDeleteQuotaTemplate = vi.mocked(useDeleteQuotaTemplate);
const mockUseBatchApplyQuotaTemplate = vi.mocked(useBatchApplyQuotaTemplate);
const mockUseMembers = vi.mocked(useMembers);
const mockUseCanManageMemberGovernance = vi.mocked(useCanManageMemberGovernance);
const STABLE_QUOTA_TEMPLATES_QUERY = {
  data: [
    {
      id: 'quota_tpl_1',
      name: 'Quota Template 1',
      description: 'quota',
      overrides_json: { max_requests_per_day: 1000 },
    },
  ],
  isLoading: false,
} as never;
const STABLE_EMPTY_MEMBERS_QUERY = { data: [] } as never;

describe('QuotaTemplatesSection', () => {
  const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
  const mockBatchApplyMutateAsync = vi.fn().mockResolvedValue({});

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCanManageMemberGovernance.mockReturnValue(true);
    mockUseQuotaTemplates.mockReturnValue(STABLE_QUOTA_TEMPLATES_QUERY);
    mockUseMembers.mockReturnValue(STABLE_EMPTY_MEMBERS_QUERY);
    mockUseCreateQuotaTemplate.mockReturnValue({ mutateAsync: vi.fn() } as never);
    mockUseUpdateQuotaTemplate.mockReturnValue({ mutateAsync: vi.fn() } as never);
    mockUseDeleteQuotaTemplate.mockReturnValue({
      mutateAsync: mockDeleteMutateAsync,
      isPending: false,
    } as never);
    mockUseBatchApplyQuotaTemplate.mockReturnValue({
      mutateAsync: mockBatchApplyMutateAsync,
    } as never);
  });

  it('applies a quota template to selected members', async () => {
    const user = userEvent.setup();
    render(<QuotaTemplatesSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByRole('button', { name: /apply_to_member/i }));
    await user.click(screen.getByTestId('members__quota-template-apply-confirm'));

    await waitFor(() => {
      expect(mockBatchApplyMutateAsync).toHaveBeenCalledWith({
        templateId: 'quota_tpl_1',
        memberIds: ['m_1', 'm_2'],
      });
    });
  });

  it('deletes a quota template after confirmation', async () => {
    const user = userEvent.setup();
    render(<QuotaTemplatesSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__quota-template-delete-btn--quota_tpl_1'));
    await user.click(screen.getByTestId('members__quota-template-delete-confirm'));

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('quota_tpl_1');
    });
  });
});
