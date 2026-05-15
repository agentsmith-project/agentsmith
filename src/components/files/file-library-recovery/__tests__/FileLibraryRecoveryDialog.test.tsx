import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLibraryRecoveryDialog } from '../FileLibraryRecoveryDialog';

const {
  mockActiveRestoreOperationQueryState,
  mockCreateSavePoint,
  mockCreateTemplate,
  mockDeleteTemplate,
  mockListSavePoints,
  mockListTemplates,
  mockPublishTemplate,
  mockRefetchActiveRestoreOperation,
  mockRefetchSavePoints,
  mockReleaseRuntimeAccess,
  mockSavePointsQueryState,
  mockRestoreFileLibrary,
  mockUnpublishTemplate,
  mockUseCreateSavePointOptions,
  mockUseRestoreFileLibraryOptions,
} = vi.hoisted(() => ({
  mockActiveRestoreOperationQueryState: vi.fn(),
  mockCreateSavePoint: vi.fn(),
  mockCreateTemplate: vi.fn(),
  mockDeleteTemplate: vi.fn(),
  mockListSavePoints: vi.fn(),
  mockListTemplates: vi.fn(),
  mockPublishTemplate: vi.fn(),
  mockRefetchActiveRestoreOperation: vi.fn(),
  mockRefetchSavePoints: vi.fn(),
  mockReleaseRuntimeAccess: vi.fn(),
  mockSavePointsQueryState: vi.fn(),
  mockRestoreFileLibrary: vi.fn(),
  mockUnpublishTemplate: vi.fn(),
  mockUseCreateSavePointOptions: vi.fn(),
  mockUseRestoreFileLibraryOptions: vi.fn(),
}));

import { APIError } from '@/lib/api/errors';

vi.mock('@/lib/hooks/use-file-library-recovery', () => ({
  isFileLibraryOperationPendingError: (error: unknown) => {
    const record = error && typeof error === 'object'
      ? error as { errorCode?: string; message?: string }
      : null;
    const value = `${record?.errorCode ?? ''} ${record?.message ?? ''}`.toLowerCase();
    return value.includes('file_library_operation_pending')
      || value.includes('file_library_restore_operation_pending');
  },
  useCreateFileLibrarySavePoint: (options?: unknown) => {
    mockUseCreateSavePointOptions(options);
    return { mutateAsync: mockCreateSavePoint, isPending: false };
  },
  useFileLibraryActiveRestoreOperation: () => mockActiveRestoreOperationQueryState(),
  useFileLibrarySavePoints: () => mockSavePointsQueryState(),
  useReleaseFileLibraryRuntimeAccess: () => ({ mutateAsync: mockReleaseRuntimeAccess, isPending: false }),
  useRestoreFileLibrary: (options?: unknown) => {
    mockUseRestoreFileLibraryOptions(options);
    return { mutateAsync: mockRestoreFileLibrary, isPending: false };
  },
}));

vi.mock('@/lib/hooks/use-task-file-templates', () => ({
  useCreateTaskFileTemplate: () => ({ mutateAsync: mockCreateTemplate, isPending: false }),
  useDeleteTaskFileTemplate: () => ({ mutateAsync: mockDeleteTemplate, isPending: false }),
  usePublishTaskFileTemplate: () => ({ mutateAsync: mockPublishTemplate, isPending: false }),
  useTaskFileTemplates: () => ({ data: { items: mockListTemplates() }, isLoading: false }),
  useUnpublishTaskFileTemplate: () => ({ mutateAsync: mockUnpublishTemplate, isPending: false }),
}));

const t = (key: string, values?: Record<string, string>) => {
  const translations: Record<string, string> = {
    'file_manager.cancel': 'Cancel',
    'file_manager.close': 'Close',
    'file_manager.delete': 'Delete',
    'file_manager.file_state_dialog_description': '{name}. Save points, restore, and task file templates apply to the whole file library.',
    'file_manager.file_state_dialog_no_library': 'No ready file library is selected.',
    'file_manager.file_state_scope_notice': 'Restore changes file library files only; conversations and traces stay unchanged.',
    'file_manager.file_states': 'File states',
    'file_manager.loading': 'Loading...',
    'file_manager.restore': 'Restore',
    'file_manager.restore_active_writer_description': 'Before restoring files, release task workspace usage. After it completes, click Restore again.',
    'file_manager.restore_active_writer_task': 'Task using this workspace: {title}',
    'file_manager.restore_active_writer_title': 'Restore blocked',
    'file_manager.restore_confirm': 'Restore files',
    'file_manager.restore_confirm_cancel': 'Cancel',
    'file_manager.restore_confirm_description': 'This will replace the current file library files with the selected save point. Current file changes that were not saved to a save point will be lost. Other save points will remain, but the file library will return to this saved state. Conversations and traces will not change.',
    'file_manager.restore_confirm_helper': 'If you want to keep the current files, cancel and save the current state first.',
    'file_manager.restore_confirm_title': 'Restore to "{name}"?',
    'file_manager.restore_error_failed': 'Restore could not start. Check the file library state, then try again.',
    'file_manager.restore_error_title': 'Restore needs attention',
    'file_manager.restore_operation_failed_summary': 'Restore failed. No successful restore was applied. Review the reason and try again.',
    'file_manager.restore_operation_failed_title': 'Restore failed',
    'file_manager.restore_operation_refreshed_summary': 'No active restore is running now. The file list and save points are refreshing.',
    'file_manager.restore_operation_refreshed_title': 'Restore state refreshed',
    'file_manager.restore_operation_restoring_summary': 'Restore is updating the file library. File-changing actions stay unavailable until it finishes.',
    'file_manager.restore_operation_restoring_title': 'Restoring files...',
    'file_manager.restore_operation_succeeded_summary': 'The file library now matches the selected save point.',
    'file_manager.restore_operation_succeeded_title': 'Files restored.',
    'file_manager.restore_runtime_open_task': 'Open task',
    'file_manager.restore_runtime_release': 'Release task workspace usage',
    'file_manager.restore_runtime_release_blocked': 'Task workspace usage is still blocked by active task activity. Stop the active run or terminal, then try again.',
    'file_manager.restore_runtime_release_failed': 'Task workspace usage could not be released. Check the task, then try again.',
    'file_manager.restore_runtime_release_failed_title': 'Could not release task workspace usage',
    'file_manager.restore_runtime_release_pending': 'Task workspace usage is being released. Restore after it finishes, or retry in a moment.',
    'file_manager.restore_runtime_release_pending_title': 'Release pending',
    'file_manager.restore_status_checking': 'Checking restore state before template publishing.',
    'file_manager.save_point_action_failed': 'Save point could not be created. Your note is still here; try again after the file library is ready.',
    'file_manager.save_point_action_failed_title': 'Save point needs attention',
    'file_manager.save_point_active_writer_blocked': 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
    'file_manager.save_point_create': 'Save current state',
    'file_manager.save_point_default_name': 'Untitled save point',
    'file_manager.save_point_empty': 'No save points yet',
    'file_manager.save_point_load_error_description': 'Save points could not be loaded. Retry before choosing a restore point.',
    'file_manager.save_point_load_error_title': 'Could not load save points',
    'file_manager.save_point_message': 'Save point note',
    'file_manager.save_point_message_placeholder': 'e.g. Before prompt edits',
    'file_manager.save_point_operation_pending': 'File state is still being updated. Wait for the current file operation to finish, then try again.',
    'file_manager.save_point_preparing_description': 'Save points are still syncing. Retry in a moment, or use the button to check again now.',
    'file_manager.save_point_preparing_title': 'Save points are syncing',
    'file_manager.save_point_retry': 'Retry',
    'file_manager.save_point_scope_hint': 'Create a recovery point for the whole file library before major file changes.',
    'file_manager.save_point_storage_not_ready': 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
    'file_manager.save_points': 'Save points',
    'file_manager.task_template_action_failed': 'Task file template could not be updated. Your form is still here; try again after the project is ready.',
    'file_manager.task_template_action_failed_title': 'Template action needs attention',
    'file_manager.task_template_active_writer_blocked': 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
    'file_manager.task_template_capability_denied': 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
    'file_manager.task_template_description': 'Description',
    'file_manager.task_template_description_placeholder': 'Optional',
    'file_manager.task_template_empty': 'No task file templates yet',
    'file_manager.task_template_name': 'Template name',
    'file_manager.task_template_name_placeholder': 'e.g. Release notes starter',
    'file_manager.task_template_operation_pending': 'File state is still being updated. Wait for the current file operation to finish, then try again.',
    'file_manager.task_template_publish_current': 'Publish current state',
    'file_manager.task_template_restore_active': 'A restore is still running. Wait for it to finish before publishing task file templates.',
    'file_manager.task_template_restore_pending': 'Wait for this restore to finish before publishing task file templates.',
    'file_manager.task_template_scope_hint': 'Publish a reusable task file template from the whole file library.',
    'file_manager.task_template_status_failed': 'Failed',
    'file_manager.task_template_status_published': 'Published',
    'file_manager.task_template_status_unpublished': 'Draft',
    'file_manager.task_templates': 'Task file templates',
    'file_manager.template_publish': 'Publish',
    'file_manager.template_unpublish': 'Unpublish',
  };
  const template = translations[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? `{${name}}`);
};

const library = {
  id: 'lib_1',
  workspace_id: 'ws_default',
  project_id: 'proj_001',
  name: 'Shared Docs',
  source: 'agent_task_files' as const,
  file_library_home_segment: 'task-home-shared-docs',
  status: 'ready' as const,
  task_home_binding_status: 'unbound' as const,
  bound_task_visible: false,
  created_by_user_id: 'user_001',
  created_at: '2026-05-09T12:00:00.000Z',
  updated_at: '2026-05-09T12:00:00.000Z',
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof FileLibraryRecoveryDialog>> = {}) {
  return render(
    <FileLibraryRecoveryDialog
      open
      library={library}
      projectId="proj_001"
      t={t}
      workspaceId="ws_default"
      onOpenChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe('FileLibraryRecoveryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveRestoreOperationQueryState.mockImplementation(() => ({
      data: { restore_operation: null },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    }));
    mockRefetchActiveRestoreOperation.mockResolvedValue(undefined);
    mockSavePointsQueryState.mockImplementation(() => ({
      data: { items: mockListSavePoints() },
      dataUpdatedAt: 1,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    }));
    mockRefetchSavePoints.mockResolvedValue(undefined);
    mockListSavePoints.mockReturnValue([
      {
        id: 'sp_1',
        file_library_id: 'lib_1',
        message: 'Before edits',
        created_at: '2026-05-09T12:00:00.000Z',
      },
    ]);
    mockListTemplates.mockReturnValue([
      {
        id: 'tmpl_draft',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        source_library_id: 'lib_1',
        name: 'Draft starter',
        status: 'unpublished',
        created_by_user_id: 'user_001',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:00.000Z',
      },
    ]);
    mockCreateSavePoint.mockResolvedValue({
      id: 'sp_new',
      file_library_id: 'lib_1',
      message: 'Before prompt edits',
      created_at: '2026-05-09T12:04:00.000Z',
    });
    mockRestoreFileLibrary.mockResolvedValue({
      id: 'flro_1',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      status: 'succeeded',
      created_at: '2026-05-09T12:02:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    });
    mockCreateTemplate.mockResolvedValue({
      id: 'tmpl_new',
      workspace_id: 'ws_default',
      project_id: 'proj_001',
      source_library_id: 'lib_1',
      name: 'Release notes starter',
      status: 'unpublished',
      created_by_user_id: 'user_001',
      created_at: '2026-05-09T12:05:00.000Z',
      updated_at: '2026-05-09T12:05:00.000Z',
    });
    mockPublishTemplate.mockResolvedValue(undefined);
    mockReleaseRuntimeAccess.mockResolvedValue({ file_library_id: 'lib_1', released: true });
    mockUnpublishTemplate.mockResolvedValue(undefined);
    mockDeleteTemplate.mockResolvedValue(undefined);
  });

  it('opens destructive confirm from restore click without creating a preview', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-confirm')).toBeVisible();
    expect(screen.getByTestId('files__restore-confirm')).toHaveTextContent('Restore to "Before edits"?');
    expect(screen.getByTestId('files__restore-confirm')).toHaveTextContent(
      'Current file changes that were not saved to a save point will be lost.',
    );
    expect(mockRestoreFileLibrary).not.toHaveBeenCalled();
    expect(screen.queryByTestId('files__restore-operation')).not.toBeInTheDocument();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
  });

  it('cancels restore confirm locally without calling direct restore', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));
    await user.click(screen.getByTestId('files__restore-confirm-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('files__restore-confirm')).not.toBeInTheDocument();
    });
    expect(mockRestoreFileLibrary).not.toHaveBeenCalled();
  });

  it('confirms direct restore once with a stable idempotency key and shows success progress', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));
    await user.click(screen.getByTestId('files__restore-confirm-submit'));

    await waitFor(() => {
      expect(mockRestoreFileLibrary).toHaveBeenCalledTimes(1);
    });
    expect(mockRestoreFileLibrary).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
      savePointId: 'sp_1',
      idempotencyKey: expect.stringMatching(/^restore_sp_1_/),
    });
    expect(await screen.findByTestId('files__restore-operation')).toHaveTextContent('Files restored.');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'The file library now matches the selected save point.',
    );
  });

  it('uses inline-only restore errors so active-writer blockers do not also raise a global toast', () => {
    renderDialog();

    expect(mockUseRestoreFileLibraryOptions).toHaveBeenCalledWith({ suppressErrorToast: true });
  });

  it('keeps save point creation recoverable and productizes typed active-writer blockers', async () => {
    const user = userEvent.setup();
    mockCreateSavePoint.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'file_library_active_writer_blocked',
      'req-save-point-blocked',
      409,
    ));
    renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    expect(await screen.findByTestId('files__save-point__error')).toHaveTextContent(
      'Save point needs attention',
    );
    expect(screen.getByTestId('files__save-point__error')).toHaveTextContent(
      'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
    );
    expect(screen.getByTestId('files__save-point__error')).not.toHaveTextContent(
      'file_library_active_writer_blocked',
    );
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Before prompt edits');
  });

  it('shows active direct restore operation when reopened and blocks destructive file-state writes', () => {
    mockActiveRestoreOperationQueryState.mockReturnValue({
      data: {
        restore_operation: {
          id: 'flro_active',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          status: 'restoring',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:02:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    });

    renderDialog();

    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restoring files...');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Restore is updating the file library.',
    );
    expect(screen.getByTestId('files__save-point__message')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__create')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__restore--sp_1')).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Task file templates' })).toBeDisabled();
  });

  it('clears local restoring state when backend reports no active restore and shows a refresh notice', () => {
    let restoreOperation: unknown = {
      id: 'flro_active',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      status: 'restoring',
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    };
    mockActiveRestoreOperationQueryState.mockImplementation(() => ({
      data: { restore_operation: restoreOperation },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    }));

    const view = renderDialog();
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restoring files...');
    expect(screen.getByTestId('files__save-point__restore--sp_1')).toBeDisabled();

    restoreOperation = null;
    view.rerender(
      <FileLibraryRecoveryDialog
        open
        library={library}
        projectId="proj_001"
        t={t}
        workspaceId="ws_default"
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restore state refreshed');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'No active restore is running now. The file list and save points are refreshing.',
    );
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('Files restored.');
    expect(screen.getByTestId('files__save-point__restore--sp_1')).toBeEnabled();
    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });

  it('shows visible task actions when direct restore is blocked by an active writer', async () => {
    const user = userEvent.setup();
    mockRestoreFileLibrary.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'file_library_active_writer_blocked',
      'req-restore-blocked',
      409,
      {
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_visible: true,
        file_library_id: 'lib_1',
      },
    ));

    renderDialog({ locale: 'en-US' });

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));
    await user.click(screen.getByTestId('files__restore-confirm-submit'));

    expect(await screen.findByTestId('files__restore-operation')).toHaveTextContent('Restore blocked');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Before restoring files, release task workspace usage.',
    );
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Task using this workspace: Visible Task',
    );
    expect(screen.getByTestId('files__restore-blocker-open-task')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_visible',
    );
    expect(screen.getByTestId('files__restore-blocker-release')).toBeEnabled();

    await user.click(screen.getByTestId('files__restore-blocker-release'));

    expect(mockReleaseRuntimeAccess).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
    });
    expect(mockRefetchActiveRestoreOperation).toHaveBeenCalled();
    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });
});
