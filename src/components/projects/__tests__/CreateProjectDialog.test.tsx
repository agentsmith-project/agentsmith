import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateProjectDialog } from '../CreateProjectDialog';

const mockCreate = vi.fn();
const mockHandleErrorForToast = vi.fn();

const messages = {
  project: {
    create: 'Create Project',
    create_description: 'Create a new project',
    dialog_guidance_title: 'Create a clean project entry',
    dialog_guidance_description: 'Set the basic scope now. Visibility and join policy can be adjusted later from project settings.',
    dialog_basics_title: 'Project basics',
    dialog_access_title: 'Access defaults',
    name: 'Name',
    description: 'Description',
    visibility: 'Visibility',
    public: 'Public',
    private: 'Private',
    join_policy: 'Join Policy',
    approval_required: 'Approval Required',
    open: 'Open',
  },
  common: {
    cancel: 'Cancel',
    create: 'Create',
    placeholders: {
      enter_description: 'Enter description',
    },
  },
};

function resolveTranslation(path: string): string {
  const segments = path.split('.');
  let current: unknown = messages;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) return path;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : path;
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => resolveTranslation(`${namespace}.${key}`),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  handleErrorForToast: (error: unknown) => mockHandleErrorForToast(error),
  ProjectAPI: class {
    create = mockCreate;
  },
}));

function renderDialog(props?: Partial<ComponentProps<typeof CreateProjectDialog>>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws_1"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('CreateProjectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'proj_1' });
  });

  it('organizes the create flow as a continuous sheet scaffold', () => {
    renderDialog();

    expect(screen.getByTestId('create-project__scaffold')).toHaveAttribute(
      'data-structure',
      'continuous-sections',
    );
    expect(screen.getByTestId('create-project__intro')).toHaveTextContent(
      'Create a clean project entry',
    );
    expect(screen.getByTestId('create-project__section--basics')).toHaveTextContent(
      'Project basics',
    );
    expect(screen.getByTestId('create-project__section--access')).toHaveTextContent(
      'Access defaults',
    );
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('keeps create disabled until a project name is entered', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Project' } });
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('submits the default project creation payload and closes on success', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderDialog({ onOpenChange, onSuccess });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Project' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Launch scope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('ws_1', {
        workspace_id: 'ws_1',
        name: 'New Project',
        description: 'Launch scope',
        visibility: 'private',
        join_policy: 'approval_required',
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledWith('proj_1');
  });

  it('routes API failures through the shared toast error handler', async () => {
    const error = new Error('create_failed');
    mockCreate.mockRejectedValue(error);
    renderDialog();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockHandleErrorForToast).toHaveBeenCalledWith(error);
    });
  });
});
