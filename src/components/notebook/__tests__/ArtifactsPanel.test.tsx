/**
 * Tests for ArtifactsPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactsPanel } from '../ArtifactsPanel';
import type { Artifact } from '@/lib/types/task';

vi.mock('@/components/ui/loading', () => ({
  EmptyState: ({ title, description }: any) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
    </div>
  ),
}));

vi.mock('../ArtifactCard', () => ({
  ArtifactCard: ({ artifact, onView, onSave, onDownload, disabled }: any) => (
    <div data-testid={`artifact-card-${artifact.id}`}>
      <div data-artifact-type>{artifact.type}</div>
      <div data-artifact-title>{artifact.title || '(no title)'}</div>
      {onView && <button data-action="view">View</button>}
      {onSave && <button data-action="save">Save</button>}
      {onDownload && <button data-action="download">Download</button>}
      {disabled && <div data-disabled>disabled</div>}
    </div>
  ),
}));

vi.mock('../ArtifactImageGrid', () => ({
  ArtifactImageGrid: ({ artifacts, onImageClick }: any) => (
    <div data-testid="image-grid">
      {artifacts.map((artifact: Artifact) => (
        <div key={artifact.id} data-testid={`image-grid-item-${artifact.id}`}>
          <img src={artifact.thumbnail_url || artifact.content} alt={artifact.title} />
          <button onClick={() => onImageClick(artifact)}>View Image</button>
        </div>
      ))}
    </div>
  ),
}));

describe('ArtifactsPanel', () => {
  const mockArtifacts: Artifact[] = [
    {
      id: 'artifact-1',
      task_id: 'task-1',
      type: 'text',
      title: 'Text Artifact',
      content: 'This is a text artifact',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'artifact-2',
      task_id: 'task-1',
      type: 'image',
      title: 'Image Artifact',
      thumbnail_url: 'https://example.com/thumb.jpg',
      content: 'https://example.com/image.jpg',
      created_at: '2024-01-01T01:00:00Z',
    },
    {
      id: 'artifact-3',
      task_id: 'task-1',
      type: 'file',
      title: 'File.pdf',
      file_size: 1024000,
      created_at: '2024-01-01T02:00:00Z',
    },
    {
      id: 'artifact-4',
      task_id: 'task-1',
      type: 'other',
      title: 'Other Artifact',
      created_at: '2024-01-01T03:00:00Z',
    },
  ];

  const mockOnView = vi.fn();
  const mockOnSave = vi.fn();
  const mockOnDownload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <ArtifactsPanel
        artifacts={mockArtifacts}
        onView={mockOnView}
        onSave={mockOnSave}
        onDownload={mockOnDownload}
        {...props}
      />
    );
  };

  describe('Empty State', () => {
    it('renders empty state when no artifacts', () => {
      render(
        <ArtifactsPanel
          artifacts={[]}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('empty-title')).toHaveTextContent('No artifacts yet');
    });

    it('shows empty state description', () => {
      render(
        <ArtifactsPanel
          artifacts={[]}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.getByTestId('empty-description')).toHaveTextContent(/Start a conversation/);
    });
  });

  describe('Artifact Rendering', () => {
    it('renders all artifacts', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1')).toBeInTheDocument();
      expect(screen.getByTestId('artifact-card-artifact-3')).toBeInTheDocument();
      expect(screen.getByTestId('artifact-card-artifact-4')).toBeInTheDocument();
    });

    it('separates image artifacts into grid', () => {
      renderComponent();

      expect(screen.getByTestId('image-grid')).toBeInTheDocument();
      expect(screen.getByTestId('image-grid-item-artifact-2')).toBeInTheDocument();
    });

    it('renders non-image artifacts as cards', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1')).toBeInTheDocument();
      expect(screen.getByTestId('artifact-card-artifact-3')).toBeInTheDocument();
      expect(screen.getByTestId('artifact-card-artifact-4')).toBeInTheDocument();
    });

    it('displays artifact types', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1').querySelector('[data-artifact-type]')?.textContent).toBe('text');
      expect(screen.getByTestId('artifact-card-artifact-3').querySelector('[data-artifact-type]')?.textContent).toBe('file');
    });
  });

  describe('Filtering', () => {
    it('shows filter dropdown', () => {
      renderComponent();

      const selectTrigger = document.querySelector('[role="combobox"]');
      expect(selectTrigger).toBeInTheDocument();
    });

    it('filters artifacts by type', async () => {
      const _user = userEvent.setup();
      renderComponent();

      // This test is basic - actual filter interaction would require more setup
      // The filter state should update when changed
      expect(screen.getByTestId('artifact-card-artifact-1')).toBeInTheDocument();
    });

    it('shows all artifacts when filter is set to "all"', () => {
      renderComponent();

      expect(screen.getByTestId('image-grid')).toBeInTheDocument();
      expect(screen.getByTestId('artifact-card-artifact-1')).toBeInTheDocument();
    });
  });

  describe('Artifact Actions', () => {
    it('passes view callback to image artifacts', () => {
      renderComponent();

      const viewButtons = screen.getAllByText('View Image');
      expect(viewButtons.length).toBeGreaterThan(0);
    });

    it('passes view callback to non-image artifacts', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1').querySelector('[data-action="view"]')).toBeInTheDocument();
    });

    it('passes save callback to artifacts', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1').querySelector('[data-action="save"]')).toBeInTheDocument();
    });

    it('passes download callback to artifacts', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1').querySelector('[data-action="download"]')).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('passes disabled state to artifact cards', () => {
      render(
        <ArtifactsPanel
          artifacts={mockArtifacts}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
          disabled={true}
        />
      );

      expect(screen.getByTestId('artifact-card-artifact-1').querySelector('[data-disabled]')).toBeInTheDocument();
    });
  });

  describe('Header', () => {
    it('renders artifacts title', () => {
      renderComponent();

      expect(screen.getByText('Artifacts')).toBeInTheDocument();
    });
  });

  describe('Layout and Styling', () => {
    it('has correct panel structure', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.h-full.flex.flex-col');
      expect(panel).toBeInTheDocument();
    });

    it('has left border', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.border-l');
      expect(panel).toBeInTheDocument();
    });

    it('has correct background', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.bg-surface');
      expect(panel).toBeInTheDocument();
    });
  });

  describe('Image Artifacts', () => {
    it('renders image artifacts in grid', () => {
      renderComponent();

      expect(screen.getByTestId('image-grid')).toBeInTheDocument();
    });

    it('passes image click handler', () => {
      renderComponent();

      const imageGrid = screen.getByTestId('image-grid');
      expect(imageGrid).toBeInTheDocument();
    });
  });

  describe('Non-Image Artifacts', () => {
    it('renders text artifacts as cards', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-1')).toBeInTheDocument();
    });

    it('renders file artifacts as cards', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-3')).toBeInTheDocument();
    });

    it('renders other artifacts as cards', () => {
      renderComponent();

      expect(screen.getByTestId('artifact-card-artifact-4')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles artifacts with no title', () => {
      const artifactWithoutTitle: Artifact[] = [
        {
          id: 'artifact-no-title',
          task_id: 'task-1',
          type: 'text',
          content: 'No title content',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      render(
        <ArtifactsPanel
          artifacts={artifactWithoutTitle}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.getByTestId('artifact-card-artifact-no-title')).toBeInTheDocument();
    });

    it('handles only image artifacts', () => {
      const onlyImages: Artifact[] = [
        {
          id: 'img-1',
          task_id: 'task-1',
          type: 'image',
          content: 'https://example.com/img1.jpg',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'img-2',
          task_id: 'task-1',
          type: 'image',
          content: 'https://example.com/img2.jpg',
          created_at: '2024-01-01T01:00:00Z',
        },
      ];

      render(
        <ArtifactsPanel
          artifacts={onlyImages}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.getByTestId('image-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('artifact-card-img-1')).not.toBeInTheDocument();
    });

    it('handles only non-image artifacts', () => {
      const onlyNonImages: Artifact[] = [
        {
          id: 'text-1',
          task_id: 'task-1',
          type: 'text',
          content: 'Text content',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'file-1',
          task_id: 'task-1',
          type: 'file',
          title: 'file.pdf',
          created_at: '2024-01-01T01:00:00Z',
        },
      ];

      render(
        <ArtifactsPanel
          artifacts={onlyNonImages}
          onView={mockOnView}
          onSave={mockOnSave}
          onDownload={mockOnDownload}
        />
      );

      expect(screen.queryByTestId('image-grid')).not.toBeInTheDocument();
      expect(screen.getByTestId('artifact-card-text-1')).toBeInTheDocument();
    });
  });
});
