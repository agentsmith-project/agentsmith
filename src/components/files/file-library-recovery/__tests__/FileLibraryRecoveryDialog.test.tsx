import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLibraryRecoveryDialog } from '../FileLibraryRecoveryDialog';

const {
  mockRefetchActiveRestorePreview,
  mockRefetchSavePoints,
  mockCancelRestore,
  mockCreateSavePoint,
  mockCreateTemplate,
  mockDeleteTemplate,
  mockListSavePoints,
  mockListTemplates,
  mockPublishTemplate,
  mockReleaseRuntimeAccess,
  mockRunRestore,
  mockActiveRestorePreviewQueryState,
  mockSavePointsQueryState,
  mockUnpublishTemplate,
  mockCreateRestorePreview,
  mockUseCreateSavePointOptions,
  mockUseRunRestoreOptions,
} = vi.hoisted(() => ({
  mockRefetchActiveRestorePreview: vi.fn(),
  mockRefetchSavePoints: vi.fn(),
  mockCancelRestore: vi.fn(),
  mockCreateSavePoint: vi.fn(),
  mockCreateTemplate: vi.fn(),
  mockDeleteTemplate: vi.fn(),
  mockListSavePoints: vi.fn(),
  mockListTemplates: vi.fn(),
  mockPublishTemplate: vi.fn(),
  mockReleaseRuntimeAccess: vi.fn(),
  mockRunRestore: vi.fn(),
  mockActiveRestorePreviewQueryState: vi.fn(),
  mockSavePointsQueryState: vi.fn(),
  mockUnpublishTemplate: vi.fn(),
  mockCreateRestorePreview: vi.fn(),
  mockUseCreateSavePointOptions: vi.fn(),
  mockUseRunRestoreOptions: vi.fn(),
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
  useCancelFileLibraryRestore: () => ({ mutateAsync: mockCancelRestore, isPending: false }),
  useCreateFileLibraryRestorePreview: () => ({ mutateAsync: mockCreateRestorePreview, isPending: false }),
  useCreateFileLibrarySavePoint: (options?: unknown) => {
    mockUseCreateSavePointOptions(options);
    return { mutateAsync: mockCreateSavePoint, isPending: false };
  },
  useFileLibraryActiveRestorePreview: () => mockActiveRestorePreviewQueryState(),
  useFileLibrarySavePoints: () => mockSavePointsQueryState(),
  useReleaseFileLibraryRuntimeAccess: () => ({ mutateAsync: mockReleaseRuntimeAccess, isPending: false }),
  useRunFileLibraryRestore: (options?: unknown) => {
    mockUseRunRestoreOptions(options);
    return { mutateAsync: mockRunRestore, isPending: false };
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
    'file_manager.file_state_dialog_description': '{name}. Save points, restore, and task file templates apply to the whole file library HOME payload.',
    'file_manager.file_state_dialog_no_library': 'No ready file library is selected.',
    'file_manager.file_state_scope_notice': 'This includes system folders. Restore changes files only; conversations and traces stay unchanged.',
    'file_manager.file_states': 'File states',
    'file_manager.save_point_create': 'Save current state',
    'file_manager.save_point_empty': 'No save points yet',
    'file_manager.save_point_load_error_description': 'Save points could not be loaded. Retry before choosing a restore point.',
    'file_manager.save_point_load_error_title': 'Could not load save points',
    'file_manager.save_point_preparing_description': 'Save points are still syncing. Retry in a moment, or use the button to check again now.',
    'file_manager.save_point_preparing_title': 'Save points are syncing',
    'file_manager.save_point_message': 'Save point note',
    'file_manager.save_point_message_placeholder': 'e.g. Before prompt edits',
    'file_manager.save_point_retry': 'Retry',
    'file_manager.save_point_scope_hint': 'Save a snapshot of the whole file library HOME payload before major file changes.',
    'file_manager.save_point_action_failed_title': 'Save point needs attention',
    'file_manager.save_point_action_failed': 'Save point could not be created. Your note is still here; try again after the file library is ready.',
    'file_manager.save_point_active_writer_blocked': 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
    'file_manager.save_point_operation_pending': 'File state is still being updated. Wait for the current file operation to finish, then try again.',
    'file_manager.save_point_storage_not_ready': 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
    'file_manager.save_points': 'Save points',
    'file_manager.restore': 'Restore',
    'file_manager.restore_cancel': 'Cancel restore',
    'file_manager.restore_confirm': 'Restore files',
    'file_manager.restore_runtime_open_task': 'Open task',
    'file_manager.restore_runtime_release': 'Release task workspace usage',
    'file_manager.restore_runtime_release_blocked': 'Task workspace usage is still blocked by active task activity. Stop the active run or terminal, then try again.',
    'file_manager.restore_runtime_release_failed': 'Task workspace usage could not be released. Check the task, then try again.',
    'file_manager.restore_runtime_release_failed_title': 'Could not release task workspace usage',
    'file_manager.restore_runtime_release_pending': 'Task workspace usage is being released. Restore after it finishes, or retry in a moment.',
    'file_manager.restore_runtime_release_pending_title': 'Release pending',
    'file_manager.restore_run_active_writer_description': 'Before restoring an earlier version, release writable runtime access for this task workspace. This is a manual action; after it completes, click Restore files again.',
    'file_manager.restore_run_active_writer_task': 'Task using this workspace: {title}',
    'file_manager.restore_run_active_writer_title': 'Restore blocked',
    'file_manager.restore_run_failed': 'Restore could not start. Check the file library state, then try again.',
    'file_manager.restore_run_failed_title': 'Restore needs attention',
    'file_manager.restore_preview_blocked_default': 'Restore is blocked until the file library is ready for a new preview.',
    'file_manager.restore_preview_blocked_active_writer': 'Before restoring an earlier version, release writable runtime access for this task workspace. This is a manual action; after it completes, click Restore files again.',
    'file_manager.restore_preview_blocked_stale_writer_uncertain': 'Files may still be changing. Refresh and create a new preview before restoring.',
    'file_manager.restore_preview_blocked_stale': 'The preview is out of date. Create a new preview before restoring.',
    'file_manager.restore_preview_blocked_recovery': 'The restore preview needs recovery. Create a new preview before restoring.',
    'file_manager.restore_preview_blockers_title': 'Needs attention',
    'file_manager.restore_preview_canceling_summary': 'The cancel request is being reconciled. Template publishing stays blocked until it clears.',
    'file_manager.restore_preview_canceling_title': 'Canceling restore preview',
    'file_manager.restore_preview_failed_default': 'The preview failed. Create a new preview before restoring.',
    'file_manager.restore_preview_failed_title': 'Restore preview failed',
    'file_manager.restore_preview_not_ready_default': 'The preview is not ready yet. Wait or create a new preview.',
    'file_manager.restore_preview_preparing_summary': 'Comparing this save point with the current file library HOME payload. Restore will be available when the preview is ready.',
    'file_manager.restore_preview_preparing_title': 'Preparing restore preview',
    'file_manager.restore_preview_ready': 'Ready to restore {name}',
    'file_manager.restore_preview_restoring_summary': 'The restore is running. Template publishing stays blocked until file state settles.',
    'file_manager.restore_preview_restoring_title': 'Restoring files',
    'file_manager.restore_preview_stale_default': 'The preview is out of date. Create a new preview before restoring.',
    'file_manager.restore_preview_summary_counts': 'Added {added}, changed {changed}, removed {removed}.',
    'file_manager.restore_preview_summary_default': 'Restore will replace the whole file library HOME payload with this save point. Conversations and traces stay unchanged.',
    'file_manager.restore_preview_target_default': 'selected save point',
    'file_manager.restore_status_checking': 'Checking restore state before template publishing.',
    'file_manager.task_template_description': 'Description',
    'file_manager.task_template_description_placeholder': 'Optional',
    'file_manager.task_template_empty': 'No task file templates yet',
    'file_manager.task_template_action_failed': 'Task file template could not be updated. Your form is still here; try again after the project is ready.',
    'file_manager.task_template_action_failed_title': 'Template action needs attention',
    'file_manager.task_template_capability_denied': 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
    'file_manager.task_template_active_writer_blocked': 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
    'file_manager.task_template_storage_not_ready': 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
    'file_manager.task_template_name': 'Template name',
    'file_manager.task_template_name_placeholder': 'e.g. Release notes starter',
    'file_manager.task_template_operation_pending': 'File state is still being updated. Wait for the current file operation to finish, then try again.',
    'file_manager.task_template_publish_current': 'Publish current state',
    'file_manager.task_template_restore_active': 'A restore preview is still open. Cancel or finish it before publishing task file templates.',
    'file_manager.task_template_restore_pending': 'Cancel or finish this restore preview before publishing task file templates.',
    'file_manager.task_template_scope_hint': 'Publish a reusable task file template from the whole file library HOME payload.',
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
    mockActiveRestorePreviewQueryState.mockImplementation(() => ({
      data: { restore_preview: null },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    }));
    mockRefetchActiveRestorePreview.mockResolvedValue(undefined);
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
      {
        id: 'tmpl_published',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        source_library_id: 'lib_1',
        name: 'Published starter',
        status: 'published',
        created_by_user_id: 'user_001',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:00.000Z',
      },
    ]);
    mockCreateRestorePreview.mockResolvedValue({
      id: 'rp_1',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      message: 'Before edits',
      status: 'ready',
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
      is_stale: true,
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:01:00.000Z',
    });
    mockRunRestore.mockResolvedValue({
      id: 'rr_1',
      file_library_id: 'lib_1',
      restore_preview_id: 'rp_1',
      status: 'succeeded',
      created_at: '2026-05-09T12:02:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    });
    mockCancelRestore.mockResolvedValue({
      id: 'rp_1',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      status: 'canceled',
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:03:00.000Z',
    });
    mockCreateSavePoint.mockResolvedValue({
      id: 'sp_new',
      file_library_id: 'lib_1',
      message: 'Before prompt edits',
      created_at: '2026-05-09T12:04:00.000Z',
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

  it('creates save points and confirms restore through preview/run', async () => {
    const user = userEvent.setup();
    mockCreateSavePoint.mockImplementationOnce(async () => {
      const savePoint = {
        id: 'sp_new',
        file_library_id: 'lib_1',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:04:00.000Z',
      };
      mockListSavePoints.mockReturnValue([
        savePoint,
        {
          id: 'sp_1',
          file_library_id: 'lib_1',
          message: 'Before edits',
          created_at: '2026-05-09T12:00:00.000Z',
        },
      ]);
      return savePoint;
    });
    renderDialog();

    expect(screen.getByTestId('files__file-states-scope')).toHaveTextContent(
      'This includes system folders. Restore changes files only; conversations and traces stay unchanged.',
    );

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    expect(mockCreateSavePoint).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
      message: 'Before prompt edits',
    });
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('');
    expect(await screen.findByText('Before prompt edits')).toBeInTheDocument();
    expect(screen.getByText('Before edits')).toBeInTheDocument();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    await waitFor(() => {
      expect(mockCreateRestorePreview).toHaveBeenCalledWith({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        libraryId: 'lib_1',
        savePointId: 'sp_1',
      });
    });
    expect(screen.getByTestId('files__restore-preview')).toHaveTextContent('Ready to restore Before edits');
    expect(screen.getByTestId('files__restore-preview-summary')).toHaveTextContent(
      'Added 1, changed 2, removed 1.',
    );

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(mockRunRestore).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
      restorePreviewId: 'rp_1',
    });
  });

  it('uses inline-only save point errors so typed blockers do not also raise a global toast', () => {
    renderDialog();

    expect(mockUseCreateSavePointOptions).toHaveBeenCalledWith({ suppressErrorToast: true });
  });

  it('uses inline-only restore run errors so active-writer blockers do not also raise a global toast', () => {
    renderDialog();

    expect(mockUseRunRestoreOptions).toHaveBeenCalledWith({ suppressErrorToast: true });
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
    expect(screen.getByTestId('files__save-point__error')).not.toHaveTextContent(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
    );
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Before prompt edits');
    expect(screen.getByTestId('files__save-point__create')).toBeEnabled();
  });

  it('blocks duplicate save point creation while a pending operation is recovering', async () => {
    const user = userEvent.setup();
    mockCreateSavePoint.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_OPERATION_PENDING',
      'file_library_operation_pending',
      'req-save-point-pending',
      409,
    ));
    const { rerender } = renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    expect(await screen.findByTestId('files__save-point__pending')).toHaveTextContent(
      'Save points are syncing',
    );
    expect(screen.getByTestId('files__save-point__pending')).toHaveTextContent(
      'File state is still being updated. Wait for the current file operation to finish, then try again.',
    );
    expect(screen.queryByTestId('files__save-point__error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__save-point__list-error')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load save points')).not.toBeInTheDocument();
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Before prompt edits');
    expect(screen.getByTestId('files__save-point__message')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__create')).toBeDisabled();
    await user.click(screen.getByTestId('files__save-point__create'));
    expect(mockCreateSavePoint).toHaveBeenCalledTimes(1);
    expect(mockRefetchSavePoints).toHaveBeenCalled();

    mockSavePointsQueryState.mockReturnValue({
      data: {
        items: [
          {
            id: 'sp_after_pending',
            file_library_id: 'lib_1',
            message: 'Before prompt edits',
            created_at: '2026-05-09T12:06:00.000Z',
          },
        ],
      },
      dataUpdatedAt: 2,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    });
    rerender(
      <FileLibraryRecoveryDialog
        open
        library={library}
        projectId="proj_001"
        t={t}
        workspaceId="ws_default"
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('files__save-point__pending')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Before prompt edits')).toBeInTheDocument();
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('');
    expect(screen.getByTestId('files__save-point__create')).toBeEnabled();
  });

  it('clears pending and preserves the draft when a busy create was not accepted', async () => {
    const user = userEvent.setup();
    mockCreateSavePoint.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_OPERATION_PENDING',
      'file_library_operation_pending',
      'req-save-point-busy',
      409,
    ));
    const { rerender } = renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Retry after current save');
    await user.click(screen.getByTestId('files__save-point__create'));

    expect(await screen.findByTestId('files__save-point__pending')).toBeInTheDocument();
    expect(screen.getByTestId('files__save-point__message')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__create')).toBeDisabled();

    mockSavePointsQueryState.mockReturnValue({
      data: {
        items: [
          {
            id: 'sp_1',
            file_library_id: 'lib_1',
            message: 'Before edits',
            created_at: '2026-05-09T12:00:00.000Z',
          },
        ],
      },
      dataUpdatedAt: 2,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    });
    rerender(
      <FileLibraryRecoveryDialog
        open
        library={library}
        projectId="proj_001"
        t={t}
        workspaceId="ws_default"
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('files__save-point__pending')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Retry after current save');
    expect(screen.getByTestId('files__save-point__create')).toBeEnabled();
    expect(mockCreateSavePoint).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable save-point list error instead of an empty state', async () => {
    const user = userEvent.setup();
    mockSavePointsQueryState.mockReturnValue({
      data: undefined,
      error: new Error('savepoint list failed'),
      isError: true,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    });

    renderDialog();

    expect(screen.getByTestId('files__save-point__list-error')).toHaveTextContent('Could not load save points');
    expect(screen.getByTestId('files__save-point__list-error')).toHaveTextContent(
      'Save points could not be loaded. Retry before choosing a restore point.',
    );
    expect(screen.queryByText('No save points yet')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('files__save-point__retry'));

    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });

  it('shows operation-pending save-point lists as recoverable while keeping cached restore points visible', async () => {
    const user = userEvent.setup();
    mockSavePointsQueryState.mockReturnValue({
      data: {
        items: [
          {
            id: 'sp_cached',
            file_library_id: 'lib_1',
            message: 'Before risky edits',
            created_at: '2026-05-09T12:00:00.000Z',
          },
        ],
      },
      error: new APIError(
        'FILE_LIBRARY_OPERATION_PENDING',
        'file_library_operation_pending',
        'req-save-point-list-pending',
        409,
      ),
      isError: true,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    });

    renderDialog();

    expect(screen.queryByTestId('files__save-point__list-error')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load save points')).not.toBeInTheDocument();
    expect(screen.getByTestId('files__save-point__list-recovering')).toHaveTextContent(
      'Save points are syncing',
    );
    expect(screen.getByText('Before risky edits')).toBeInTheDocument();
    expect(screen.getByTestId('files__save-point__restore--sp_cached')).toBeEnabled();

    await user.click(screen.getByTestId('files__save-point__retry'));

    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });

  it('shows restore preview blockers and disables confirm when preview is failed', async () => {
    const user = userEvent.setup();
    mockCreateRestorePreview.mockResolvedValueOnce({
      id: 'rp_blocked',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      message: 'Before edits',
      status: 'failed',
      summary: {
        added: { count: 0, samples: [] },
        changed: { count: 0, samples: [] },
        removed: { count: 0, samples: [] },
        destructive: false,
      },
      blockers: [
        { code: 'restore_preview_stale', message: 'Create a new preview after refreshing file states.' },
      ],
      stale: true,
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:01:00.000Z',
    });
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-preview-summary')).toHaveTextContent(
      'The preview is out of date. Create a new preview before restoring.',
    );
    expect(screen.getByTestId('files__restore-preview-blockers')).toHaveTextContent(
      'The preview is out of date. Create a new preview before restoring.',
    );
    expect(screen.getByTestId('files__restore-preview-blockers')).not.toHaveTextContent(
      'Create a new preview after refreshing file states.',
    );
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(mockRunRestore).not.toHaveBeenCalled();
  });

  it.each([
    ['active_writer_sessions', 'Before restoring an earlier version, release writable runtime access for this task workspace. This is a manual action; after it completes, click Restore files again.'],
    ['stale_writer_session_uncertain', 'Files may still be changing. Refresh and create a new preview before restoring.'],
    ['restore_preview_stale', 'The preview is out of date. Create a new preview before restoring.'],
    ['restore_plan_requires_recovery', 'The restore preview needs recovery. Create a new preview before restoring.'],
  ] as const)('uses product copy for restore preview blocker fallback %s', async (code, expected) => {
    const user = userEvent.setup();
    mockCreateRestorePreview.mockResolvedValueOnce({
      id: `rp_blocked_${code}`,
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      message: 'Before edits',
      status: 'ready',
      blockers: [{ code }],
      stale: false,
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:01:00.000Z',
    });
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-preview-blockers')).toHaveTextContent(expected);
    expect(screen.getByTestId('files__restore-preview-blockers')).not.toHaveTextContent(
      'Restore is blocked until the file library is ready for a new preview.',
    );
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
  });

  it('uses generic localized copy instead of raw backend text for unknown restore preview blockers', async () => {
    const user = userEvent.setup();
    mockCreateRestorePreview.mockResolvedValueOnce({
      id: 'rp_blocked_unknown',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      message: 'Before edits',
      status: 'ready',
      blockers: [{
        code: 'backend_internal_lock' as never,
        message: 'AFSCP namespace lock failed at raw mount /var/lib/internal',
      }],
      stale: false,
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:01:00.000Z',
    });
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-preview-blockers')).toHaveTextContent(
      'Restore is blocked until the file library is ready for a new preview.',
    );
    expect(screen.getByTestId('files__restore-preview-blockers')).not.toHaveTextContent('AFSCP');
    expect(screen.getByTestId('files__restore-preview-blockers')).not.toHaveTextContent('/var/lib/internal');
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
  });

  it('treats stale restore previews as blocked even when no blockers are returned', async () => {
    const user = userEvent.setup();
    mockCreateRestorePreview.mockResolvedValueOnce({
      id: 'rp_stale',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      message: 'Before edits',
      status: 'ready',
      stale: true,
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:01:00.000Z',
    });
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-preview-summary')).toHaveTextContent(
      'The preview is out of date. Create a new preview before restoring.',
    );
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
  });

  it('loads an active restore preview from backend projection when opened', async () => {
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'previewing',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    expect(screen.getByTestId('files__restore-preview-title')).toHaveTextContent('Preparing restore preview');
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Task file templates' })).toBeDisabled();
    expect(mockCreateRestorePreview).not.toHaveBeenCalled();
  });

  it('keeps a pending restore run in restoring state from the active backend projection', () => {
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_restoring',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'restoring',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:02:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    expect(screen.getByTestId('files__restore-preview-title')).toHaveTextContent('Restoring files');
    expect(screen.getByTestId('files__restore-preview-summary')).toHaveTextContent(
      'The restore is running. Template publishing stays blocked until file state settles.',
    );
    expect(screen.getByTestId('files__restore-preview-title')).not.toHaveTextContent('Ready to restore');
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    expect(screen.getByTestId('files__restore-cancel')).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Task file templates' })).toBeDisabled();
  });

  it('enables restore when the active backend projection is ready', async () => {
    const user = userEvent.setup();
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_ready',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          summary: {
            added: { count: 0, samples: [] },
            changed: { count: 1, samples: ['docs/readme.md'] },
            removed: { count: 0, samples: [] },
            destructive: true,
          },
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    expect(screen.getByTestId('files__restore-preview-title')).toHaveTextContent('Ready to restore Before edits');
    expect(screen.getByTestId('files__restore-confirm')).toBeEnabled();

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(mockRunRestore).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
      restorePreviewId: 'rp_active_ready',
    });
  });

  it('shows release action when a reopened active restore preview has a durable active-writer blocker', async () => {
    const user = userEvent.setup();
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_writer_blocked',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          blockers: [{ code: 'active_writer_sessions' }],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog({
      locale: 'en-US',
      library: {
        ...library,
        task_home_binding_status: 'bound',
        bound_task_visible: true,
        bound_task_id: 'task_bound',
        bound_task_title: 'Bound Task',
        bound_task_status: 'active',
      },
    });

    expect(screen.getByTestId('files__restore-preview-blockers')).toHaveTextContent(
      'Before restoring an earlier version, release writable runtime access for this task workspace. This is a manual action; after it completes, click Restore files again.',
    );
    expect(screen.getByTestId('files__restore-run-blocker')).toHaveTextContent('Restore blocked');
    expect(screen.getByTestId('files__restore-run-blocker')).toHaveTextContent(
      'Task using this workspace: Bound Task',
    );
    expect(screen.getByTestId('files__restore-blocker-open-task')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_bound',
    );
    expect(screen.getByTestId('files__restore-blocker-release')).toBeEnabled();
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    expect(screen.getByTestId('files__restore-cancel')).toBeEnabled();

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(mockRunRestore).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('files__restore-blocker-release'));

    expect(mockReleaseRuntimeAccess).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
    });
  });

  it('shows an inline active-writer restore blocker with visible task actions and keeps cancel available', async () => {
    const user = userEvent.setup();
    mockRunRestore.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'file_library_active_writer_blocked',
      'req-restore-blocked',
      409,
      {
        task_id: 'task_visible',
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_visible: true,
        file_library_id: 'lib_1',
      },
    ));
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_ready',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog({ locale: 'en-US' });

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(await screen.findByTestId('files__restore-run-blocker')).toHaveTextContent('Restore blocked');
    expect(screen.getByTestId('files__restore-run-blocker')).toHaveTextContent(
      'Before restoring an earlier version, release writable runtime access for this task workspace. This is a manual action; after it completes, click Restore files again.',
    );
    expect(screen.getByTestId('files__restore-run-blocker')).toHaveTextContent(
      'Task using this workspace: Visible Task',
    );
    expect(screen.getByTestId('files__restore-blocker-open-task')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_visible',
    );
    expect(screen.getByTestId('files__restore-blocker-release')).toBeEnabled();
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    expect(screen.getByTestId('files__restore-cancel')).toBeEnabled();

    await user.click(screen.getByTestId('files__restore-blocker-release'));

    expect(mockReleaseRuntimeAccess).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
    });
    expect(mockRefetchActiveRestorePreview).toHaveBeenCalled();
    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });

  it('does not leak hidden task ids when restore is blocked by an invisible active writer', async () => {
    const user = userEvent.setup();
    mockRunRestore.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'file_library_active_writer_blocked',
      'req-restore-blocked-hidden',
      409,
      {
        task_id: 'task_secret',
        bound_task_id: 'task_secret',
        bound_task_visible: false,
      },
    ));
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_ready',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(await screen.findByTestId('files__restore-run-blocker')).toHaveTextContent(
      'Before restoring an earlier version, release writable runtime access for this task workspace. This is a manual action; after it completes, click Restore files again.',
    );
    expect(screen.getByTestId('files__restore-blocker-release')).toBeEnabled();
    expect(screen.queryByTestId('files__restore-blocker-open-task')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('task_secret');

    await user.click(screen.getByTestId('files__restore-blocker-release'));

    expect(mockReleaseRuntimeAccess).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
    });
    expect(document.body.textContent).not.toContain('task_secret');
  });

  it('shows typed inline release errors without dropping the restore blocker', async () => {
    const user = userEvent.setup();
    mockRunRestore.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'file_library_active_writer_blocked',
      'req-restore-blocked',
      409,
      {
        task_id: 'task_visible',
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_visible: true,
        file_library_id: 'lib_1',
      },
    ));
    mockReleaseRuntimeAccess.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
      'file_library_runtime_access_release_blocked',
      'req-release-conflict',
      409,
      {
        file_library_id: 'lib_1',
        blockers: [{ code: 'active_run' }],
      },
    ));
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_ready',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    await user.click(screen.getByTestId('files__restore-confirm'));
    await user.click(await screen.findByTestId('files__restore-blocker-release'));

    expect(await screen.findByTestId('files__restore-release-error')).toHaveTextContent(
      'Could not release task workspace usage',
    );
    expect(screen.getByTestId('files__restore-release-error')).toHaveTextContent(
      'Task workspace usage is still blocked by active task activity. Stop the active run or terminal, then try again.',
    );
    expect(screen.getByTestId('files__restore-run-blocker')).toBeInTheDocument();
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
  });

  it('keeps the restore blocker when runtime access release is still pending', async () => {
    const user = userEvent.setup();
    mockRunRestore.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'file_library_active_writer_blocked',
      'req-restore-blocked',
      409,
      {
        task_id: 'task_visible',
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_visible: true,
        file_library_id: 'lib_1',
      },
    ));
    mockReleaseRuntimeAccess.mockResolvedValueOnce({
      file_library_id: 'lib_1',
      runtime_access_status: 'release_pending',
      released: false,
    });
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_ready',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    await user.click(screen.getByTestId('files__restore-confirm'));
    await user.click(await screen.findByTestId('files__restore-blocker-release'));

    expect(await screen.findByTestId('files__restore-release-pending')).toHaveTextContent('Release pending');
    expect(screen.getByTestId('files__restore-release-pending')).toHaveTextContent(
      'Task workspace usage is being released. Restore after it finishes, or retry in a moment.',
    );
    expect(screen.getByTestId('files__restore-run-blocker')).toBeInTheDocument();
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    expect(screen.getByTestId('files__restore-blocker-release')).toBeEnabled();
    expect(mockRefetchActiveRestorePreview).not.toHaveBeenCalled();
    expect(mockRefetchSavePoints).not.toHaveBeenCalled();
  });

  it('treats released runtime access status as confirmed even when the release call is idempotent', async () => {
    const user = userEvent.setup();
    mockRunRestore.mockRejectedValueOnce(new APIError(
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
    mockReleaseRuntimeAccess.mockResolvedValueOnce({
      file_library_id: 'lib_1',
      runtime_access_status: 'released',
      released: false,
    });
    mockActiveRestorePreviewQueryState.mockReturnValue({
      data: {
        restore_preview: {
          id: 'rp_active_ready',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'ready',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    });

    renderDialog();

    await user.click(screen.getByTestId('files__restore-confirm'));
    await user.click(await screen.findByTestId('files__restore-blocker-release'));

    await waitFor(() => {
      expect(screen.queryByTestId('files__restore-run-blocker')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('files__restore-release-pending')).not.toBeInTheDocument();
    expect(mockRefetchActiveRestorePreview).toHaveBeenCalled();
    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });

  it('explains that template publishing is temporarily blocked while restore state is loading', () => {
    mockActiveRestorePreviewQueryState.mockImplementation(() => ({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
      refetch: mockRefetchActiveRestorePreview,
    }));

    renderDialog();

    expect(screen.getByRole('tab', { name: 'Task file templates' })).toBeDisabled();
    expect(screen.getByTestId('files__restore-status-checking')).toHaveTextContent(
      'Checking restore state before template publishing.',
    );
  });

  it('does not block task templates when the active preview projection is failed', async () => {
    const user = userEvent.setup();
    mockActiveRestorePreviewQueryState.mockImplementation(() => ({
      data: {
        restore_preview: {
          id: 'rp_active_failed',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status: 'failed',
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    }));

    renderDialog();

    expect(screen.getByTestId('files__restore-preview-title')).toHaveTextContent('Restore preview failed');
    expect(screen.getByTestId('files__restore-preview-summary')).toHaveTextContent(
      'The preview failed. Create a new preview before restoring.',
    );
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__restore--sp_1')).toBeEnabled();
    expect(screen.queryByTestId('files__restore-template-blocker')).not.toBeInTheDocument();
    const taskTemplatesTab = screen.getByRole('tab', { name: 'Task file templates' });
    expect(taskTemplatesTab).toBeEnabled();

    await user.click(taskTemplatesTab);

    expect(screen.getByTestId('files__template__publish-current')).toBeInTheDocument();
  });

  it.each(['canceled', 'restored'] as const)('treats %s active preview projection as terminal and clears the blocker', async (status) => {
    const user = userEvent.setup();
    mockActiveRestorePreviewQueryState.mockImplementation(() => ({
      data: {
        restore_preview: {
          id: `rp_active_${status}`,
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          message: 'Before edits',
          status,
          blockers: [],
          stale: false,
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestorePreview,
    }));

    renderDialog();

    expect(screen.queryByTestId('files__restore-preview')).not.toBeInTheDocument();
    const taskTemplatesTab = screen.getByRole('tab', { name: 'Task file templates' });
    expect(taskTemplatesTab).toBeEnabled();

    await user.click(taskTemplatesTab);

    expect(screen.getByTestId('files__template__publish-current')).toBeInTheDocument();
  });

  it.each([
    {
      status: 'previewing' as const,
      title: 'Preparing restore preview',
      summary: 'Comparing this save point with the current file library HOME payload. Restore will be available when the preview is ready.',
      confirmEnabled: false,
      cancelEnabled: true,
    },
    {
      status: 'ready' as const,
      title: 'Ready to restore Before edits',
      summary: 'Added 1, changed 2, removed 1.',
      confirmEnabled: true,
      cancelEnabled: true,
    },
    {
      status: 'failed' as const,
      title: 'Restore preview failed',
      summary: 'The preview failed. Create a new preview before restoring.',
      confirmEnabled: false,
      cancelEnabled: true,
    },
    {
      status: 'canceling' as const,
      title: 'Canceling restore preview',
      summary: 'The cancel request is being reconciled. Template publishing stays blocked until it clears.',
      confirmEnabled: false,
      cancelEnabled: false,
    },
    {
      status: 'restoring' as const,
      title: 'Restoring files',
      summary: 'The restore is running. Template publishing stays blocked until file state settles.',
      confirmEnabled: false,
      cancelEnabled: false,
    },
  ])('renders %s restore preview status without misleading ready copy', async ({
    cancelEnabled,
    confirmEnabled,
    status,
    summary,
    title,
  }) => {
    const user = userEvent.setup();
    mockCreateRestorePreview.mockResolvedValueOnce({
      id: `rp_${status}`,
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      message: 'Before edits',
      status,
      summary: status === 'ready'
        ? {
            added: { count: 1, samples: ['src/new.ts'] },
            changed: { count: 2, samples: ['docs/readme.md'] },
            removed: { count: 1, samples: ['tmp/cache.txt'] },
            destructive: true,
          }
        : undefined,
      blockers: [],
      stale: false,
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:01:00.000Z',
    });
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-preview-title')).toHaveTextContent(title);
    expect(screen.getByTestId('files__restore-preview-summary')).toHaveTextContent(summary);
    if (status !== 'ready') {
      expect(screen.getByTestId('files__restore-preview-title')).not.toHaveTextContent('Ready to restore');
    }
    if (confirmEnabled) {
      expect(screen.getByTestId('files__restore-confirm')).toBeEnabled();
    } else {
      expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();
    }
    if (cancelEnabled) {
      expect(screen.getByTestId('files__restore-cancel')).toBeEnabled();
    } else {
      expect(screen.getByTestId('files__restore-cancel')).toBeDisabled();
    }
  });

  it('fails closed when no ready file library is selected', async () => {
    const user = userEvent.setup();
    renderDialog({ library: null });

    expect(screen.getByText('No ready file library is selected.')).toBeInTheDocument();
    expect(screen.getByTestId('files__save-point__message')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__create')).toBeDisabled();
    expect(screen.getByTestId('files__save-point__restore--sp_1')).toBeDisabled();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(mockCreateRestorePreview).not.toHaveBeenCalled();
  });

  it('publishes current library state as a project task template and manages existing templates', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('tab', { name: 'Task file templates' }));
    await user.type(screen.getByTestId('files__template__name'), 'Release notes starter');
    await user.type(screen.getByTestId('files__template__description'), 'Reusable task files');
    await user.click(screen.getByTestId('files__template__publish-current'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        sourceLibraryId: 'lib_1',
        name: 'Release notes starter',
        description: 'Reusable task files',
      });
    });
    expect(mockPublishTemplate).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      templateId: 'tmpl_new',
    });

    await user.click(screen.getByTestId('files__template__publish--tmpl_draft'));
    await user.click(screen.getByTestId('files__template__unpublish--tmpl_published'));
    await user.click(screen.getByTestId('files__template__delete--tmpl_draft'));

    expect(mockPublishTemplate).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      templateId: 'tmpl_draft',
    });
    expect(mockUnpublishTemplate).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      templateId: 'tmpl_published',
    });
    expect(mockDeleteTemplate).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      templateId: 'tmpl_draft',
    });
  });

  it('blocks task template publishing while a restore preview is awaiting a user decision', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));

    expect(await screen.findByTestId('files__restore-preview')).toBeVisible();
    expect(screen.getByTestId('files__restore-template-blocker')).toHaveTextContent(
      'Cancel or finish this restore preview before publishing task file templates.',
    );
    expect(screen.getByRole('tab', { name: 'Task file templates' })).toBeDisabled();
    expect(screen.queryByTestId('files__template__publish-current')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('files__restore-cancel'));

    await waitFor(() => {
      expect(mockCancelRestore).toHaveBeenCalledWith({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        libraryId: 'lib_1',
        restorePreviewId: 'rp_1',
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('files__restore-preview')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Task file templates' }));
    await user.type(screen.getByTestId('files__template__name'), 'Release notes starter');
    await user.click(screen.getByTestId('files__template__publish-current'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        sourceLibraryId: 'lib_1',
        name: 'Release notes starter',
        description: undefined,
      });
    });
    expect(mockPublishTemplate).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      templateId: 'tmpl_new',
    });
  });

  it('keeps the template form recoverable and hides raw capability-denied codes', async () => {
    const user = userEvent.setup();
    mockCreateTemplate.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_CAPABILITY_DENIED',
      'file_library_capability_denied',
      'req-capability',
      403,
    ));
    renderDialog();

    await user.click(screen.getByRole('tab', { name: 'Task file templates' }));
    await user.type(screen.getByTestId('files__template__name'), 'Release notes starter');
    await user.type(screen.getByTestId('files__template__description'), 'Reusable task files');
    await user.click(screen.getByTestId('files__template__publish-current'));

    expect(await screen.findByTestId('files__template__error')).toHaveTextContent(
      'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
    );
    expect(screen.getByTestId('files__template__error')).not.toHaveTextContent('file_library_capability_denied');
    expect(screen.getByTestId('files__template__error')).not.toHaveTextContent('FILE_LIBRARY_CAPABILITY_DENIED');
    expect(screen.getByTestId('files__template__name')).toHaveValue('Release notes starter');
    expect(screen.getByTestId('files__template__description')).toHaveValue('Reusable task files');
    expect(screen.getByTestId('files__template__publish-current')).toBeEnabled();
  });

  it.each([
    {
      errorCode: 'FILE_LIBRARY_RESTORE_PREVIEW_ACTIVE',
      rawMessage: 'file_library_restore_preview_active',
      expected: 'A restore preview is still open. Cancel or finish it before publishing task file templates.',
    },
    {
      errorCode: 'FILE_LIBRARY_OPERATION_PENDING',
      rawMessage: 'file_library_operation_pending',
      expected: 'File state is still being updated. Wait for the current file operation to finish, then try again.',
    },
    {
      errorCode: 'FILE_LIBRARY_RESTORE_OPERATION_PENDING',
      rawMessage: 'file_library_restore_operation_pending',
      expected: 'File state is still being updated. Wait for the current file operation to finish, then try again.',
    },
    {
      errorCode: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      rawMessage: 'file_library_active_writer_blocked',
      expected: 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
    },
    {
      errorCode: 'FILE_LIBRARY_STORAGE_NOT_READY',
      rawMessage: 'storage not ready',
      expected: 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
    },
    {
      errorCode: 'FILE_LIBRARY_RESTORE_PREVIEW_STALE',
      rawMessage: 'file_library_restore_preview_stale',
      expected: 'The preview is out of date. Create a new preview before restoring.',
    },
  ])('keeps template form recoverable and productizes typed template conflict %s', async ({
    errorCode,
    expected,
    rawMessage,
  }) => {
    const user = userEvent.setup();
    mockCreateTemplate.mockRejectedValueOnce(new APIError(errorCode, rawMessage, 'req-template-conflict', 409));
    renderDialog();

    await user.click(screen.getByRole('tab', { name: 'Task file templates' }));
    await user.type(screen.getByTestId('files__template__name'), 'Release notes starter');
    await user.type(screen.getByTestId('files__template__description'), 'Reusable task files');
    await user.click(screen.getByTestId('files__template__publish-current'));

    expect(await screen.findByTestId('files__template__error')).toHaveTextContent(expected);
    expect(screen.getByTestId('files__template__error')).not.toHaveTextContent(rawMessage);
    expect(screen.getByTestId('files__template__error')).not.toHaveTextContent(errorCode);
    expect(screen.getByTestId('files__template__name')).toHaveValue('Release notes starter');
    expect(screen.getByTestId('files__template__description')).toHaveValue('Reusable task files');
  });

  it('does not expose raw storage implementation wording', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('tab', { name: 'Task file templates' }));

    const text = document.body.textContent ?? '';
    for (const forbidden of ['AFSCP', 'JuiceFS', 'hidden runtime', 'repo', 'namespace', 'volume', 'raw mount', 'credential']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
