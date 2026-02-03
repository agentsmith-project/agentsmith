/**
 * Unit tests for app-shell components
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Logo } from '../Logo';
import { Menu } from '../Menu';
import { Sidebar } from '../Sidebar';
import { LayoutGrid, Home, Settings, Users } from 'lucide-react';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      nav: {
        'sidebar.collapse': 'Collapse',
      },
    };
    return translations[namespace]?.[key] || key;
  },
}));

describe('Logo', () => {
  it('should render logo with sparkles icon and MBOS text', () => {
    render(<Logo />);

    expect(screen.getByText('MBOS')).toBeInTheDocument();
    // Check for the icon container
    const iconContainer = document.querySelector('.w-8.h-8');
    expect(iconContainer).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<Logo className="custom-class" />);

    const wrapper = container.querySelector('.custom-class');
    expect(wrapper).toBeInTheDocument();
  });

  it('should have correct styling classes', () => {
    const { container } = render(<Logo />);

    const wrapper = container.querySelector('.flex.items-center.gap-2');
    expect(wrapper).toBeInTheDocument();
  });
});

describe('Menu', () => {
  const mockItems = [
    { id: '1', label: 'Item 1', icon: Home },
    { id: '2', label: 'Item 2', icon: LayoutGrid },
    { id: '3', label: 'Item 3', icon: Settings, disabled: true },
  ];

  it('should render selected item', () => {
    render(
      <Menu
        items={mockItems}
        value="1"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });

  it('should display placeholder when no item matches value', () => {
    render(
      <Menu
        items={mockItems}
        value="invalid"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Select...')).toBeInTheDocument();
  });

  it('should open dropdown on click', async () => {
    render(
      <Menu
        items={mockItems}
        value="1"
        onChange={vi.fn()}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Item 2')).toBeInTheDocument();
      expect(screen.getByText('Item 3')).toBeInTheDocument();
    });
  });

  it('should call onChange when item is selected', async () => {
    const handleChange = vi.fn();

    render(
      <Menu
        items={mockItems}
        value="1"
        onChange={handleChange}
      />
    );

    // Open dropdown
    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Click on Item 2
    await waitFor(() => {
      const item2 = screen.getByText('Item 2');
      fireEvent.click(item2);
    });

    expect(handleChange).toHaveBeenCalledWith('2');
  });

  it('should not call onChange for disabled items', async () => {
    const handleChange = vi.fn();

    render(
      <Menu
        items={mockItems}
        value="1"
        onChange={handleChange}
      />
    );

    // Open dropdown
    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Try to click on disabled Item 3
    await waitFor(() => {
      const item3 = screen.getByText('Item 3');
      fireEvent.click(item3);
    });

    expect(handleChange).not.toHaveBeenCalled();
  });

  it('should display badge for items with badges', () => {
    const itemsWithBadge = [
      { id: '1', label: 'Item 1', icon: Home, badge: 'New' },
      { id: '2', label: 'Item 2', icon: LayoutGrid, badge: 5 },
    ];

    render(
      <Menu
        items={itemsWithBadge}
        value="1"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('should close dropdown when backdrop is clicked', async () => {
    render(
      <Menu
        items={mockItems}
        value="1"
        onChange={vi.fn()}
      />
    );

    // Open dropdown
    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Item 2')).toBeInTheDocument();
    });

    // Click backdrop
    const backdrop = document.querySelector('.fixed.inset-0');
    expect(backdrop).toBeInTheDocument();
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    // Dropdown should be closed
    await waitFor(() => {
      expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
    });
  });

  it('should apply custom className', () => {
    const { container } = render(
      <Menu
        items={mockItems}
        value="1"
        onChange={vi.fn()}
        className="custom-menu"
      />
    );

    expect(container.querySelector('.custom-menu')).toBeInTheDocument();
  });

  it('should display chevron down icon', () => {
    render(
      <Menu
        items={mockItems}
        value="1"
        onChange={vi.fn()}
      />
    );

    const button = screen.getByRole('button');
    // ChevronDown should be present in the button
    expect(button.querySelector('svg')).toBeInTheDocument();
  });
});

describe('Sidebar', () => {
  const mockItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'projects', label: 'Projects', icon: LayoutGrid },
    { id: 'members', label: 'Members', icon: Users, badge: 5 },
    { id: 'settings', label: 'Settings', icon: Settings, disabled: true },
  ];

  it('should render all menu items', () => {
    render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should highlight active item', () => {
    render(
      <Sidebar
        items={mockItems}
        value="projects"
        onChange={vi.fn()}
      />
    );

    // Check for the active styling
    const projectsButton = screen.getByText('Projects').closest('button');
    expect(projectsButton).toHaveClass('bg-hover');
  });

  it('should call onChange when item is clicked', () => {
    const handleChange = vi.fn();

    render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={handleChange}
      />
    );

    const projectsButton = screen.getByText('Projects').closest('button');
    if (projectsButton) {
      fireEvent.click(projectsButton);
    }

    expect(handleChange).toHaveBeenCalledWith('projects');
  });

  it('should not call onChange for disabled items', () => {
    const handleChange = vi.fn();

    render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={handleChange}
      />
    );

    const settingsButton = screen.getByText('Settings').closest('button');
    expect(settingsButton).toBeDisabled();
  });

  it('should display badge for items with badges', () => {
    render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('should have correct width and styling', () => {
    const { container } = render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={vi.fn()}
      />
    );

    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveClass('w-[260px]');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={vi.fn()}
        className="custom-sidebar"
      />
    );

    const sidebar = container.querySelector('.custom-sidebar');
    expect(sidebar).toBeInTheDocument();
  });

  it('should render collapse button in footer', () => {
    render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  it('should have proper nav structure', () => {
    const { container } = render(
      <Sidebar
        items={mockItems}
        value="overview"
        onChange={vi.fn()}
      />
    );

    const nav = container.querySelector('nav');
    const ul = container.querySelector('ul');
    expect(nav).toBeInTheDocument();
    expect(ul).toBeInTheDocument();
  });
});
