/**
 * Tests for ArtifactCard component
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactCard } from '../ArtifactCard';
import type { Artifact } from '@/lib/types/task';

// Mock toast
vi.mock('@/components/ui/toast', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'copied': 'Copied!',
      'copy_failed': 'Failed to copy',
      'artifact.text_default': 'Text',
      'artifact.image_default': 'Image',
      'artifact.file_default': 'File',
    };
    return translations[key] || key;
  },
}));

describe('ArtifactCard', () => {
  const mockTextArtifact: Artifact = {
    id: 'artifact-1',
    task_id: 'task-1',
    type: 'text',
    title: 'Text Artifact',
    content: 'This is a text artifact with some content',
    created_at: '2024-01-01T00:00:00Z',
  };

  const mockImageArtifact: Artifact = {
    id: 'artifact-2',
    task_id: 'task-1',
    type: 'image',
    title: 'Image Artifact',
    thumbnail_url: 'https://example.com/thumb.jpg',
    content: 'https://example.com/image.jpg',
    created_at: '2024-01-01T01:00:00Z',
  };

  const mockFileArtifact: Artifact = {
    id: 'artifact-3',
    task_id: 'task-1',
    type: 'file',
    title: 'Document.pdf',
    file_size: 1048576,
    created_at: '2024-01-01T02:00:00Z',
  };

  const mockOnView = vi.fn();
  const mockOnSave = vi.fn();
  const mockOnDownload = vi.fn();
  const mockOnAttachAsInput = vi.fn();

  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  beforeAll(() => {
    // Mock clipboard API once (navigator.clipboard is read-only, use defineProperty)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock, readText: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock.mockResolvedValue(undefined);
  });

  const renderComponent = (artifact: Artifact, props = {}) => {
    return render(
      <ArtifactCard
        artifact={artifact}
        onView={mockOnView}
        onSave={mockOnSave}
        onDownload={mockOnDownload}
        onAttachAsInput={mockOnAttachAsInput}
        {...props}
      />
    );
  };

  describe('Text Artifact Rendering', () => {
    it('renders text artifact title', () => {
      renderComponent(mockTextArtifact);

      expect(screen.getByText('Text Artifact')).toBeInTheDocument();
    });

    it('renders text artifact content preview', () => {
      renderComponent(mockTextArtifact);

      expect(screen.getByText(/This is a text artifact/)).toBeInTheDocument();
    });

    it('shows default title when title is missing', () => {
      const artifactWithoutTitle: Artifact = {
        ...mockTextArtifact,
        title: undefined,
      };

      renderComponent(artifactWithoutTitle);

      expect(screen.getByText('Text')).toBeInTheDocument();
    });

    it('shows copy button for text artifacts', () => {
      renderComponent(mockTextArtifact);

      expect(screen.getByRole('button', { name: /artifact actions/i })).toBeInTheDocument();
    });

    it('copies text content to clipboard', async () => {
      const { toast } = await import('@/components/ui/toast');
      const user = userEvent.setup();

      renderComponent(mockTextArtifact);

      await user.click(screen.getByRole('button', { name: /artifact actions/i }));

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /copy/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('menuitem', { name: /copy/i }));
      expect(toast.info).toHaveBeenCalledWith('Copied!');
    });
  });

  describe('Image Artifact Rendering', () => {
    it('renders image artifact with thumbnail', () => {
      renderComponent(mockImageArtifact);

      const image = screen.getByAltText('Image Artifact');
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute('src', 'https://example.com/thumb.jpg');
    });

    it('falls back to content URL when no thumbnail', () => {
      const imageWithoutThumb: Artifact = {
        ...mockImageArtifact,
        thumbnail_url: undefined,
      };

      renderComponent(imageWithoutThumb);

      const image = screen.getByAltText('Image Artifact');
      expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
    });

    it('shows placeholder when no image URL', () => {
      const imageWithoutUrls: Artifact = {
        id: 'artifact-no-img',
        task_id: 'task-1',
        type: 'image',
        title: 'No Image',
        created_at: '2024-01-01T00:00:00Z',
      };

      renderComponent(imageWithoutUrls);

      // Should show icon placeholder
      const image = screen.queryByRole('img');
      expect(image).not.toBeInTheDocument();
    });

    it('does not show copy button for images', () => {
      renderComponent(mockImageArtifact);

      expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
    });

    it('displays image title', () => {
      renderComponent(mockImageArtifact);

      expect(screen.getByText('Image Artifact')).toBeInTheDocument();
    });
  });

  describe('File Artifact Rendering', () => {
    it('renders file artifact title', () => {
      renderComponent(mockFileArtifact);

      expect(screen.getByText('Document.pdf')).toBeInTheDocument();
    });

    it('shows file size', () => {
      renderComponent(mockFileArtifact);

      // 1048576 bytes = 1.0 MB (binary)
      expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
    });

    it('shows default title when missing', () => {
      const fileWithoutTitle: Artifact = {
        ...mockFileArtifact,
        title: undefined,
      };

      renderComponent(fileWithoutTitle);

      expect(screen.getByText('File')).toBeInTheDocument();
    });

    it('does not show copy button for files', () => {
      renderComponent(mockFileArtifact);

      expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('shows view button when onView is provided', () => {
      renderComponent(mockTextArtifact);

      expect(screen.getByRole('button', { name: /view/i })).toBeInTheDocument();
    });

    it('does not show view button when onView is not provided', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument();
    });

    it('calls onView when view button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent(mockImageArtifact);

      const viewButton = screen.getByRole('button', { name: /view/i });
      await user.click(viewButton);

      expect(mockOnView).toHaveBeenCalled();
    });

    it('shows save button when onSave is provided', () => {
      renderComponent(mockTextArtifact);

      expect(screen.getByRole('button', { name: /artifact actions/i })).toBeInTheDocument();
    });

    it('does not show save button when onSave is not provided', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onView={mockOnView}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });

    it('calls onSave when save button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent(mockTextArtifact);

      await user.click(screen.getByRole('button', { name: /artifact actions/i }));
      const saveButton = await screen.findByRole('menuitem', { name: /save/i });
      await user.click(saveButton);

      expect(mockOnSave).toHaveBeenCalled();
    });

    it('shows download button when onDownload is provided', () => {
      renderComponent(mockTextArtifact);

      expect(screen.getByRole('button', { name: /artifact actions/i })).toBeInTheDocument();
    });

    it('does not show download button when onDownload is not provided', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onView={mockOnView}
          onSave={mockOnSave}
        />
      );

      expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    });

    it('calls onDownload when download button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent(mockFileArtifact);

      await user.click(screen.getByRole('button', { name: /artifact actions/i }));
      const downloadButton = await screen.findByRole('menuitem', { name: /download/i });
      await user.click(downloadButton);

      expect(mockOnDownload).toHaveBeenCalled();
    });
  });

  describe('Disabled State', () => {
    it('disables copy button when disabled', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
          onAttachAsInput={mockOnAttachAsInput}
          disabled={true}
        />
      );

      const menuButton = screen.getByRole('button', { name: /artifact actions/i });
      expect(menuButton).toBeDisabled();
    });

    it('disables view button when disabled', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
          disabled={true}
        />
      );

      const viewButton = screen.getByRole('button', { name: /view/i });
      expect(viewButton).toBeDisabled();
    });

    it('disables save button when disabled', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
          disabled={true}
        />
      );

      const menuButton = screen.getByRole('button', { name: /artifact actions/i });
      expect(menuButton).toBeDisabled();
    });

    it('disables download button when disabled', () => {
      render(
        <ArtifactCard
          artifact={mockTextArtifact}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
          disabled={true}
        />
      );

      const menuButton = screen.getByRole('button', { name: /actions/i });
      expect(menuButton).toBeDisabled();
    });
  });

  describe('Layout and Styling', () => {
    it('has correct card styling', () => {
      const { container } = renderComponent(mockTextArtifact);

      const card = container.querySelector('.border');
      expect(card).toBeInTheDocument();
    });

    it('has hover effect', () => {
      const { container } = renderComponent(mockTextArtifact);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('hover:bg-hover/45');
    });

    it('uses flex layout for actions', () => {
      const { container } = renderComponent(mockTextArtifact);

      const actions = container.querySelector('[aria-label="artifact actions"]');
      expect(actions).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles artifact with no content', () => {
      const artifactWithoutContent: Artifact = {
        ...mockTextArtifact,
        content: undefined,
      };

      renderComponent(artifactWithoutContent);

      expect(screen.getByText('Text Artifact')).toBeInTheDocument();
    });

    it('handles other artifact types', () => {
      const otherArtifact: Artifact = {
        id: 'artifact-other',
        task_id: 'task-1',
        type: 'other',
        title: 'Other Item',
        created_at: '2024-01-01T00:00:00Z',
      };

      renderComponent(otherArtifact);

      expect(screen.getByText('Other Item')).toBeInTheDocument();
    });

    it('handles very long titles', () => {
      const longTitleArtifact: Artifact = {
        ...mockTextArtifact,
        title: 'This is a very long title that should be truncated to fit within the available space',
      };

      renderComponent(longTitleArtifact);

      expect(screen.getByText(/This is a very long title/)).toBeInTheDocument();
    });

    it('keeps secondary artifact actions inside the actions menu', async () => {
      const user = userEvent.setup();
      renderComponent(mockTextArtifact);

      expect(screen.getByRole('button', { name: /view/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /attach as input/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /artifact actions/i }));
      const menu = screen.getByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: /copy/i })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: /save/i })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: /download/i })).toBeInTheDocument();
    });
  });
});
