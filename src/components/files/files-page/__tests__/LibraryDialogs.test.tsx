import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LibraryDialogs } from '../LibraryDialogs';

describe('LibraryDialogs', () => {
  const t = (key: string) => {
    const translations: Record<string, string> = {
      'file_manager.library_create': 'Create library',
      'file_manager.library_name': 'Library name',
      'file_manager.library_name_placeholder': 'e.g. Shared Docs',
      'file_manager.library_description': 'Description',
      'file_manager.library_description_placeholder': 'Optional',
      'file_manager.cancel': 'Cancel',
      'file_manager.create': 'Create',
      'file_manager.library_create_pending': 'Creating library. Keep this dialog open until the new library appears in the list.',
      'file_manager.library_rename': 'Rename library',
      'file_manager.library_delete': 'Delete library',
      'file_manager.library_delete_confirm': 'Delete {name}',
      'file_manager.library_delete_warning': 'This removes files.',
      'file_manager.library_delete_confirm_empty': 'Select a library to delete.',
      'file_manager.library_delete_confirm_placeholder': 'Type the library name',
      'file_manager.delete': 'Delete',
    };
    const template = translations[key] ?? key;
    return template.replace(/\{name\}/g, 'Shared Docs');
  };

  it('shows a pending state and keeps the dialog open while the request is in flight', async () => {
    const user = userEvent.setup();
    const onSetLibraryCreateOpen = vi.fn();

    render(
      <LibraryDialogs
        createLibraryPending
        deleteLibraryPending={false}
        libraryCreateError={null}
        libraryCreateOpen
        libraryDeleteConfirm=""
        libraryDeleteError={null}
        libraryDeleteOpen={false}
        libraryDeleteTarget={null}
        libraryDescription=""
        libraryName="Shared Docs"
        libraryRenameDescription=""
        libraryRenameError={null}
        libraryRenameName=""
        libraryRenameOpen={false}
        libraryRenameTarget={null}
        t={t}
        updateLibraryPending={false}
        onCloseDeleteLibraryDialog={vi.fn()}
        onCloseRenameLibraryDialog={vi.fn()}
        onCreateLibrary={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSetLibraryCreateOpen={onSetLibraryCreateOpen}
        onSetLibraryDeleteConfirm={vi.fn()}
        onSetLibraryDeleteOpen={vi.fn()}
        onSetLibraryDescription={vi.fn()}
        onSetLibraryName={vi.fn()}
        onSetLibraryRenameDescription={vi.fn()}
        onSetLibraryRenameName={vi.fn()}
        onSetLibraryRenameOpen={vi.fn()}
      />,
    );

    expect(screen.getByTestId('files__library-create__pending')).toBeInTheDocument();
    expect(screen.getByTestId('files__library-create__submit')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await user.click(screen.getByTestId('files__library-create__submit'));
    expect(onSetLibraryCreateOpen).not.toHaveBeenCalledWith(false);
  });

  it('renders a create error inline without requiring the dialog to close', () => {
    render(
      <LibraryDialogs
        createLibraryPending={false}
        deleteLibraryPending={false}
        libraryCreateError="Permission denied"
        libraryCreateOpen
        libraryDeleteConfirm=""
        libraryDeleteError={null}
        libraryDeleteOpen={false}
        libraryDeleteTarget={null}
        libraryDescription=""
        libraryName="Shared Docs"
        libraryRenameDescription=""
        libraryRenameError={null}
        libraryRenameName=""
        libraryRenameOpen={false}
        libraryRenameTarget={null}
        t={t}
        updateLibraryPending={false}
        onCloseDeleteLibraryDialog={vi.fn()}
        onCloseRenameLibraryDialog={vi.fn()}
        onCreateLibrary={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSetLibraryCreateOpen={vi.fn()}
        onSetLibraryDeleteConfirm={vi.fn()}
        onSetLibraryDeleteOpen={vi.fn()}
        onSetLibraryDescription={vi.fn()}
        onSetLibraryName={vi.fn()}
        onSetLibraryRenameDescription={vi.fn()}
        onSetLibraryRenameName={vi.fn()}
        onSetLibraryRenameOpen={vi.fn()}
      />,
    );

    expect(screen.getByTestId('files__library-create__error')).toHaveTextContent('Permission denied');
    expect(screen.getByTestId('files__library-create__submit')).toBeEnabled();
  });

  it('renders a delete race conflict inline and keeps the destructive action available for retry', () => {
    render(
      <LibraryDialogs
        createLibraryPending={false}
        deleteLibraryPending={false}
        libraryCreateError={null}
        libraryCreateOpen={false}
        libraryDeleteConfirm="Shared Docs"
        libraryDeleteError="Delete the bound task before deleting this library."
        libraryDeleteOpen
        libraryDeleteTarget={{
          name: 'Shared Docs',
          status: 'ready',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
        }}
        libraryDescription=""
        libraryName=""
        libraryRenameDescription=""
        libraryRenameError={null}
        libraryRenameName=""
        libraryRenameOpen={false}
        libraryRenameTarget={null}
        t={t}
        updateLibraryPending={false}
        onCloseDeleteLibraryDialog={vi.fn()}
        onCloseRenameLibraryDialog={vi.fn()}
        onCreateLibrary={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSetLibraryCreateOpen={vi.fn()}
        onSetLibraryDeleteConfirm={vi.fn()}
        onSetLibraryDeleteOpen={vi.fn()}
        onSetLibraryDescription={vi.fn()}
        onSetLibraryName={vi.fn()}
        onSetLibraryRenameDescription={vi.fn()}
        onSetLibraryRenameName={vi.fn()}
        onSetLibraryRenameOpen={vi.fn()}
      />,
    );

    expect(screen.getByTestId('files__library-delete__error')).toHaveTextContent(
      'Delete the bound task before deleting this library.',
    );
    expect(screen.getByTestId('files__library-delete__submit')).toBeEnabled();
  });

  it('renders a rename typed conflict inline without closing the dialog context', () => {
    render(
      <LibraryDialogs
        createLibraryPending={false}
        deleteLibraryPending={false}
        libraryCreateError={null}
        libraryCreateOpen={false}
        libraryDeleteConfirm=""
        libraryDeleteError={null}
        libraryDeleteOpen={false}
        libraryDeleteTarget={null}
        libraryDescription=""
        libraryName=""
        libraryRenameDescription="Current description"
        libraryRenameError="This library is not ready yet. Refresh the library status before trying again."
        libraryRenameName="Shared Docs"
        libraryRenameOpen
        libraryRenameTarget={{ id: 'lib_a' }}
        t={t}
        updateLibraryPending={false}
        onCloseDeleteLibraryDialog={vi.fn()}
        onCloseRenameLibraryDialog={vi.fn()}
        onCreateLibrary={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSetLibraryCreateOpen={vi.fn()}
        onSetLibraryDeleteConfirm={vi.fn()}
        onSetLibraryDeleteOpen={vi.fn()}
        onSetLibraryDescription={vi.fn()}
        onSetLibraryName={vi.fn()}
        onSetLibraryRenameDescription={vi.fn()}
        onSetLibraryRenameName={vi.fn()}
        onSetLibraryRenameOpen={vi.fn()}
      />,
    );

    expect(screen.getByTestId('files__library-rename__error')).toHaveTextContent(
      'This library is not ready yet. Refresh the library status before trying again.',
    );
    expect(screen.getByTestId('files__library-rename__name')).toHaveValue('Shared Docs');
    expect(screen.getByTestId('files__library-rename__submit')).toBeEnabled();
  });
});
