import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/files/FileObjectDetailsPanel', () => ({
  FileObjectDetailsPanel: () => (
    <div data-testid="files__details-panel">
      <div data-testid="files__details-inspector" />
      <div data-testid="files__details-preview" className="h-40 rounded-md bg-surface-high/28" />
    </div>
  ),
}));

import { FilesPageContent } from '@/components/files/files-page/FilesPageContent';

describe('FilesPageContent', () => {
  it('keeps the files work surface as one quiet shell with rail wrappers', () => {
    render(
      <FilesPageContent
        allSelected={false}
        canManage
        canExchangeCredentials={false}
        crumbs={[]}
        fileInputRef={{ current: null }}
        filteredItems={[]}
        handleCancelUpload={vi.fn()}
        handleDelete={vi.fn()}
        handleDownload={vi.fn()}
        handleDrop={vi.fn()}
        handleDropEnter={vi.fn()}
        handleDropLeave={vi.fn()}
        handleDropOver={vi.fn()}
        handleLoadNextPage={vi.fn()}
        handleRefresh={vi.fn()}
        handleRename={vi.fn()}
        handleRowActivate={vi.fn()}
        handleRowOpen={vi.fn()}
        handleSortHeaderClick={vi.fn()}
        handleToggleRowCheckbox={vi.fn()}
        handleUploadClick={vi.fn()}
        hasSelection={false}
        isDropActive={false}
        layoutMode="standard"
        libraries={[]}
        libsLoading={false}
        moveNamePlaceholder=""
        objectsQuery={{ hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() } as never}
        onClearSelection={vi.fn()}
        onCreateFolder={vi.fn()}
        onCreateLibrary={vi.fn()}
        onOpenDesktopAccess={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onGoUp={vi.fn()}
        onNavigateToPrefix={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSelectLibrary={vi.fn()}
        onToggleAll={vi.fn()}
        prefix=""
        projectId="proj_001"
        searchInput=""
        selected={[]}
        selectedCount={0}
        selectedForMove={null}
        selectedIds={[]}
        selectedLibraryId={null}
        selectedLibraryStatus="ready"
        selectedObjectsCount={0}
        selectionMode="multi"
        setSearchInput={vi.fn()}
        sortBy="name"
        sortOrder="asc"
        t={(key: string) => key}
        uploadCurrentFileName=""
        uploadCurrentProgress={0}
        uploadInProgress={false}
        uploadQueueCompleted={0}
        uploadQueueTotal={0}
        workspaceId="ws_default"
      />
    );

    expect(screen.getByTestId('files__workspace-surface')).toBeInTheDocument();
    expect(screen.getByTestId('files__libraries-shell')).toBeInTheDocument();
    expect(screen.getByTestId('files__browser-shell')).toBeInTheDocument();
    expect(screen.getByTestId('files__libraries-shell').className).toContain('[&>div]:!border-0');
    expect(screen.getByTestId('files__libraries-shell').className).toContain('[&>div]:!bg-transparent');
    expect(screen.getByTestId('files__libraries-shell').className).toContain("[&_[data-testid='files__library-list']>div]:!rounded-none");
    expect(screen.getByTestId('files__libraries-shell').className).toContain("[&_[data-testid='files__library-list']>div]:!bg-transparent");
    expect(screen.getByTestId('files__browser-shell').className).toContain('[&>div]:!border-0');
    expect(screen.getByTestId('files__browser-shell').className).toContain('[&>div]:!bg-transparent');
    expect(screen.getByTestId('files__browser-shell').className).toContain("[&_[data-testid='files__objects-table']_.sticky]:!bg-transparent");
    expect(screen.getByTestId('files__workspace-surface').className).not.toContain('shadow-card');
    expect(screen.getByTestId('files__dropzone')).toBeInTheDocument();
  });

  it('flattens the details shell into the main files surface', () => {
    render(
      <FilesPageContent
        allSelected={false}
        canManage
        canExchangeCredentials={false}
        crumbs={[]}
        fileInputRef={{ current: null }}
        filteredItems={[]}
        handleCancelUpload={vi.fn()}
        handleDelete={vi.fn()}
        handleDownload={vi.fn()}
        handleDrop={vi.fn()}
        handleDropEnter={vi.fn()}
        handleDropLeave={vi.fn()}
        handleDropOver={vi.fn()}
        handleLoadNextPage={vi.fn()}
        handleRefresh={vi.fn()}
        handleRename={vi.fn()}
        handleRowActivate={vi.fn()}
        handleRowOpen={vi.fn()}
        handleSortHeaderClick={vi.fn()}
        handleToggleRowCheckbox={vi.fn()}
        handleUploadClick={vi.fn()}
        hasSelection
        isDropActive={false}
        layoutMode="standard"
        libraries={[]}
        libsLoading={false}
        moveNamePlaceholder=""
        objectsQuery={{ hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() } as never}
        onClearSelection={vi.fn()}
        onCreateFolder={vi.fn()}
        onCreateLibrary={vi.fn()}
        onOpenDesktopAccess={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onGoUp={vi.fn()}
        onNavigateToPrefix={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSelectLibrary={vi.fn()}
        onToggleAll={vi.fn()}
        prefix=""
        projectId="proj_001"
        searchInput=""
        selected={[{ kind: 'object', key: 'lib_shared_default/README.txt' } as never]}
        selectedCount={1}
        selectedForMove={null}
        selectedIds={['lib_shared_default/README.txt'] as never}
        selectedLibraryId="lib_shared_default"
        selectedLibraryStatus="ready"
        selectedObjectsCount={1}
        selectionMode="multi"
        setSearchInput={vi.fn()}
        sortBy="name"
        sortOrder="asc"
        t={(key: string) => key}
        uploadCurrentFileName=""
        uploadCurrentProgress={0}
        uploadInProgress={false}
        uploadQueueCompleted={0}
        uploadQueueTotal={0}
        workspaceId="ws_default"
      />
    );

    const detailsShell = screen.getByTestId('files__details-shell');
    expect(detailsShell).toBeInTheDocument();
    expect(detailsShell.className).toContain("[&_[data-testid='files__details-panel']]:!bg-transparent");
    expect(detailsShell.className).not.toContain("[&_[data-testid='files__details-hero']]:!bg-transparent");
    expect(detailsShell.className).toContain("[&_[data-testid='files__details-preview']]:!p-0");
    expect(screen.getByTestId('files__details-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('files__details-panel')).toBeInTheDocument();
  });

  it('keeps the workspace surface quiet and divider-led when details are visible', () => {
    render(
      <FilesPageContent
        allSelected={false}
        canManage
        canExchangeCredentials={false}
        crumbs={[]}
        fileInputRef={{ current: null }}
        filteredItems={[]}
        handleCancelUpload={vi.fn()}
        handleDelete={vi.fn()}
        handleDownload={vi.fn()}
        handleDrop={vi.fn()}
        handleDropEnter={vi.fn()}
        handleDropLeave={vi.fn()}
        handleDropOver={vi.fn()}
        handleLoadNextPage={vi.fn()}
        handleRefresh={vi.fn()}
        handleRename={vi.fn()}
        handleRowActivate={vi.fn()}
        handleRowOpen={vi.fn()}
        handleSortHeaderClick={vi.fn()}
        handleToggleRowCheckbox={vi.fn()}
        handleUploadClick={vi.fn()}
        hasSelection
        isDropActive={false}
        layoutMode="standard"
        libraries={[]}
        libsLoading={false}
        moveNamePlaceholder=""
        objectsQuery={{ hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() } as never}
        onClearSelection={vi.fn()}
        onCreateFolder={vi.fn()}
        onCreateLibrary={vi.fn()}
        onOpenDesktopAccess={vi.fn()}
        onDeleteLibrary={vi.fn()}
        onGoUp={vi.fn()}
        onNavigateToPrefix={vi.fn()}
        onRenameLibrary={vi.fn()}
        onSelectLibrary={vi.fn()}
        onToggleAll={vi.fn()}
        prefix=""
        projectId="proj_001"
        searchInput=""
        selected={[{ kind: 'object', key: 'lib_shared_default/README.txt' } as never]}
        selectedCount={1}
        selectedForMove={null}
        selectedIds={['lib_shared_default/README.txt'] as never}
        selectedLibraryId="lib_shared_default"
        selectedLibraryStatus="ready"
        selectedObjectsCount={1}
        selectionMode="multi"
        setSearchInput={vi.fn()}
        sortBy="name"
        sortOrder="asc"
        t={(key: string) => key}
        uploadCurrentFileName=""
        uploadCurrentProgress={0}
        uploadInProgress={false}
        uploadQueueCompleted={0}
        uploadQueueTotal={0}
        workspaceId="ws_default"
      />
    );

    expect(screen.getByTestId('files__workspace-grid').className).toContain('grid-cols-[220px_minmax(0,1fr)_280px]');
    expect(screen.getByTestId('files__workspace-surface')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('files__details-shell').className).toContain('min-h-0');
  });
});
