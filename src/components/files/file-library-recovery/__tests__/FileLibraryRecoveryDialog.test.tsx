import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLibraryRecoveryDialog } from '../FileLibraryRecoveryDialog';

const {
  mockCancelRestore,
  mockCreateSavePoint,
  mockCreateTemplate,
  mockDeleteTemplate,
  mockListSavePoints,
  mockListTemplates,
  mockPublishTemplate,
  mockRunRestore,
  mockUnpublishTemplate,
  mockCreateRestorePreview,
} = vi.hoisted(() => ({
  mockCancelRestore: vi.fn(),
  mockCreateSavePoint: vi.fn(),
  mockCreateTemplate: vi.fn(),
  mockDeleteTemplate: vi.fn(),
  mockListSavePoints: vi.fn(),
  mockListTemplates: vi.fn(),
  mockPublishTemplate: vi.fn(),
  mockRunRestore: vi.fn(),
  mockUnpublishTemplate: vi.fn(),
  mockCreateRestorePreview: vi.fn(),
}));

vi.mock('@/lib/hooks/use-file-library-recovery', () => ({
  useCancelFileLibraryRestore: () => ({ mutateAsync: mockCancelRestore, isPending: false }),
  useCreateFileLibraryRestorePreview: () => ({ mutateAsync: mockCreateRestorePreview, isPending: false }),
  useCreateFileLibrarySavePoint: () => ({ mutateAsync: mockCreateSavePoint, isPending: false }),
  useFileLibrarySavePoints: () => ({ data: { items: mockListSavePoints() }, isLoading: false }),
  useRunFileLibraryRestore: () => ({ mutateAsync: mockRunRestore, isPending: false }),
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
    'file_manager.file_state_dialog_description': '{name}. Save points, restore, and task file templates apply to all task files.',
    'file_manager.file_state_dialog_no_library': 'No ready file library is selected.',
    'file_manager.file_state_scope_notice': 'This includes system folders. Restore changes files only; the task conversation and trace stay unchanged.',
    'file_manager.file_states': 'File states',
    'file_manager.save_point_create': 'Save current state',
    'file_manager.save_point_empty': 'No save points yet',
    'file_manager.save_point_message': 'Save point note',
    'file_manager.save_point_message_placeholder': 'e.g. Before prompt edits',
    'file_manager.save_point_scope_hint': 'Save a snapshot of all task files before major file changes.',
    'file_manager.save_points': 'Save points',
    'file_manager.restore': 'Restore',
    'file_manager.restore_cancel': 'Cancel restore',
    'file_manager.restore_confirm': 'Restore files',
    'file_manager.restore_preview_blocked_default': 'Restore is blocked until the file library is ready for a new preview.',
    'file_manager.restore_preview_blockers_title': 'Needs attention',
    'file_manager.restore_preview_failed_default': 'The preview failed. Create a new preview before restoring.',
    'file_manager.restore_preview_not_ready_default': 'The preview is not ready yet. Wait or create a new preview.',
    'file_manager.restore_preview_ready': 'Ready to restore {name}',
    'file_manager.restore_preview_stale_default': 'The preview is out of date. Create a new preview before restoring.',
    'file_manager.restore_preview_summary_counts': 'Added {added}, changed {changed}, removed {removed}.',
    'file_manager.restore_preview_summary_default': 'Restore will replace all task files with this save point. The task conversation and trace stay unchanged.',
    'file_manager.restore_preview_target_default': 'selected save point',
    'file_manager.task_template_description': 'Description',
    'file_manager.task_template_description_placeholder': 'Optional',
    'file_manager.task_template_empty': 'No task file templates yet',
    'file_manager.task_template_name': 'Template name',
    'file_manager.task_template_name_placeholder': 'e.g. Release notes starter',
    'file_manager.task_template_publish_current': 'Publish current state',
    'file_manager.task_template_scope_hint': 'Publish a reusable task file template from all task files.',
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
    mockUnpublishTemplate.mockResolvedValue(undefined);
    mockDeleteTemplate.mockResolvedValue(undefined);
  });

  it('creates save points and confirms restore through preview/run', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByTestId('files__file-states-scope')).toHaveTextContent(
      'This includes system folders. Restore changes files only; the task conversation and trace stay unchanged.',
    );

    await user.type(screen.getByTestId('files__save-point__message'), 'Before prompt edits');
    await user.click(screen.getByTestId('files__save-point__create'));

    expect(mockCreateSavePoint).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_1',
      message: 'Before prompt edits',
    });

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
      'Create a new preview after refreshing file states.',
    );
    expect(screen.getByTestId('files__restore-confirm')).toBeDisabled();

    await user.click(screen.getByTestId('files__restore-confirm'));

    expect(mockRunRestore).not.toHaveBeenCalled();
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

  it('does not expose raw storage implementation wording', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('tab', { name: 'Task file templates' }));

    const text = document.body.textContent ?? '';
    for (const forbidden of ['AFSCP', 'JuiceFS', 'HOME', 'hidden runtime', 'repo', 'namespace', 'volume', 'raw mount', 'credential']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
