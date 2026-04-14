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
    };
    return translations[key] ?? key;
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
        libraryDeleteOpen={false}
        libraryDeleteTarget={null}
        libraryDescription=""
        libraryName="Shared Docs"
        libraryRenameDescription=""
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
        libraryDeleteOpen={false}
        libraryDeleteTarget={null}
        libraryDescription=""
        libraryName="Shared Docs"
        libraryRenameDescription=""
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
});
