import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLibraryRecoveryDialog } from '../FileLibraryRecoveryDialog';
import enUsMessages from '@/messages/en-US.json';
import zhCnMessages from '@/messages/zh-CN.json';

const {
  mockActiveRestoreOperationQueryState,
  mockCreateSavePoint,
  mockCreateTemplate,
  mockDeleteTemplate,
  mockListSavePoints,
  mockListTemplates,
  mockPublishTemplate,
  mockRefetchActiveRestoreOperation,
  mockVersionOperationLookupState,
  mockRefetchSavePoints,
  mockRefetchTemplates,
  mockReleaseRuntimeAccess,
  mockSavePointsQueryState,
  mockRestoreFileLibrary,
  mockTemplatesQueryState,
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
  mockVersionOperationLookupState: vi.fn(),
  mockRefetchSavePoints: vi.fn(),
  mockRefetchTemplates: vi.fn(),
  mockReleaseRuntimeAccess: vi.fn(),
  mockSavePointsQueryState: vi.fn(),
  mockRestoreFileLibrary: vi.fn(),
  mockTemplatesQueryState: vi.fn(),
  mockUnpublishTemplate: vi.fn(),
  mockUseCreateSavePointOptions: vi.fn(),
  mockUseRestoreFileLibraryOptions: vi.fn(),
}));

import { APIError } from '@/lib/api/errors';

vi.mock('@/lib/hooks/use-file-library-recovery', () => ({
  getVersionOperationResultSavePointId: (operation: { result_save_point_id?: unknown } | null | undefined) => (
    typeof operation?.result_save_point_id === 'string' && operation.result_save_point_id.trim().length > 0
      ? operation.result_save_point_id.trim()
      : null
  ),
  isFileLibraryOperationPendingError: (error: unknown) => {
    const record = error && typeof error === 'object'
      ? error as { errorCode?: string; message?: string }
      : null;
    const value = `${record?.errorCode ?? ''} ${record?.message ?? ''}`.toLowerCase();
    return value.includes('file_library_operation_pending')
      || value.includes('file_library_restore_operation_pending');
  },
  restoreOperationToVersionOperation: (operation: {
    created_at: string;
    failure_reason?: string;
    file_library_id: string;
    id: string;
    source_save_point_id: string;
    status: 'pending' | 'restoring' | 'succeeded' | 'failed' | 'recovery_required';
    updated_at: string;
  }) => ({
    id: operation.id,
    kind: 'restore',
    file_library_id: operation.file_library_id,
    source_save_point_id: operation.source_save_point_id,
    status: operation.status === 'pending'
      ? 'accepted'
      : operation.status === 'restoring'
        ? 'running'
        : operation.status,
    ...(operation.failure_reason ? { failure_reason: operation.failure_reason } : {}),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
  }),
  useCreateFileLibrarySavePoint: (options?: unknown) => {
    mockUseCreateSavePointOptions(options);
    return { mutateAsync: mockCreateSavePoint, isPending: false };
  },
  useFileLibraryActiveVersionOperation: () => mockActiveRestoreOperationQueryState(),
  useFileLibrarySavePoints: () => mockSavePointsQueryState(),
  useFileLibraryVersionOperationLookup: (...args: unknown[]) => mockVersionOperationLookupState(...args),
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
  useTaskFileTemplates: () => mockTemplatesQueryState(),
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
    'file_manager.loading': 'Loading...',
    'file_manager.restore': 'Restore',
    'file_manager.restore_active_writer_description': 'Before restoring files, release task file usage. After it completes, click Restore again.',
    'file_manager.restore_active_writer_task': 'Task using these files: {title}',
    'file_manager.restore_active_writer_title': 'Restore blocked',
    'file_manager.restore_confirm': 'Restore files',
    'file_manager.restore_confirm_cancel': 'Cancel',
    'file_manager.restore_confirm_description': 'This will replace the current file library files with the selected save point. Current file changes that were not saved to a save point will be lost. Other save points will remain, but the file library will return to this saved state. Conversations and traces will not change.',
    'file_manager.restore_confirm_helper': 'If you want to keep the current files, cancel and save a restore point first.',
    'file_manager.restore_confirm_title': 'Restore to "{name}"?',
    'file_manager.restore_error_failed': 'Restore could not start. Check the file library state, then try again.',
    'file_manager.restore_error_title': 'Restore needs attention',
    'file_manager.restore_operation_failed_summary': 'Restore failed. No successful restore was applied. Check the file library state, then try again.',
    'file_manager.restore_operation_failed_title': 'Restore failed',
    'file_manager.save_point_operation_accepted_summary': 'Save point creation has been accepted. The restore point will appear after storage finishes.',
    'file_manager.save_point_operation_accepted_title': 'Saving restore point...',
    'file_manager.save_point_operation_failed_summary': 'Save point creation failed. Your files were not saved as a restore point.',
    'file_manager.save_point_operation_failed_title': 'Save point failed',
    'file_manager.save_point_operation_recovery_required_summary': 'Save point creation needs system attention before you try again.',
    'file_manager.save_point_operation_recovery_required_title': 'Save point needs system attention',
    'file_manager.save_point_operation_running_summary': 'Saving the whole file library as a restore point.',
    'file_manager.save_point_operation_running_title': 'Saving restore point...',
    'file_manager.save_point_operation_succeeded_summary': 'The restore point is saved. Refreshing the restore point list.',
    'file_manager.save_point_operation_succeeded_title': 'Restore point saved.',
    'file_manager.version_operation_idle_summary': 'There is no active save or restore update. Check the restore point list for completed updates.',
    'file_manager.version_operation_idle_title': 'No file update is running',
    'file_manager.save_point_section_description': 'Save the current whole file library content so you can restore it later.',
    'file_manager.save_point_section_title': 'Save as restore point',
    'file_manager.restore_operation_restoring_summary': 'Restore is updating the file library. File-changing actions stay unavailable until it finishes.',
    'file_manager.restore_operation_restoring_title': 'Restoring files...',
    'file_manager.restore_operation_succeeded_summary': 'The file library now matches the selected save point.',
    'file_manager.restore_operation_succeeded_title': 'Files restored.',
    'file_manager.version_save_restore_title': 'Save / restore versions',
    'file_manager.version_save_restore_entry': 'Save / restore versions',
    'file_manager.version_save_restore_dialog_description': '{name}. Save restore points and restore the whole file library.',
    'file_manager.version_save_restore_dialog_no_library': 'No ready file library is selected.',
    'file_manager.version_save_restore_scope_notice': 'Save points and restore cover the whole file library. Conversations and traces stay unchanged.',
    'file_manager.version_last_restore_title': 'Latest restore: from "{label}"',
    'file_manager.version_last_restore_restored_at': 'Restore time: {time}',
    'file_manager.version_last_restore_source_created_at': 'Save point created: {time}',
    'file_manager.save_point_operation_missing_result_title': 'Save point needs attention',
    'file_manager.save_point_operation_missing_result_summary': 'The save request finished without a saved restore point id. Refresh the list or try again.',
    'file_manager.restore_runtime_open_task': 'Open task',
    'file_manager.restore_runtime_release': 'Release task file usage',
    'file_manager.restore_runtime_release_blocked': 'Task file usage is still blocked by active task activity. Stop the active run or terminal, then try again.',
    'file_manager.restore_runtime_release_failed': 'Task file usage could not be released. Check the task, then try again.',
    'file_manager.restore_runtime_release_failed_title': 'Could not release task file usage',
    'file_manager.restore_runtime_release_pending': 'Task file usage is being released. Restore after it finishes, or retry in a moment.',
    'file_manager.restore_runtime_release_pending_title': 'Release pending',
    'file_manager.restore_status_checking': 'Checking file updates. Saving and publishing are unavailable until this finishes.',
    'file_manager.save_point_action_failed': 'Save point could not be created. Your note is still here; try again after the file library is ready.',
    'file_manager.save_point_action_failed_title': 'Save point needs attention',
    'file_manager.save_point_active_writer_blocked': 'Task files are still in use. Release task file usage, then try again.',
    'file_manager.save_point_create': 'Save restore point',
    'file_manager.save_point_default_name': 'Untitled save point',
    'file_manager.save_point_empty': 'No save points yet',
    'file_manager.save_point_load_error_description': 'Save points could not be loaded. Retry before choosing a restore point.',
    'file_manager.save_point_load_error_title': 'Could not load save points',
    'file_manager.save_point_message': 'Save point note',
    'file_manager.save_point_message_placeholder': 'e.g. Before prompt edits',
    'file_manager.save_point_operation_pending': 'A file update is still running. Wait for it to finish, then try again.',
    'file_manager.save_point_preparing_description': 'Save points are still syncing. Retry in a moment, or use the button to check again now.',
    'file_manager.save_point_preparing_title': 'Save points are syncing',
    'file_manager.save_point_retry': 'Retry',
    'file_manager.save_point_scope_hint': 'Create a recovery point for the whole file library before major file changes.',
    'file_manager.save_point_storage_not_ready': 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
    'file_manager.save_points': 'Save points',
    'file_manager.task_template_action_failed': 'Task file template could not be updated. Your form is still here; try again after the project is ready.',
    'file_manager.task_template_action_failed_title': 'Template action needs attention',
    'file_manager.task_template_active_writer_blocked': 'Task files are still in use. Release task file usage, then try again.',
    'file_manager.task_template_capability_denied': 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
    'file_manager.task_template_description': 'Description',
    'file_manager.task_template_description_placeholder': 'Optional',
    'file_manager.task_template_empty': 'No task file templates yet',
    'file_manager.task_template_failed_next_step': 'Next step: save this template again from the current files, or create a new template.',
    'file_manager.task_template_load_error_description': 'Task file templates could not be loaded. Retry before publishing or reusing a template.',
    'file_manager.task_template_load_error_title': 'Could not load task file templates',
    'file_manager.task_template_name': 'Template name',
    'file_manager.task_template_name_placeholder': 'e.g. Release notes starter',
    'file_manager.task_template_operation_pending': 'A file update is still running. Wait for it to finish, then try again.',
    'file_manager.task_template_publish_draft': 'Save as unpublished template',
    'file_manager.task_template_publish_project': 'Save and publish for this project',
    'file_manager.task_template_publish_current': 'Publish current state',
    'file_manager.task_template_restore_active': 'A restore is still running. Wait for it to finish before publishing task file templates.',
    'file_manager.task_template_restore_pending': 'Wait for this restore to finish before publishing task file templates.',
    'file_manager.task_template_save': 'Save template',
    'file_manager.task_template_section_description': 'Save this library as a task file template. Published templates are available when creating Agent tasks in this project.',
    'file_manager.task_template_section_title': 'Save as task file template',
    'file_manager.task_template_scope_hint': 'Publish a reusable task file template from the whole file library.',
    'file_manager.task_template_source_current': 'From this file library',
    'file_manager.task_template_source_other': 'From another file library',
    'file_manager.task_template_status_failed': 'Failed',
    'file_manager.task_template_status_published': 'Published',
    'file_manager.task_template_status_unpublished': 'Draft',
    'file_manager.task_templates': 'Task file templates',
    'file_manager.template_save_publish_title': 'Save / publish templates',
    'file_manager.template_save_publish_entry': 'Save / publish templates',
    'file_manager.template_save_publish_dialog_description': '{name}. Save and publish task file templates for this project.',
    'file_manager.template_save_publish_dialog_no_library': 'No ready file library is selected.',
    'file_manager.template_save_publish_scope_notice': 'Templates capture the whole file library. Published templates are available when creating Agent tasks in this project.',
    'file_manager.restore_points_section_title': 'Restore points',
    'file_manager.template_publish': 'Publish',
    'file_manager.template_save_again': 'Save again',
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
      data: { operation: null },
      dataUpdatedAt: 1,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    }));
    mockVersionOperationLookupState.mockImplementation(() => ({
      data: null,
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
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
    mockTemplatesQueryState.mockImplementation(() => ({
      data: { items: mockListTemplates() },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchTemplates,
    }));
    mockRefetchTemplates.mockResolvedValue(undefined);
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
        id: 'tmpl_project_shared',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        source_library_id: 'lib_other',
        name: 'Project shared starter',
        status: 'published',
        created_by_user_id: 'user_001',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    ]);
    mockCreateSavePoint.mockResolvedValue({
      id: 'flop_save_point_new',
      kind: 'save_point_create',
      file_library_id: 'lib_1',
      status: 'accepted',
      message: 'Before prompt edits',
      created_at: '2026-05-09T12:04:00.000Z',
      updated_at: '2026-05-09T12:04:00.000Z',
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

  it('renders the version save/restore drawer without template controls', () => {
    renderDialog();

    const dialog = screen.getByTestId('files__dialog__version-save-restore');
    expect(dialog).toHaveTextContent('Save / restore versions');
    expect(dialog).toHaveClass('fixed');
    expect(dialog).toHaveClass('right-0');
    expect(dialog).toHaveClass('sm:w-[640px]');
    expect(dialog).not.toHaveTextContent(['File', 'states'].join(' '));
    expect(screen.getByTestId('files__version-save-restore-scope')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Save points' })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Save as restore point');
    expect(dialog).toHaveTextContent('Restore points');
    expect(screen.getByTestId('files__save-point__message')).toBeVisible();
    expect(screen.getByText('Before edits')).toBeVisible();
    expect(screen.queryByText('Save as task file template')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__template__name')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft starter')).not.toBeInTheDocument();
  });

  it('renders the template save/publish drawer without restore point controls', () => {
    renderDialog({ mode: 'template' });

    const dialog = screen.getByTestId('files__dialog__template-save-publish');
    expect(dialog).toHaveTextContent('Save / publish templates');
    expect(screen.getByTestId('files__template-save-publish-scope')).toBeVisible();
    expect(dialog).toHaveTextContent('Save as task file template');
    expect(screen.getByText('Draft starter')).toBeVisible();
    expect(screen.getByTestId('files__template__name')).toBeVisible();
    expect(screen.queryByText('Save as restore point')).not.toBeInTheDocument();
    expect(screen.queryByText('Restore points')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__save-point__message')).not.toBeInTheDocument();
    expect(screen.queryByText('Before edits')).not.toBeInTheDocument();
  });

  it('shows latest restore only from the file library DTO projection', () => {
    renderDialog({
      library: {
        ...library,
        last_restore: {
          source_save_point_id: 'sp_1',
          source_save_point_label: 'Before deploy',
          source_save_point_created_at: '2026-05-09T12:00:00.000Z',
          restored_at: '2026-05-09T12:15:00.000Z',
          restore_operation_id: 'flro_latest',
        },
      } as never,
    });

    const lastRestore = screen.getByTestId('files__version__last-restore');
    expect(lastRestore).toHaveTextContent('Latest restore: from "Before deploy"');
    expect(lastRestore).toHaveTextContent(`Restore time: ${new Date('2026-05-09T12:15:00.000Z').toLocaleString()}`);
    expect(lastRestore).toHaveTextContent(`Save point created: ${new Date('2026-05-09T12:00:00.000Z').toLocaleString()}`);
    expect(lastRestore).not.toHaveTextContent('flro_latest');
  });

  it('does not guess latest restore from a local restore success operation', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId('files__save-point__restore--sp_1'));
    await user.click(screen.getByTestId('files__restore-confirm-submit'));

    expect(await screen.findByTestId('files__restore-operation')).toHaveTextContent('Files restored.');
    expect(screen.queryByTestId('files__version__last-restore')).not.toBeInTheDocument();
  });

  it('shows template publish mode as a visible segmented control', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'template' });

    const projectButton = screen.getByTestId('files__template__publish-mode-project');
    const draftButton = screen.getByTestId('files__template__publish-mode-draft');
    expect(projectButton).toHaveAttribute('aria-pressed', 'true');
    expect(projectButton).toHaveClass('bg-foreground');
    expect(draftButton).toHaveAttribute('aria-pressed', 'false');
    expect(draftButton).not.toHaveClass('bg-foreground');

    await user.click(draftButton);

    expect(projectButton).toHaveAttribute('aria-pressed', 'false');
    expect(projectButton).not.toHaveClass('bg-foreground');
    expect(draftButton).toHaveAttribute('aria-pressed', 'true');
    expect(draftButton).toHaveClass('bg-foreground');
  });

  it('shows fast save-point admission as an operation instead of waiting for a terminal save point', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    await waitFor(() => {
      expect(mockCreateSavePoint).toHaveBeenCalledWith({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        libraryId: 'lib_1',
        message: 'Before prompt edits',
      });
    });
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Saving restore point...');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Save point creation has been accepted.',
    );
    expect(screen.getByTestId('files__save-point__message')).toBeDisabled();
    expect(screen.queryByText('Restore point saved.')).not.toBeInTheDocument();
  });

  it('uses the POST operation id terminal result and save point id visibility to complete local saving', async () => {
    const user = userEvent.setup();
    let savePoints = [
      {
        id: 'sp_1',
        file_library_id: 'lib_1',
        message: 'Before edits',
        created_at: '2026-05-09T12:00:00.000Z',
      },
    ];
    let savePointsUpdatedAt = 1;
    let activeOperation: unknown = null;
    mockSavePointsQueryState.mockImplementation(() => ({
      data: { items: savePoints },
      dataUpdatedAt: savePointsUpdatedAt,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    }));
    mockActiveRestoreOperationQueryState.mockImplementation(() => ({
      data: { operation: activeOperation },
      dataUpdatedAt: 2,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    }));
    mockVersionOperationLookupState.mockImplementation((_workspaceId, _projectId, _libraryId, operationId) => ({
      data: operationId === 'flop_save_point_new'
        ? {
            id: 'flop_save_point_new',
            kind: 'save_point_create',
            file_library_id: 'lib_1',
            status: 'succeeded',
            result_save_point_id: 'sp_created_from_operation',
            message: 'Before prompt edits',
            created_at: '2026-05-09T12:04:00.000Z',
            updated_at: '2026-05-09T12:04:02.000Z',
          }
        : null,
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    }));

    const view = renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));
    activeOperation = {
      id: 'flop_active_still_running',
      kind: 'save_point_create',
      file_library_id: 'lib_1',
      status: 'running',
      created_at: '2026-05-09T12:04:00.000Z',
      updated_at: '2026-05-09T12:04:01.000Z',
    };
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

    await waitFor(() => {
      expect(mockVersionOperationLookupState).toHaveBeenCalledWith(
        'ws_default',
        'proj_001',
        'lib_1',
        'flop_save_point_new',
        expect.objectContaining({ enabled: true }),
      );
    });
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restore point saved.');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'The restore point is saved. Refreshing the restore point list.',
    );
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('Saving restore point...');
    expect(screen.getByTestId('files__save-point__message')).toBeDisabled();

    savePoints = [
      ...savePoints,
      {
        id: 'sp_created_from_operation',
        file_library_id: 'lib_1',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:04:03.000Z',
      },
    ];
    savePointsUpdatedAt = 3;
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

    await waitFor(() => {
      expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restore point saved.');
      expect(screen.getByText('Before prompt edits')).toBeVisible();
      expect(screen.getByTestId('files__save-point__message')).toBeEnabled();
      expect(screen.getByTestId('files__save-point__message')).toHaveValue('');
    });
  });

  it('keeps a save-point lookup terminal success ahead of same-id stale active running state while the list refreshes', async () => {
    const user = userEvent.setup();
    const terminalOperation = {
      id: 'flop_save_point_new',
      kind: 'save_point_create',
      file_library_id: 'lib_1',
      status: 'succeeded',
      result_save_point_id: 'sp_created_from_operation',
      message: 'Before prompt edits',
      created_at: '2026-05-09T12:04:00.000Z',
      updated_at: '2026-05-09T12:04:02.000Z',
    };
    let activeOperation: unknown = null;
    let activeOperationUpdatedAt = 2;
    mockActiveRestoreOperationQueryState.mockImplementation(() => ({
      data: { operation: activeOperation },
      dataUpdatedAt: activeOperationUpdatedAt,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    }));
    mockVersionOperationLookupState.mockImplementation((_workspaceId, _projectId, _libraryId, operationId) => ({
      data: operationId === 'flop_save_point_new' ? terminalOperation : null,
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    }));

    const view = renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    await waitFor(() => {
      const operationStatus = screen.getByTestId('files__restore-operation');
      expect(operationStatus).toHaveTextContent('Restore point saved.');
      expect(operationStatus).toHaveTextContent('The restore point is saved. Refreshing the restore point list.');
      expect(operationStatus).not.toHaveTextContent('Saving restore point...');
    });

    activeOperation = {
      id: 'flop_save_point_new',
      kind: 'save_point_create',
      file_library_id: 'lib_1',
      status: 'running',
      message: 'Before prompt edits',
      created_at: '2026-05-09T12:04:00.000Z',
      updated_at: '2026-05-09T12:04:01.000Z',
    };
    activeOperationUpdatedAt = 3;
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

    await waitFor(() => {
      const operationStatus = screen.getByTestId('files__restore-operation');
      expect(operationStatus).toHaveTextContent('Restore point saved.');
      expect(operationStatus).toHaveTextContent('The restore point is saved. Refreshing the restore point list.');
      expect(operationStatus).not.toHaveTextContent('Saving restore point...');
      expect(screen.getByTestId('files__save-point__message')).toBeDisabled();
    });
  });

  it('does not complete a save point from message or time matches when terminal result_save_point_id is missing', async () => {
    const user = userEvent.setup();
    let savePoints = [
      {
        id: 'sp_1',
        file_library_id: 'lib_1',
        message: 'Before edits',
        created_at: '2026-05-09T12:00:00.000Z',
      },
    ];
    let savePointsUpdatedAt = 1;
    mockSavePointsQueryState.mockImplementation(() => ({
      data: { items: savePoints },
      dataUpdatedAt: savePointsUpdatedAt,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    }));
    mockVersionOperationLookupState.mockImplementation((_workspaceId, _projectId, _libraryId, operationId) => ({
      data: operationId === 'flop_save_point_new'
        ? {
            id: 'flop_save_point_new',
            kind: 'save_point_create',
            file_library_id: 'lib_1',
            status: 'succeeded',
            message: 'Before prompt edits',
            created_at: '2026-05-09T12:04:00.000Z',
            updated_at: '2026-05-09T12:04:02.000Z',
          }
        : null,
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    }));

    const view = renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    savePoints = [
      ...savePoints,
      {
        id: 'sp_message_match_only',
        file_library_id: 'lib_1',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:04:00.000Z',
      },
    ];
    savePointsUpdatedAt = 3;
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

    await waitFor(() => {
      expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Save point needs attention');
    });
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('Restore point saved.');
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Before prompt edits');
  });

  it('keeps pending save-point copy until the terminal operation result id appears in the list', async () => {
    const user = userEvent.setup();
    let savePoints = [
      {
        id: 'sp_1',
        file_library_id: 'lib_1',
        message: 'Before edits',
        created_at: '2026-05-09T12:00:00.000Z',
      },
    ];
    let savePointsUpdatedAt = 1;
    let activeOperation: unknown = null;
    mockSavePointsQueryState.mockImplementation(() => ({
      data: { items: savePoints },
      dataUpdatedAt: savePointsUpdatedAt,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchSavePoints,
    }));
    mockActiveRestoreOperationQueryState.mockImplementation(() => ({
      data: { operation: activeOperation },
      dataUpdatedAt: 1,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    }));
    mockCreateSavePoint.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_OPERATION_PENDING',
      'file_library_save_point_create_pending',
      'req-save-point-pending',
      409,
    ));

    const view = renderDialog();

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    expect(await screen.findByTestId('files__save-point__pending')).toHaveTextContent('Save points are syncing');

    savePoints = [
      ...savePoints,
      {
        id: 'sp_message_match_only',
        file_library_id: 'lib_1',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:01:00.000Z',
      },
    ];
    savePointsUpdatedAt = 2;
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

    expect(screen.getByTestId('files__save-point__pending')).toHaveTextContent('Save points are syncing');
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Before prompt edits');

    activeOperation = {
      id: 'flop_save_point_succeeded',
      kind: 'save_point_create',
      file_library_id: 'lib_1',
      status: 'succeeded',
      result_save_point_id: 'sp_result_from_terminal',
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    } as never;
    savePoints = [
      ...savePoints,
      {
        id: 'sp_result_from_terminal',
        file_library_id: 'lib_1',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:02:00.000Z',
      },
    ];
    savePointsUpdatedAt = 3;
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

    await waitFor(() => {
      expect(screen.queryByTestId('files__save-point__pending')).not.toBeInTheDocument();
      expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restore point saved.');
      expect(screen.getByTestId('files__save-point__message')).toHaveValue('');
    });
  });

  it('lists project-visible task file templates without filtering to the current source library', () => {
    renderDialog({ mode: 'template' });

    expect(screen.getByText('Draft starter')).toBeVisible();
    expect(screen.getByText('Project shared starter')).toBeVisible();
  });

  it('labels task file template source scope in the project-visible list', () => {
    renderDialog({ mode: 'template' });

    expect(screen.getByTestId('files__template__source--tmpl_draft')).toHaveTextContent('From this file library');
    expect(screen.getByTestId('files__template__source--tmpl_project_shared')).toHaveTextContent('From another file library');
  });

  it('shows task file template loading, error retry, and empty states separately', async () => {
    const user = userEvent.setup();
    mockTemplatesQueryState.mockReturnValueOnce({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
      refetch: mockRefetchTemplates,
    });
    const view = renderDialog({ mode: 'template' });

    expect(screen.getByTestId('files__template__list-loading')).toHaveTextContent('Loading...');
    expect(screen.queryByText('No task file templates yet')).not.toBeInTheDocument();

    mockTemplatesQueryState.mockReturnValueOnce({
      data: undefined,
      error: new Error('template list failed'),
      isError: true,
      isLoading: false,
      refetch: mockRefetchTemplates,
    });
    view.rerender(
      <FileLibraryRecoveryDialog
        open
        mode="template"
        library={library}
        projectId="proj_001"
        t={t}
        workspaceId="ws_default"
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('files__template__list-error')).toHaveTextContent('Could not load task file templates');
    expect(screen.getByTestId('files__template__list-error')).toHaveTextContent(
      'Task file templates could not be loaded.',
    );
    expect(screen.queryByText('No task file templates yet')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('files__template__retry'));
    expect(mockRefetchTemplates).toHaveBeenCalled();

    mockTemplatesQueryState.mockReturnValueOnce({
      data: { items: [] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchTemplates,
    });
    view.rerender(
      <FileLibraryRecoveryDialog
        open
        mode="template"
        library={library}
        projectId="proj_001"
        t={t}
        workspaceId="ws_default"
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('No task file templates yet')).toBeVisible();
  });

  it('shows a next step for failed task file templates', () => {
    mockListTemplates.mockReturnValueOnce([
      {
        id: 'tmpl_failed',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        source_library_id: 'lib_1',
        name: 'Broken starter',
        status: 'failed',
        created_by_user_id: 'user_001',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    ]);

    renderDialog({ mode: 'template' });

    expect(screen.getByText('Broken starter')).toBeVisible();
    expect(screen.getByText('Next step: save this template again from the current files, or create a new template.')).toBeVisible();
    expect(screen.queryByTestId('files__template__publish--tmpl_failed')).not.toBeInTheDocument();
  });

  it('saves and publishes a project-visible task file template by default', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'template' });

    await user.type(screen.getByTestId('files__template__name'), 'Release notes starter');
    await user.click(screen.getByTestId('files__template__save'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        sourceLibraryId: 'lib_1',
        name: 'Release notes starter',
        description: undefined,
        publishOnCreate: true,
        idempotencyKey: expect.stringMatching(/^task_file_template_/),
      });
    });
    expect(mockPublishTemplate).not.toHaveBeenCalled();
  });

  it('can save a task file template as unpublished draft without publishing it', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'template' });

    await user.click(screen.getByTestId('files__template__publish-mode-draft'));
    await user.type(screen.getByTestId('files__template__name'), 'Draft task starter');
    await user.click(screen.getByTestId('files__template__save'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Draft task starter',
        publishOnCreate: false,
      }));
    });
    expect(mockPublishTemplate).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('files__restore-confirm')).toHaveTextContent(
      'cancel and save a restore point first.',
    );
    expect(mockRestoreFileLibrary).not.toHaveBeenCalled();
    expect(mockCreateSavePoint).not.toHaveBeenCalled();
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
      'Task files are still in use. Release task file usage, then try again.',
    );
    expect(screen.getByTestId('files__save-point__error')).not.toHaveTextContent(
      'file_library_active_writer_blocked',
    );
    expect(screen.getByTestId('files__save-point__message')).toHaveValue('Before prompt edits');
  });

  it('shows active direct restore operation when reopened and blocks destructive version-management writes', () => {
    mockActiveRestoreOperationQueryState.mockReturnValue({
      data: {
        operation: {
          id: 'flro_active',
          kind: 'restore',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          status: 'running',
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
    expect(screen.queryByTestId('files__template__name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__restore-template-blocker')).not.toBeInTheDocument();
  });

  it('shows active direct restore operation in the template drawer and blocks template writes', () => {
    mockActiveRestoreOperationQueryState.mockReturnValue({
      data: {
        operation: {
          id: 'flro_active',
          kind: 'restore',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          status: 'running',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:02:00.000Z',
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mockRefetchActiveRestoreOperation,
    });

    renderDialog({ mode: 'template' });

    expect(screen.getByTestId('files__template__operation-status')).toHaveTextContent('Restoring files...');
    expect(screen.getByTestId('files__template__name')).toBeDisabled();
    expect(screen.getByTestId('files__restore-template-blocker')).toBeVisible();
    expect(screen.queryByTestId('files__save-point__message')).not.toBeInTheDocument();
  });

  it('uses file-update checking copy while saving and publishing are blocked', () => {
    mockActiveRestoreOperationQueryState.mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
      error: null,
      isError: false,
      isLoading: true,
      refetch: mockRefetchActiveRestoreOperation,
    });

    renderDialog({ mode: 'template' });

    expect(screen.getByTestId('files__restore-status-checking')).toHaveTextContent(
      'Checking file updates. Saving and publishing are unavailable until this finishes.',
    );
    expect(screen.getByTestId('files__template__name')).toBeDisabled();
  });

  it('uses i18n copy for the sheet close button aria-label', () => {
    renderDialog({
      t: (key, values) => {
        if (key === 'file_manager.close') return 'Localized close';
        return t(key, values);
      },
    });

    expect(screen.getByLabelText('Localized close')).toBeInTheDocument();
  });

  it('shows failed restore terminals with public-safe copy only', () => {
    mockActiveRestoreOperationQueryState.mockReturnValue({
      data: {
        operation: {
          id: 'flro_failed',
          kind: 'restore',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          status: 'failed',
          failure_reason: 'AFSCP_ERR_JVS_REPO at /var/lib/afscp/control-root/repo_flib_123',
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

    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('Restore failed');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Restore failed. No successful restore was applied. Check the file library state, then try again.',
    );
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent(
      'Review the reason and try again.',
    );
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('AFSCP_ERR_JVS_REPO');
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('/var/lib/afscp');
  });

  it('shows recovery-required save-point terminals with system-side copy only', () => {
    mockActiveRestoreOperationQueryState.mockReturnValue({
      data: {
        operation: {
          id: 'flop_save_recovery',
          kind: 'save_point_create',
          file_library_id: 'lib_1',
          status: 'recovery_required',
          failure_reason: 'operation_recovery.manual=1 JVS /control-root/recovery_required',
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

    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Save point needs system attention',
    );
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Save point creation needs system attention before you try again.',
    );
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('operation_recovery.manual');
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('/control-root');
  });

  it('does not treat a null active operation projection as restore success', () => {
    let restoreOperation: unknown = {
      id: 'flro_active',
      kind: 'restore',
      file_library_id: 'lib_1',
      source_save_point_id: 'sp_1',
      status: 'running',
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    };
    mockActiveRestoreOperationQueryState.mockImplementation(() => ({
      data: { operation: restoreOperation },
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

    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent('No file update is running');
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'There is no active save or restore update.',
    );
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('Restore state refreshed');
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('No active restore is running now');
    expect(screen.getByTestId('files__restore-operation')).not.toHaveTextContent('Files restored.');
    expect(screen.getByTestId('files__save-point__restore--sp_1')).toBeEnabled();
    expect(mockRefetchSavePoints).toHaveBeenCalled();
  });

  it('keeps low-mindload file update copy synchronized in real i18n messages', () => {
    const en = enUsMessages.files.file_manager;
    const zh = zhCnMessages.files.file_manager;

    expect(en.version_save_restore_title).toBe('Save / restore versions');
    expect(en.template_save_publish_title).toBe('Save / publish templates');
    expect(en.version_operation_idle_title).toBe('No file update is running');
    expect(en.restore_status_checking).toBe(
      'Checking file updates. Saving and publishing are unavailable until this finishes.',
    );
    expect(en.version_last_restore_title).toBe('Latest restore: from "{label}"');
    expect(en.save_point_operation_missing_result_title).toBe('Save point needs attention');
    expect(en.restore_operation_failed_summary).toBe(
      'Restore failed. No successful restore was applied. Check the file library state, then try again.',
    );
    expect(en.save_point_operation_pending).toBe(
      'A file update is still running. Wait for it to finish, then try again.',
    );
    expect(en.task_template_operation_pending).toBe(
      'A file update is still running. Wait for it to finish, then try again.',
    );

    expect(zh.version_save_restore_title).toBe('版本保存/恢复');
    expect(zh.template_save_publish_title).toBe('模板保存/发布');
    expect(zh.version_operation_idle_title).toBe('当前没有正在运行的文件更新');
    expect(zh.restore_status_checking).toBe('正在检查文件更新，完成前暂不能保存或发布。');
    expect(zh.version_last_restore_title).toBe('最近恢复：来自“{label}”');
    expect(zh.save_point_operation_missing_result_title).toBe('保存点需要处理');
    expect(zh.save_point_operation_pending).toBe('文件仍在更新。请等待当前文件更新完成后再试。');
    expect(zh.task_template_operation_pending).toBe('文件仍在更新。请等待当前文件更新完成后再试。');

    const visibleEnglishCopy = [
      en.version_save_restore_title,
      en.template_save_publish_title,
      en.version_operation_idle_title,
      en.version_operation_idle_summary,
      en.restore_status_checking,
      en.version_last_restore_title,
      en.save_point_operation_missing_result_title,
      en.save_point_operation_pending,
      en.task_template_operation_pending,
      en.restore_operation_failed_summary,
    ].join('\n');
    const visibleChineseCopy = [
      zh.version_save_restore_title,
      zh.template_save_publish_title,
      zh.version_operation_idle_title,
      zh.version_operation_idle_summary,
      zh.restore_status_checking,
      zh.version_last_restore_title,
      zh.save_point_operation_missing_result_title,
      zh.save_point_operation_pending,
      zh.task_template_operation_pending,
      zh.restore_operation_failed_summary,
    ].join('\n');

    expect(visibleEnglishCopy).not.toMatch(/version operation|version operations|Review the reason/i);
    expect(visibleChineseCopy).not.toContain('文件库版本操作');
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
      'Before restoring files, release task file usage.',
    );
    expect(screen.getByTestId('files__restore-operation')).toHaveTextContent(
      'Task using these files: Visible Task',
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
