import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number; name?: string }) => {
    if (key === 'permissions_count' && values?.count !== undefined) {
      return `permissions_count_${values.count}`;
    }
    if (key === 'delete_confirm_message' && values?.name) {
      return `delete_confirm_message_${values.name}`;
    }
    return key;
  },
}));

vi.mock('@/lib/hooks/use-members', () => ({
  usePermissionTemplates: vi.fn(),
  useCreatePermissionTemplate: vi.fn(),
  useUpdatePermissionTemplate: vi.fn(),
  useDeletePermissionTemplate: vi.fn(),
  useBatchApplyPermissionTemplate: vi.fn(),
  useMembers: vi.fn(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanManageMemberGovernance: vi.fn(),
}));

vi.mock('../CreateTemplateDrawer', () => ({
  CreateTemplateDrawer: () => null,
}));

vi.mock('../ApplyTemplateDialog', () => ({
  ApplyTemplateDialog: ({
    open,
    onApply,
  }: {
    open: boolean;
    onApply: (
      memberIds: string[],
      permissions: string[],
      template?: 'admin' | 'developer' | 'user' | null
    ) => Promise<{ failedMemberIds?: string[]; failedCount?: number } | void>;
  }) => {
    if (!open) return null;
    return (
      <button
        data-testid="members__permission-template-apply-confirm"
        onClick={() => onApply(['m_1', 'm_2'], ['project:endpoint:use'], 'admin').catch(() => {})}
      >
        apply
      </button>
    );
  },
}));

vi.mock('../EditTemplateDrawer', () => ({
  EditTemplateDrawer: () => null,
}));

import { PermissionTemplatesTab } from '../PermissionTemplatesTab';
import {
  usePermissionTemplates,
  useCreatePermissionTemplate,
  useUpdatePermissionTemplate,
  useDeletePermissionTemplate,
  useBatchApplyPermissionTemplate,
  useMembers,
} from '@/lib/hooks/use-members';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';

const mockUsePermissionTemplates = vi.mocked(usePermissionTemplates);
const mockUseCreatePermissionTemplate = vi.mocked(useCreatePermissionTemplate);
const mockUseUpdatePermissionTemplate = vi.mocked(useUpdatePermissionTemplate);
const mockUseDeletePermissionTemplate = vi.mocked(useDeletePermissionTemplate);
const mockUseBatchApplyPermissionTemplate = vi.mocked(useBatchApplyPermissionTemplate);
const mockUseMembers = vi.mocked(useMembers);
const mockUseCanManageMemberGovernance = vi.mocked(useCanManageMemberGovernance);
const STABLE_PERMISSION_TEMPLATES_QUERY = {
  data: [
    {
      id: 'tpl_custom',
      name: 'Custom Template',
      description: 'custom',
      permissions: ['project:endpoint:use'],
      is_default: false,
      is_readonly: false,
    },
  ],
  isLoading: false,
} as never;
const STABLE_EMPTY_MEMBERS_QUERY = { data: [] } as never;

describe('PermissionTemplatesTab', () => {
  const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
  const mockBatchApplyMutateAsync = vi.fn().mockResolvedValue({});

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCanManageMemberGovernance.mockReturnValue(true);
    mockUsePermissionTemplates.mockReturnValue(STABLE_PERMISSION_TEMPLATES_QUERY);
    mockUseMembers.mockReturnValue(STABLE_EMPTY_MEMBERS_QUERY);
    mockUseCreatePermissionTemplate.mockReturnValue({ mutateAsync: vi.fn() } as never);
    mockUseUpdatePermissionTemplate.mockReturnValue({ mutateAsync: vi.fn() } as never);
    mockUseDeletePermissionTemplate.mockReturnValue({
      mutateAsync: mockDeleteMutateAsync,
      isPending: false,
    } as never);
    mockUseBatchApplyPermissionTemplate.mockReturnValue({ mutateAsync: mockBatchApplyMutateAsync } as never);
  });

  it('deletes a custom permission template after confirmation', async () => {
    const user = userEvent.setup();

    render(<PermissionTemplatesTab workspaceId="ws_1" projectId="proj_1" />);

    const deleteBtn = screen.getByTestId('members__permission-template-delete-btn--tpl_custom');
    await user.click(deleteBtn);

    expect(screen.getByText('permission_delete_confirm_title')).toBeInTheDocument();
    const confirmBtn = screen.getByTestId('members__permission-template-delete-confirm');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('tpl_custom');
    });
  });

  it('applies a permission template to selected members', async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<PermissionTemplatesTab workspaceId="ws_1" projectId="proj_1" />);

    const deleteBtn = screen.getByTestId('members__permission-template-delete-btn--tpl_custom');
    const templateCard = deleteBtn.closest('.border.border-border.rounded-md.p-4.space-y-3');
    expect(templateCard).toBeTruthy();
    await user.click(within(templateCard as HTMLElement).getByRole('button', { name: /view_details/i }));
    await user.click(screen.getByRole('button', { name: /apply_to_member/i }));
    fireEvent.click(screen.getByTestId('members__permission-template-apply-confirm'));

    await waitFor(() => {
      expect(mockBatchApplyMutateAsync).toHaveBeenCalledWith({
        memberIds: ['m_1', 'm_2'],
        permissions: ['project:endpoint:use'],
        template: 'admin',
      });
    });

    const hasMissingDescriptionWarning = [...warnSpy.mock.calls, ...errorSpy.mock.calls].some(
      (args) => args.some((arg) => String(arg).includes('Missing `Description`'))
    );
    expect(hasMissingDescriptionWarning).toBe(false);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('hides management actions for project admins without owner controls', () => {
    mockUseCanManageMemberGovernance.mockReturnValue(false);

    render(<PermissionTemplatesTab workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.queryByRole('button', { name: 'create_template' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('members__permission-template-delete-btn--tpl_custom')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply_to_member/i })).not.toBeInTheDocument();
  });
});
