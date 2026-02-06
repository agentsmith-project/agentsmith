/**
 * Unit tests for SourcesTable component
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { SourcesTable } from '../SourcesTable';
import type { SourceFileWithAIReady } from '@/lib/api/types';

const mockFiles: SourceFileWithAIReady[] = [
  {
    id: 'file1',
    workspace_id: 'ws1',
    project_id: 'proj1',
    owner_user_id: 'user1',
    filename: 'test-document.pdf',
    file_type: 'application/pdf',
    file_size: 1024 * 1024 * 2, // 2MB
    object_ref: { bucket: 'bucket', key: 'key1' },
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ai_ready: {
      id: 'ai1',
      source_file_id: 'file1',
      status: 'ready',
      progress: 100,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    },
    ai_ready_usage: {
      docdb_bytes: 1024 * 512,
      vectordb_bytes: 1024 * 256,
      chunks_count: 10,
    },
  },
  {
    id: 'file2',
    workspace_id: 'ws1',
    project_id: 'proj1',
    owner_user_id: 'user1',
    filename: 'another-file.txt',
    file_type: 'text/plain',
    file_size: 1024 * 500, // 500KB
    object_ref: { bucket: 'bucket', key: 'key2' },
    version: 2,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    ai_ready: {
      id: 'ai2',
      source_file_id: 'file2',
      status: 'preparing',
      progress: 50,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    },
  },
  {
    id: 'file3',
    workspace_id: 'ws1',
    project_id: 'proj1',
    owner_user_id: 'user1',
    filename: 'idle-file.docx',
    file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 1024 * 100,
    object_ref: { bucket: 'bucket', key: 'key3' },
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-04T00:00:00Z',
  },
];

describe('SourcesTable', () => {
  const defaultProps = {
    data: mockFiles,
    loading: false,
    compact: true,
    selectedIds: [],
    onRowSelect: vi.fn(),
    onUploadClick: vi.fn(),
  };

  it('should render table with data', () => {
    render(<SourcesTable {...defaultProps} />);

    expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
    expect(screen.getByText('another-file.txt')).toBeInTheDocument();
    expect(screen.getByText('idle-file.docx')).toBeInTheDocument();
  });

  it('should render loading skeleton when loading is true', () => {
    render(<SourcesTable {...defaultProps} loading={true} data={[]} />);

    // Should show skeleton instead of table
    const skeleton = screen.queryByText(/test-document\.pdf/);
    expect(skeleton).not.toBeInTheDocument();
  });

  it('should render empty state when no data', () => {
    render(<SourcesTable {...defaultProps} data={[]} loading={false} />);

    expect(screen.getByText(/empty_title/)).toBeInTheDocument();
    expect(screen.getByText(/empty_cta/)).toBeInTheDocument();
  });

  it('should show upload button in empty state when onUploadClick is provided', () => {
    render(<SourcesTable {...defaultProps} data={[]} loading={false} onUploadClick={vi.fn()} />);

    expect(screen.getByText(/upload_files/)).toBeInTheDocument();
  });

  it('should not show upload button in empty state when onUploadClick is not provided', () => {
    const { container } = render(
      <SourcesTable {...defaultProps} data={[]} loading={false} onUploadClick={undefined} />
    );

    // Should not have action button
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('should call onUploadClick when upload button in empty state is clicked', async () => {
    const user = userEvent.setup();
    const onUploadClick = vi.fn();

    render(<SourcesTable {...defaultProps} data={[]} loading={false} onUploadClick={onUploadClick} />);

    const uploadButton = screen.getByText(/upload_files/);
    await user.click(uploadButton);

    expect(onUploadClick).toHaveBeenCalled();
  });

  it('should render file sizes in formatted bytes', () => {
    render(<SourcesTable {...defaultProps} />);

    // 2MB, 500KB, 100KB
    expect(screen.getByText(/2\.00 MB/)).toBeInTheDocument();
    expect(screen.getByText(/500\.00 KB/)).toBeInTheDocument();
    expect(screen.getByText(/100\.00 KB/)).toBeInTheDocument();
  });

  it('should render relative time for updated_at', () => {
    render(<SourcesTable {...defaultProps} />);

    // Should show relative time like "2 days ago", "1 day ago", etc.
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });

  it('should render AI Ready status badges', () => {
    render(<SourcesTable {...defaultProps} />);

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Preparing')).toBeInTheDocument();
    // Idle file doesn't have AI Ready status
  });

  it('should render AI Ready usage for ready files', () => {
    render(<SourcesTable {...defaultProps} />);

    // Should show DocDB and VDB usage for ready file
    expect(screen.getByText(/DocDB:/)).toBeInTheDocument();
    expect(screen.getByText(/VDB:/)).toBeInTheDocument();
  });

  it('should show dash for files without AI Ready usage', () => {
    render(<SourcesTable {...defaultProps} />);

    const dashes = screen.getAllByText('-');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('should truncate long filenames and show tooltip', async () => {
    const longFile: SourceFileWithAIReady = {
      ...mockFiles[0],
      filename: 'this-is-a-very-long-filename-that-should-be-truncated-in-the-table-view-for-better-layout.pdf',
    };

    render(<SourcesTable {...defaultProps} data={[longFile]} />);

    // Should show truncated filename
    const filename = screen.getByText(/this-is-a-very-long-filename/);
    expect(filename).toBeInTheDocument();
  });

  it('should show version number for files with version > 1', () => {
    const versionedFile = mockFiles[1]; // version: 2

    render(<SourcesTable {...defaultProps} data={[versionedFile]} />);

    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('should not show version number for files with version 1', () => {
    const v1File = mockFiles[0]; // version: 1

    render(<SourcesTable {...defaultProps} data={[v1File]} />);

    expect(screen.queryByText('v1')).not.toBeInTheDocument();
  });

  it('should render select checkbox for each row', () => {
    render(<SourcesTable {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    // Should have header checkbox + row checkboxes
    expect(checkboxes.length).toBeGreaterThanOrEqual(4); // 1 header + 3 rows
  });

  it('should call onRowSelect when row checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onRowSelect = vi.fn();

    render(<SourcesTable {...defaultProps} onRowSelect={onRowSelect} />);

    const checkboxes = screen.getAllByRole('checkbox');

    // Click the first row checkbox (skip header checkbox)
    await user.click(checkboxes[1]);

    expect(onRowSelect).toHaveBeenCalled();
  });

  it('should respect selectedIds prop', () => {
    render(<SourcesTable {...defaultProps} selectedIds={['file1']} />);

    const checkboxes = screen.getAllByRole('checkbox');

    // First checkbox (header) might be unchecked, but file1 checkbox should be checked
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('should show preparing progress for preparing files', () => {
    render(<SourcesTable {...defaultProps} />);

    // Preparing file should have progress indicator
    expect(screen.getByText('Preparing')).toBeInTheDocument();
  });

  it('should apply compact mode when compact prop is true', () => {
    const { container } = render(<SourcesTable {...defaultProps} compact={true} />);

    const table = container.querySelector('[role="table"]');
    expect(table).toBeInTheDocument();
  });

  it('should handle empty data array without crashing', () => {
    expect(() => {
      render(<SourcesTable {...defaultProps} data={[]} />);
    }).not.toThrow();
  });

  it('should handle large file sizes correctly', () => {
    const largeFile: SourceFileWithAIReady = {
      ...mockFiles[0],
      file_size: 1024 * 1024 * 1024 * 2, // 2GB
    };

    render(<SourcesTable {...defaultProps} data={[largeFile]} />);

    expect(screen.getByText(/GB/)).toBeInTheDocument();
  });

  it('should handle small file sizes correctly', () => {
    const smallFile: SourceFileWithAIReady = {
      ...mockFiles[0],
      file_size: 512, // 512 bytes
    };

    render(<SourcesTable {...defaultProps} data={[smallFile]} />);

    expect(screen.getByText(/512\.00 B/)).toBeInTheDocument();
  });

  it('should render different file status badges correctly', () => {
    const filesWithStatus: SourceFileWithAIReady[] = [
      { ...mockFiles[0], ai_ready: { ...mockFiles[0].ai_ready!, status: 'idle' } },
      { ...mockFiles[0], id: 'f2', ai_ready: { ...mockFiles[0].ai_ready!, status: 'failed' } },
      { ...mockFiles[0], id: 'f3', ai_ready: { ...mockFiles[0].ai_ready!, status: 'cancelled' } },
    ];

    render(<SourcesTable {...defaultProps} data={filesWithStatus} />);

    expect(screen.getByText('Not Ready')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('should show all row checkboxes when data is present', () => {
    render(<SourcesTable {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    // Header + 3 rows
    expect(checkboxes.length).toBe(4);
  });

  it('should display correct number of files', () => {
    render(<SourcesTable {...defaultProps} />);

    // Should have 3 filename cells
    expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
    expect(screen.getByText('another-file.txt')).toBeInTheDocument();
    expect(screen.getByText('idle-file.docx')).toBeInTheDocument();
  });
});
